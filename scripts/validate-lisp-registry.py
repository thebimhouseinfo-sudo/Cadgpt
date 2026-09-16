"""Validate CadGPT's curated Lisp semantic registry without importing AutoCAD.

This intentionally checks structural drift only. Semantic descriptions remain
curated because filenames and legacy headers are not reliable enough to infer
actual behavior automatically.

`ai_mode` describes how CadGPT/AI may use an otherwise normal AutoLISP source:
- static: use the permanent source as-is;
- dynamic: AI may derive a bounded temporary runtime variant using the declared
  dynamic_parameters.
It is not an AutoLISP language/type distinction.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LISP_ROOT = ROOT / "lisp"
REGISTRY = ROOT / "registry" / "lisp-registry.json"

COMMAND_RE = re.compile(r"\(\s*defun\s+c:([^\s()]+)", re.IGNORECASE)


def main() -> None:
    data = json.loads(REGISTRY.read_text(encoding="utf-8"))
    entries = data.get("entries")
    if not isinstance(entries, list):
        raise SystemExit("registry/lisp-registry.json is missing entries[]")

    errors: list[str] = []
    ids: set[str] = set()
    registered_paths: set[str] = set()

    for entry in entries:
        entry_id = str(entry.get("id", "")).strip()
        if not entry_id:
            errors.append("registry entry has no id")
            continue
        if entry_id in ids:
            errors.append(f"duplicate registry id: {entry_id}")
        ids.add(entry_id)

        ai_mode = entry.get("ai_mode")
        if ai_mode not in {"static", "dynamic"}:
            errors.append(f"{entry_id}: ai_mode must be static or dynamic")

        dynamic_parameters = entry.get("dynamic_parameters", [])
        if not isinstance(dynamic_parameters, list):
            errors.append(f"{entry_id}: dynamic_parameters must be a list")
            dynamic_parameters = []
        if ai_mode == "static" and dynamic_parameters:
            errors.append(f"{entry_id}: ai_mode=static must not declare dynamic_parameters")
        if ai_mode == "dynamic" and not dynamic_parameters:
            errors.append(f"{entry_id}: ai_mode=dynamic must declare at least one bounded dynamic_parameter")

        if "type" in entry or "dynamic_role" in entry:
            errors.append(f"{entry_id}: legacy type/dynamic_role fields are not allowed; use ai_mode")

        for required in (
            "title", "class", "subclass", "summary", "when_to_use", "targets",
            "inputs", "effects", "interaction", "load_behavior", "risk",
            "dynamic_parameters",
        ):
            if required not in entry:
                errors.append(f"{entry_id}: missing semantic field {required}")

        rel = str(entry.get("path", "")).replace("\\", "/").strip()
        if not rel:
            errors.append(f"{entry_id}: permanent library entry has no path")
            continue
        if not rel.startswith("lisp/") or not rel.lower().endswith(".lsp"):
            errors.append(f"{entry_id}: invalid Lisp path {rel}")
            continue
        registered_paths.add(rel.lower())

        source_path = ROOT / rel
        if not source_path.is_file():
            errors.append(f"{entry_id}: source path not found: {rel}")
            continue

        source = source_path.read_text(encoding="utf-8", errors="replace")
        actual_commands = {match.upper() for match in COMMAND_RE.findall(source)}
        declared_commands = {str(item).upper() for item in entry.get("commands", [])}
        missing = declared_commands - actual_commands
        if missing:
            errors.append(f"{entry_id}: registry commands missing in source: {sorted(missing)}")
        undisclosed = actual_commands - declared_commands
        if undisclosed:
            errors.append(f"{entry_id}: source has unregistered public commands: {sorted(undisclosed)}")

    for path in sorted(LISP_ROOT.rglob("*.lsp")):
        rel = path.relative_to(ROOT).as_posix()
        if rel.startswith("lisp/_cadgpt-system/"):
            continue
        if rel.lower() not in registered_paths:
            errors.append(f"unregistered user-facing Lisp: {rel}")

    if errors:
        print("Lisp registry validation FAILED:")
        for error in errors:
            print(f" - {error}")
        raise SystemExit(1)

    print(f"Lisp registry validation passed: {len(entries)} entries, {len(registered_paths)} source files")


if __name__ == "__main__":
    main()
