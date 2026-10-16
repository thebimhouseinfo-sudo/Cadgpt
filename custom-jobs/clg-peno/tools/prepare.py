"""CLG Peno Stage 2: deterministic verification and geometry plan.

Reads only raw files in CADGPT_JOB_RUNTIME_ROOT. It never accesses CAD.
No nominal/attribute dimension inference, zero clearance, one row per handle.
"""
import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path

HEX = re.compile(r"^[0-9A-F]+$")

def need(test, message):
    if not test:
        raise RuntimeError(message)

def safe_float(value, key):
    need(type(value) in (float, int), "NONNUMERIC_" + key)
    n = float(value)
    need(math.isfinite(n), "NONFINITE_" + key)
    return n

def atomically_write(path, payload):
    # Overwrite the current run's scratch file. No historical raw data.
    if path.exists() and path.read_bytes() == payload:
        return
    temp = path.with_name(path.name + ".pending")
    try:
        with temp.open("xb") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        temp.replace(path)
    finally:
        if temp.exists():
            temp.unlink()

def main():
    need(len(sys.argv) == 2, "JSON_INPUT_REQUIRED")
    runtime = Path(os.environ["CADGPT_JOB_RUNTIME_ROOT"]).resolve(strict=True)
    arg_path = Path(sys.argv[1]).resolve(strict=True)
    need(arg_path.parent == runtime, "INPUT_OUTSIDE_OWN_RUNTIME")
    args = json.loads(arg_path.read_text(encoding="utf-8-sig"))
    raw_filename = args.get("raw_filename", "grilles-raw.txt")
    need(raw_filename in ("grilles-raw.txt", "grilles-metadata-ready.txt"),
         "INVALID_RAW_SOURCE")
    source = runtime / raw_filename
    need(source.is_file(), "NO_GRILLE_RAW")
    drawing = args["drawing_full_path"]
    need(isinstance(drawing, str) and drawing.lower().endswith(".dwg"), "INVALID_DRAWING_PATH")
    need("\n" not in drawing and "|" not in drawing, "UNSUPPORTED_DRAWING_PATH")
    actual = source.read_bytes()
    need(actual.strip(), "EMPTY_GRILLE_RAW")
    digest = hashlib.sha256(actual).hexdigest()
    expected_hash = args.get("expected_raw_sha256")
    if expected_hash:
        need(expected_hash == digest, "RAW_CHANGED_SINCE_INSPECTION")
    records = {}
    for i, raw_line in enumerate(actual.decode("utf-8-sig").splitlines(), 1):
        if not raw_line.strip():
            continue
        row = json.loads(raw_line)
        need(os.path.normcase(row["source_dwg"]) == os.path.normcase(drawing),
             "FOREIGN_DRAWING_LINE_" + str(i))
        handle = str(row["handle"]).upper()
        need(bool(HEX.fullmatch(handle)), "INVALID_HANDLE_LINE_" + str(i))
        center = row["center"]
        need(isinstance(center, list) and len(center) == 3, "CENTER_MISSING_" + handle)
        xyz = [safe_float(v, "CENTER") for v in center]
        width = safe_float(row["width"], "WIDTH")
        height = safe_float(row["height"], "HEIGHT")
        rot = safe_float(row["rotation_rad"], "ROTATION")
        need(0.000001 < width < 1e9 and 0.000001 < height < 1e9, "INVALID_SIZE_" + handle)
        geom = [*xyz, width, height, rot]
        if handle in records:
            need(all(abs(a - b) < 1e-7 for a, b in zip(records[handle], geom)),
                 "CONFLICTING_REPEAT_" + handle)
        else:
            records[handle] = geom
    need(bool(records), "NO_VALID_GRILLES")
    lines = ["#DRAWING|" + drawing]
    output_records = []
    for handle in sorted(records, key=lambda x: (int(x, 16), x)):
        v = records[handle]
        # Values are already in WCS; no offset and no new dimensional inference.
        lines.append(handle + "|" + "|".join(format(x, ".10f") for x in v))
        output_records.append(dict(source_handle=handle, center=v[:3],
                                   width=v[3], height=v[4], rotation_rad=v[5],
                                   margin_each_side_mm=0.0))
    # Human-reviewable Stage 2 result; use only measured raw fields.
    analysis_rows = [
        "# CLG Peno — Stage 2 geometry analysis",
        "",
        "Source drawing: " + drawing,
        "Clearance per edge: 0 mm",
        "",
        "| Grille handle | Center X | Center Y | Center Z | Width | Height | Rotation (deg) | Status |",
        "|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for item in output_records:
        x, y, z = item["center"]
        analysis_rows.append(
            "| " + item["source_handle"] + " | "
            + " | ".join(format(v, ".3f") for v in
                         (x, y, z, item["width"], item["height"],
                          math.degrees(item["rotation_rad"])))
            + " | VALID |"
        )
    analysis_bytes = ("\n".join(analysis_rows) + "\n").encode("utf-8")
    analysis_path = runtime / "peno-analysis.md"
    payload = ("\n".join(lines) + "\n").encode("ascii")
    plan_path = runtime / "peno-plan.txt"
    manifest_path = runtime / "peno-plan-manifest.json"
    atomically_write(plan_path, payload)
    manifest = dict(
        status="PLAN_VERIFIED_PENDING_CAD",
        drawing_full_path=drawing,
        source_sha256=digest,
        plan_sha256=hashlib.sha256(payload).hexdigest(),
        analysis_sha256=hashlib.sha256(analysis_bytes).hexdigest(),
        count=len(output_records),
        geometry="visible block-reference geometry in local frame",
        margin_each_side_mm=0.0,
        records=output_records,
    )
    m = (json.dumps(manifest, ensure_ascii=True, indent=2) + "\n").encode("utf-8")
    atomically_write(manifest_path, m)
    atomically_write(analysis_path, analysis_bytes)
    need(hashlib.sha256(analysis_path.read_bytes()).hexdigest() ==
         manifest["analysis_sha256"], "ANALYSIS_READBACK_FAILED")
    need(hashlib.sha256(plan_path.read_bytes()).hexdigest() == manifest["plan_sha256"],
         "PLAN_READBACK_FAILED")
    print(json.dumps({key: manifest[key] for key in ("status", "count", "plan_sha256",
                                                     "source_sha256", "drawing_full_path")},
                     ensure_ascii=True))
if __name__ == "__main__":
    main()
