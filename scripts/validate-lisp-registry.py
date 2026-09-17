"""Validate CadGPT User Registry against managed AppData libraries.

Internal Registry is generated from MCP manifests + system skills. User Registry
may contain only Lisp and concrete Jobs copied into AppData. Import/index never
changes source; this validator checks structural drift only.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPDATA = ROOT / "appdata"
LISP_ROOT = APPDATA / "libraries" / "lisp"
JOB_ROOT = APPDATA / "libraries" / "jobs"
REGISTRY = APPDATA / "registry" / "user" / "capabilities.json"
LIBRARIES = APPDATA / "registry" / "user" / "libraries.json"
COMMAND_RE = re.compile(r"\(\s*defun\s+c:([^\s()]+)", re.IGNORECASE)


def main() -> None:
    errors: list[str] = []
    data = json.loads(REGISTRY.read_text(encoding="utf-8"))
    entries = data.get("entries")
    if not isinstance(entries, list):
        raise SystemExit("User Registry is missing entries[]")

    manifest = json.loads(LIBRARIES.read_text(encoding="utf-8"))
    libraries = manifest.get("libraries")
    if not isinstance(libraries, list):
        raise SystemExit("User library manifest is missing libraries[]")

    known_libraries = {(str(item.get("kind")), str(item.get("id"))) for item in libraries}
    ids: set[str] = set()
    registered_lisp: set[tuple[str, str]] = set()
    registered_jobs: set[tuple[str, str]] = set()

    for entry in entries:
        entry_id = str(entry.get("id", "")).strip()
        kind = str(entry.get("kind", "")).strip()
        library_id = str(entry.get("library_id", "")).strip()
        relative_path = str(entry.get("relative_path", "")).replace("\\", "/").strip()

        if not entry_id:
            errors.append("registry entry has no id")
            continue
        if entry_id in ids:
            errors.append(f"duplicate registry id: {entry_id}")
        ids.add(entry_id)

        if kind not in {"lisp", "job"}:
            errors.append(f"{entry_id}: User Registry kind must be lisp or job")
            continue
        if entry.get("registry") not in {None, "user"}:
            errors.append(f"{entry_id}: User Registry entry cannot claim internal ownership")
        if not library_id or (kind, library_id) not in known_libraries:
            errors.append(f"{entry_id}: unknown managed {kind} library_id {library_id!r}")
        if not relative_path or relative_path.startswith("/") or ".." in Path(relative_path).parts:
            errors.append(f"{entry_id}: invalid relative_path {relative_path!r}")
            continue

        if kind == "lisp":
            ai_mode = entry.get("ai_mode")
            if ai_mode not in {"static", "dynamic"}:
                errors.append(f"{entry_id}: ai_mode must be static or dynamic")
            params = entry.get("dynamic_parameters", [])
            if not isinstance(params, list):
                errors.append(f"{entry_id}: dynamic_parameters must be a list")
                params = []
            if ai_mode == "static" and params:
                errors.append(f"{entry_id}: ai_mode=static must not declare dynamic_parameters")
            if ai_mode == "dynamic" and not params:
                errors.append(f"{entry_id}: ai_mode=dynamic requires bounded dynamic_parameters")
            if "type" in entry or "dynamic_role" in entry:
                errors.append(f"{entry_id}: legacy type/dynamic_role fields are forbidden")

            source_path = LISP_ROOT / library_id / relative_path
            key = (library_id.lower(), relative_path.lower())
            if key in registered_lisp:
                errors.append(f"duplicate managed Lisp path registration: {library_id}/{relative_path}")
            registered_lisp.add(key)
            if not source_path.is_file():
                errors.append(f"{entry_id}: managed Lisp source not found: {source_path.relative_to(ROOT)}")
                continue
            source = source_path.read_text(encoding="utf-8", errors="replace")
            actual = {match.upper() for match in COMMAND_RE.findall(source)}
            declared = {str(item).upper() for item in entry.get("commands", [])}
            if declared - actual:
                errors.append(f"{entry_id}: registry commands missing in source: {sorted(declared - actual)}")
            if actual - declared:
                errors.append(f"{entry_id}: source has unregistered public commands: {sorted(actual - declared)}")
        else:
            job_path = JOB_ROOT / library_id / relative_path
            key = (library_id.lower(), relative_path.lower())
            if key in registered_jobs:
                errors.append(f"duplicate managed Job path registration: {library_id}/{relative_path}")
            registered_jobs.add(key)
            if not job_path.is_file() or job_path.name.lower() != "job.md":
                errors.append(f"{entry_id}: managed Job not found: {job_path.relative_to(ROOT)}")

    for source in sorted(LISP_ROOT.rglob("*.lsp")) if LISP_ROOT.exists() else []:
        library_id = source.relative_to(LISP_ROOT).parts[0]
        relative = source.relative_to(LISP_ROOT / library_id).as_posix()
        if (library_id.lower(), relative.lower()) not in registered_lisp:
            errors.append(f"unregistered managed Lisp: {source.relative_to(ROOT).as_posix()}")

    for source in sorted(JOB_ROOT.rglob("JOB.md")) if JOB_ROOT.exists() else []:
        library_id = source.relative_to(JOB_ROOT).parts[0]
        relative = source.relative_to(JOB_ROOT / library_id).as_posix()
        if (library_id.lower(), relative.lower()) not in registered_jobs:
            errors.append(f"unregistered managed Job: {source.relative_to(ROOT).as_posix()}")

    if errors:
        print("User Registry validation FAILED:")
        for error in errors:
            print(f" - {error}")
        raise SystemExit(1)

    print(
        f"User Registry validation passed: {len(entries)} entries, "
        f"{len(registered_lisp)} Lisp files, {len(registered_jobs)} Jobs"
    )


if __name__ == "__main__":
    main()
