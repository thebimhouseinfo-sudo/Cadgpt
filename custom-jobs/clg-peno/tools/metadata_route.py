"""CLG Peno metadata reconciliation. Only Job runtime files are read/written.

Input is a verified, normalized, source-attributed snapshot built by the Job
from authorized Create System / Grille Tag result JSON. NO DWG scans.
Usage: input_json_path provided by job_system_run_helper.
  phase=route: audit source counts/handles, create exact missing-handle queue.
  phase=finalize: verify Lisp measurements and assemble final raw.
"""
import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path

HEX = re.compile(r"^[0-9A-F]+$")
KINDS = {"create-system", "grille-tag"}
def retire_old_output(path):
    # Per-run scratch data is replaced, never archived.
    if path.exists():
        path.unlink()

def check(test, reason):
    if not test:
        raise ValueError(reason)

def digest(b):
    return hashlib.sha256(b).hexdigest()

def atomic_write(p, content):
    if p.is_file() and p.read_bytes() == content:
        return
    tmp = p.with_name(p.name + ".pending")
    check(not tmp.exists(), "UNRESOLVED_PENDING_WRITE:" + p.name)
    with tmp.open("xb") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(p)
    check(p.read_bytes() == content, "READBACK_MISMATCH:" + p.name)

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2)
            + "\n").encode("utf-8")

def read_runtime(runtime, filename):
    p = runtime / filename
    check(p.is_file(), "MISSING_" + filename)
    return p.read_bytes()

def valid_record(r, dwg):
    check(isinstance(r, dict), "GRILLE_NOT_OBJECT")
    h = str(r.get("handle") or "").upper()
    check(bool(HEX.fullmatch(h)), "INVALID_HANDLE:" + h)
    check(r.get("source_dwg") == dwg, "FOREIGN_DWG:" + h)
    return h

def verified_geometry(record):
    # Metadata ATT SIZE/Face Size/Neck Size and WCS bbox alone do not prove
    # an actual rotated grille footprint; only an explicitly verified
    # measured-local frame with full geometric fields is trusted.
    if record.get("geometry_verified") is not True:
        return None
    if record.get("geometry_basis") not in ("measured_local_bbox", "actual_local_footprint"):
        return None
    g = record.get("geometry")
    if not isinstance(g, dict) or not isinstance(g.get("center"), list):
        return None
    if len(g["center"]) != 3:
        return None
    vals = [*g["center"], g.get("width"), g.get("height"), g.get("rotation_rad")]
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in vals):
        return None
    if not (1e-6 < vals[3] < 1e9 and 1e-6 < vals[4] < 1e9):
        return None
    return vals

def raw_line(handle, geom, layer, dwg):
    return json.dumps({
        "handle": handle, "source_dwg": dwg,
        "layer": layer, "center": geom[:3], "width": geom[3],
        "height": geom[4], "rotation_rad": geom[5],
    }, separators=(",", ":"), ensure_ascii=True)

def main():
    check(len(sys.argv) == 2, "INPUT_PATH_REQUIRED")
    root = Path(os.environ["CADGPT_JOB_RUNTIME_ROOT"]).resolve(strict=True)
    path = Path(sys.argv[1]).resolve(strict=True)
    check(path.parent == root, "FOREIGN_INPUT_PATH")
    request = json.loads(path.read_text("utf-8-sig"))
    phase = request.get("phase", "route")
    check(phase in ("route", "finalize"), "UNKNOWN_PHASE")
    dwg = request["drawing_full_path"]
    anchor = request["drawing_anchor"]
    check(isinstance(dwg, str) and dwg.lower().endswith(".dwg"), "INVALID_DWG")
    check("|" not in dwg and "\n" not in dwg, "INVALID_DWG_HEADER")
    check(isinstance(anchor, str) and len(anchor) >= 8, "MISSING_DRAWING_ANCHOR")
    sources = request.get("sources")
    # Preferred Grille Tag path: parse the exact, verified grilles.json
    # snapshot with Python's JSON parser. AutoLISP has no robust JSON parser;
    # it receives only a compact handle queue written below.
    if request.get("grille_tag_snapshot_file") is not None:
        check(sources is None, "AMBIGUOUS_BOTH_SOURCE_MODES")
        check(request["grille_tag_snapshot_file"] == "grille-tag-source.json",
              "BAD_GRILLE_TAG_SNAPSHOT_FILENAME")
        snapshot = read_runtime(root, "grille-tag-source.json")
        index_snapshot = read_runtime(root, "grille-tag-index.json")
        src_hash = digest(snapshot)
        idx_hash = digest(index_snapshot)
        check(src_hash == request.get("grille_tag_source_sha256"),
              "GRILLE_TAG_SOURCE_CHANGED")
        check(idx_hash == request.get("grille_tag_index_sha256"),
              "GRILLE_TAG_INDEX_CHANGED")
        gr = json.loads(snapshot.decode("utf-8-sig"))
        ix = json.loads(index_snapshot.decode("utf-8-sig"))
        check(gr.get("drawing_anchor") == anchor and
              ix.get("drawing_anchor") == anchor, "FOREIGN_GRILLE_TAG_DRAWING")
        # Current Grille Tag result uses source/source_result, not job_id.
        # Retain compatibility with older job_id-bearing exports.
        check((gr.get("job_id") == "grille-tag" or
               gr.get("source") == "create-system-result") and
              (ix.get("job_id") == "grille-tag" or
               ix.get("source_result") == "create-system-result"),
              "INVALID_GRILLE_TAG_RESULT")
        rows = gr.get("grilles")
        check(isinstance(rows, list) and len(rows) > 0,
              "NO_GRILLE_TAG_HANDLES")
        check(gr.get("total_grilles", gr.get("grille_count")) == len(rows) and
              ix.get("total_grilles") == len(rows) and
              gr.get("unresolved_count", 0) == 0 and
              ix.get("unresolved_count", 0) == 0,
              "GRILLE_TAG_COUNT_CONFLICT")
        normalized = []
        handles = set()
        for obj in rows:
            check(isinstance(obj, dict), "BAD_GRILLE_TAG_RECORD")
            handle = str(obj.get("handle", "")).upper()
            check(bool(HEX.fullmatch(handle)) and handle not in handles,
                  "BAD_OR_REPEAT_GRILLE_HANDLE:" + handle)
            layer = str(obj.get("layer") or "")
            check(layer.upper().endswith("GRILLE") and
                  str(obj.get("owner_id") or obj.get("system_id") or "").strip(),
                  "INVALID_GRILLE_SOURCE:" + handle)
            handles.add(handle)
            normalized.append({"handle":handle,"source_dwg":dwg,"layer":layer})
        # Legacy exports had systems-to-handles index; current index.json
        # is an aggregate manifest. Validate either shape without inventing handles.
        if isinstance(ix.get("systems"), dict):
            index_handles = set()
            for system in ix["systems"].values():
                check(isinstance(system, dict), "INVALID_GRILLE_TAG_SYSTEM_INDEX")
                for handle in system.get("grilles", []):
                    h = str(handle).upper()
                    check(h not in index_handles, "DUPLICATE_INDEX_HANDLE:" + h)
                    index_handles.add(h)
            check(index_handles == handles, "GRILLE_TAG_INDEX_HANDLE_MISMATCH")
        else:
            check(ix.get("grilles_file") == "grilles.json" and
                  ix.get("total_grilles") == len(handles),
                  "GRILLE_TAG_INDEX_MANIFEST_MISMATCH")
        src_paths = request.get("source_paths")
        check(isinstance(src_paths, list) and len(src_paths) == 2,
              "GRILLE_TAG_SOURCE_PROVENANCE_REQUIRED")
        check(set(str(x.get("sha256")) for x in src_paths) == {src_hash, idx_hash},
              "GRILLE_TAG_PROVENANCE_MISMATCH")
        sources = [{"kind":"grille-tag","drawing_anchor":anchor,
                    "source_paths":src_paths,
                    "grille_count":len(normalized), "grilles":normalized}]
    check(isinstance(sources, list) and sources, "NO_METADATA_SOURCES")
    bykind = {}
    for source in sources:
        kind = source.get("kind")
        check(kind in KINDS and kind not in bykind, "BAD_OR_REPEAT_SOURCE")
        check(source.get("drawing_anchor") == anchor, "FOREIGN_SOURCE_ANCHOR:" + kind)
        check(isinstance(source.get("source_paths"), list)
              and source["source_paths"], "SOURCE_PATHS_REQUIRED:" + kind)
        check(all(isinstance(x, dict) and x.get("path") and
                  bool(re.fullmatch("[0-9a-fA-F]{64}", str(x.get("sha256",""))))
                  for x in source["source_paths"]), "SOURCE_HASH_MISSING:" + kind)
        rows = source.get("grilles")
        check(isinstance(rows, list), "NO_GRILLE_RECORDS:" + kind)
        observed = {}
        for r in rows:
            handle = valid_record(r, dwg)
            check(handle not in observed, "DUPLICATE_HANDLE:" + kind + ":" + handle)
            observed[handle] = r
        check(len(rows) == source.get("grille_count"), "SOURCE_COUNT_MISMATCH:" + kind)
        bykind[kind] = observed
    sets = [set(rows) for rows in bykind.values()]
    counts = {kind: len(rows) for kind, rows in bykind.items()}
    # Grille Tag is the complete specialist source. Create System may lag
    # and must not reduce or gate GT handle selection.
    has_grille_tag = "grille-tag" in bykind
    scope_conflict = (not has_grille_tag and len(sets) > 1 and
                      (len(set(map(len, sets))) > 1 or
                       any(s != sets[0] for s in sets[1:])))
    choice = request.get("user_resolution")
    if scope_conflict and choice is None:
        report = {
            "status":"WAITING_USER_COUNT_CONFLICT",
            "drawing_anchor":anchor, "source_counts":counts,
            "by_source_handles":{k:sorted(rows) for k,rows in bykind.items()},
            "only_in_sources":{
                k:sorted(set(rows) - set.union(*[set(other)
                    for other_kind,other in bykind.items() if other_kind!=k]))
                for k,rows in bykind.items()
            },
            "instruction":"Ask user how to resolve differing grille counts/handle sets. No CAD mutation."
        }
        atomic_write(root / "metadata-conflict.json", json_bytes(report))
        print(json.dumps(report, ensure_ascii=True))
        return
    union = set.union(*sets)
    if scope_conflict:
        check(isinstance(choice, dict) and choice.get("approved") is True,
              "USER_DECISION_REQUIRED")
        wanted = choice.get("handles")
        check(isinstance(wanted, list) and bool(wanted), "APPROVED_HANDLES_REQUIRED")
        scope = {str(h).upper() for h in wanted}
        check(len(scope)==len(wanted) and scope <= union, "INVALID_APPROVED_SCOPE")
    else:
        scope = set(bykind["grille-tag"]) if has_grille_tag else union
    check(bool(scope), "NO_GRILLE_CANDIDATES")
    if phase == "route":
        direct = {}
        missing = []
        for handle in sorted(scope, key=lambda a:int(a,16)):
            if has_grille_tag:
                # Always measure EVERY GT handle from active AutoCAD block
                # geometry, even when source metadata contains dimensions.
                missing.append(handle)
                continue
            candidates = [(kind, rows[handle]) for kind, rows in bykind.items()
                          if handle in rows]
            known = [(kind, verified_geometry(row))
                     for kind,row in candidates]
            known = [(kind, g) for kind,g in known if g is not None]
            if len(known) > 1:
                base = known[0][1]
                check(all(all(abs(a-b)<1e-5 for a,b in zip(base,g)) for _,g in known[1:]),
                      "GEOMETRY_CONFLICT:" + handle)
            if known:
                source_kind, geom = (next((kind,g) for kind,g in known
                                          if kind=="grille-tag") if any(k=="grille-tag"
                                          for k,_ in known) else known[0])
                layer = bykind[source_kind][handle].get("layer") or ""
                direct[handle] = raw_line(handle,geom,layer,dwg)
            else:
                missing.append(handle)
        audit = {
            "status":"READY_FOR_TARGETED_GEOMETRY" if missing else "READY_FOR_ANALYSIS",
            "drawing_anchor":anchor, "drawing_full_path":dwg,
            "source_counts":counts, "selected_handles":sorted(scope),
            "source_priority":"grille-tag" if has_grille_tag else "create-system",
            "measurement_policy":"all_grille_tag_handles" if has_grille_tag else "missing_geometry_only",
            "measured_from_metadata":sorted(direct),
            "missing_geometry_handles":missing,
            "source_fingerprints":{k:v.get("source_paths") for k,v in
                                   ((x["kind"],x) for x in sources)},
            "user_resolution":choice if scope_conflict else None
        }
        # Each route replaces the previous run's scratch output; no history.
        for name in ("metadata-fill.txt", "metadata-ready.json",
                     "grilles-metadata-ready.txt", "metadata-conflict.json"):
            retire_old_output(root / name)
        atomic_write(root / "metadata-route.json", json_bytes(audit))
        atomic_write(root / "metadata-direct.txt",
                     ("\n".join(direct[h] for h in sorted(direct)) +
                      ("\n" if direct else "")).encode("utf-8"))
        atomic_write(root / "metadata-missing-handles.txt",
                     ("#DRAWING|" + dwg + "\n" + "\n".join(missing)
                       + ("\n" if missing else "")).encode("utf-8"))
        print(json.dumps({"status":audit["status"],"count":len(scope),
                          "direct":len(direct),"missing":len(missing),
                          "missing_handles":missing},ensure_ascii=True))
        return
    audit = json.loads(read_runtime(root, "metadata-route.json"))
    check(audit["drawing_anchor"]==anchor and
          audit["drawing_full_path"]==dwg, "STALE_ROUTING_IDENTITY")
    check(audit["source_fingerprints"] ==
          {x["kind"]:x.get("source_paths") for x in sources},
          "METADATA_SOURCE_CHANGED_SINCE_ROUTE")
    check(audit.get("user_resolution") ==
          (choice if scope_conflict else None),
          "CONFLICT_DECISION_CHANGED_SINCE_ROUTE")
    expected = set(audit["selected_handles"])
    direct_bytes = read_runtime(root, "metadata-direct.txt")
    lines = direct_bytes.decode("utf-8-sig").splitlines()
    queue = set(audit["missing_geometry_handles"])
    if queue:
        lines += read_runtime(root,"metadata-fill.txt").decode("utf-8-sig").splitlines()
    selected = {}
    for line in lines:
        if not line.strip():
            continue
        row = json.loads(line)
        handle = valid_record(row,dwg)
        check(handle in expected and handle not in selected,
              "DUPLICATE_OR_EXTRA:" + handle)
        g = [*row["center"],row["width"],row["height"],row["rotation_rad"]]
        check(len(g)==6 and all(type(v) in (int,float) and math.isfinite(v) for v in g)
              and g[3]>1e-6 and g[4]>1e-6, "BAD_GEOMETRY:" + handle)
        selected[handle]=row
    check(set(selected)==expected, "INCOMPLETE_TARGETED_GEOMETRY:"+
          ",".join(sorted(expected-set(selected))))
    content = ("\n".join(json.dumps(selected[h],ensure_ascii=True,
               separators=(",",":")) for h in sorted(selected,key=lambda a:int(a,16)))
               + "\n").encode("utf-8")
    atomic_write(root/"grilles-metadata-ready.txt",content)
    complete={"status":"READY_FOR_ANALYSIS","count":len(selected),
              "drawing_anchor":anchor,"drawing_full_path":dwg,
              "raw_sha256":digest(content),"source_counts":counts,
              "filled_handles":sorted(queue),"selected_handles":sorted(selected)}
    atomic_write(root/"metadata-ready.json",json_bytes(complete))
    print(json.dumps(complete,ensure_ascii=True))

if __name__ == "__main__":
    main()
