"""Isolated CLG Peno engine-data replacement regression checks.

Uses a temporary subdirectory of the authorized Job runtime, never DWG.
Invoked via job_system_run_helper with an input JSON in the Job runtime.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile


def load(name):
    path = Path(os.environ["CADGPT_JOB_RUNTIME_ROOT"]).resolve(strict=True).parent / "tools" / (name + ".py")
    spec = importlib.util.spec_from_file_location("clgp_test_" + name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(mod, datafile):
    original = sys.argv
    sys.argv = [mod.__file__, str(datafile)]
    try:
        with contextlib.redirect_stdout(io.StringIO()) as capture:
            mod.main()
        return capture.getvalue()
    finally:
        sys.argv = original


def check(cond, message):
    if not cond:
        raise AssertionError(message)


def main():
    check(len(sys.argv) == 2, "HELPER_INPUT_REQUIRED")
    owner = Path(os.environ["CADGPT_JOB_RUNTIME_ROOT"]).resolve(strict=True)
    check(Path(sys.argv[1]).resolve(strict=True).parent == owner,
          "TEST_INVOCATION_OUTSIDE_JOB_RUNTIME")
    route = load("metadata_route")
    prepare = load("prepare")
    old_root = os.environ.get("CADGPT_JOB_RUNTIME_ROOT")
    drawing = "C:\\CLGP-QA\\test.dwg"
    anchor = "TEST-DRAWING-ANCHOR-1"
    records = [
        {"handle": "A1", "source_dwg": drawing, "layer": "HVAC-SAGrille"},
        {"handle": "A2", "source_dwg": drawing, "layer": "HVAC-RAGrille",
         "geometry_verified": True, "geometry_basis": "measured_local_bbox",
         "geometry": {"center": [300, 400, 0], "width": 300,
                      "height": 300, "rotation_rad": 0}}
    ]
    cases = []
    with tempfile.TemporaryDirectory(prefix="clgp-data-qa-", dir=owner) as tmp:
        root = Path(tmp)
        os.environ["CADGPT_JOB_RUNTIME_ROOT"] = tmp
        source = {"kind": "create-system", "drawing_anchor": anchor,
                  "grille_count": len(records), "grilles": records,
                  "source_paths": [{"path": "verified-source",
                                    "sha256": "a" * 64}]}
        request = {"phase": "route", "drawing_full_path": drawing,
                   "drawing_anchor": anchor, "sources": [source]}
        file = root / "case-route.json"
        file.write_text(json.dumps(request), encoding="utf-8")
        first = run(route, file)
        check("READY_FOR_TARGETED_GEOMETRY" in first, "INITIAL_ROUTE_FAILED")
        check((root / "metadata-missing-handles.txt").read_text().splitlines()[-1]
              == "A1", "MISSING_TARGET_WRONG")
        cases.append("route_input_A_ok")
        (root / "metadata-fill.txt").write_text("previous-input\n", encoding="utf-8")
        request["sources"][0]["source_paths"][0]["sha256"] = "b" * 64
        file.write_text(json.dumps(request), encoding="utf-8")
        # Current contract: route replaces current-run scratch, never archives.
        updated = run(route, file)
        check("READY_FOR_TARGETED_GEOMETRY" in updated, "NEW_SOURCE_ROUTE_FAILED")
        check(not (root / "metadata-fill.txt").exists(),
              "STALE_FILL_SLOT_NOT_RETIRED")
        check(not (root / "history").exists(), "STALE_FILL_HISTORY_CREATED")
        cases.append("changed_source_replaces_scratch_without_history_ok")
        # The CAD fill engine would supply this response. Simulate exactly
        # one real measured record without interacting with any CAD file.
        (root / "metadata-fill.txt").write_text(json.dumps({
            "handle": "A1", "source_dwg": drawing,
            "layer": "HVAC-SAGrille", "center": [100, 200, 0],
            "width": 600, "height": 300, "rotation_rad": 0}) + "\n",
            encoding="utf-8")
        request["phase"] = "finalize"
        file.write_text(json.dumps(request), encoding="utf-8")
        result = run(route, file)
        check("READY_FOR_ANALYSIS" in result and '"count": 2' in result,
              "TARGET_FILL_FINALIZATION_FAILED")
        cases.append("targeted_result_joins_data_ok")
        # The drawing engine must not depend on a rewritten source file.
        (root / "drawn-map.txt").write_text("A2|C4\n", encoding="utf-8")
        raw_path = root / "grilles-raw.txt"
        raw1 = [
            {"handle": "A1", "source_dwg": drawing, "center": [100, 200, 0],
             "width": 600, "height": 300, "rotation_rad": 0},
            {"handle": "A2", "source_dwg": drawing, "center": [300, 400, 0],
             "width": 300, "height": 300, "rotation_rad": 0}
        ]
        raw_path.write_text("".join(json.dumps(r) + "\n" for r in raw1),
                            encoding="utf-8")
        pr = root / "case-prepare.json"
        pr.write_text(json.dumps({"drawing_full_path": drawing}), encoding="utf-8")
        out = run(prepare, pr)
        check('"count": 2' in out, "INITIAL_PLAN_FAILED")
        old_plan = (root / "peno-plan.txt").read_bytes()
        raw1[1]["width"] = 450
        raw_path.write_text("".join(json.dumps(r) + "\n" for r in raw1),
                            encoding="utf-8")
        # Changed measured geometry updates the current plan, with no approval/history gate.
        out = run(prepare, pr)
        check('"count": 2' in out and "450.0000000000" in
              (root / "peno-plan.txt").read_text(), "NEW_PLAN_NOT_PUBLISHED")
        check((root / "peno-plan.txt").read_bytes() != old_plan,
              "CURRENT_PLAN_NOT_REPLACED")
        check(not (root / "history").exists(), "UNREQUESTED_PLAN_HISTORY")
        check((root / "drawn-map.txt").read_text() == "A2|C4\n",
              "EXISTING_CAD_MAPPING_DESTROYED")
        cases.append("new_plan_publishes_data_and_preserves_map_ok")
    if old_root is not None:
        os.environ["CADGPT_JOB_RUNTIME_ROOT"] = old_root
    print(json.dumps({"status": "PASS", "tests": cases}, ensure_ascii=True))


if __name__ == "__main__":
    main()
