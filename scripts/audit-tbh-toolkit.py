#!/usr/bin/env python3
"""Audit every AutoLISP file in the managed TBH Toolkit library.

This script is intentionally metadata-only with respect to AutoLISP behavior:
- it may add/normalize TBH comment headers;
- it never rewrites function bodies;
- it discovers public C: commands and static risk signals;
- it updates the User Registry to cover every managed .lsp file;
- suspicious implementation patterns are documented, not repaired.

Run after an explicit TBH Toolkit import/edit operation, not as part of silent
source-folder watching.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PUBLIC_COMMAND_RE = re.compile(r"\(\s*defun\s+c:([^\s()]+)", re.IGNORECASE)
HEADER_START = "TBH-HEADER-START"
HEADER_END = "TBH-HEADER-END"
DESCRIPTION_RE = re.compile(
    r"^\s*;+\s*(?:description|mo\s*ta|mô\s*tả|chuc\s*nang|chức\s*năng)\s*:\s*(.*)$",
    re.IGNORECASE,
)

MUTATION_PATTERNS = [
    r"\(\s*entmod\b",
    r"\(\s*entmake[x]?\b",
    r"\(\s*vla-put-",
    r"\(\s*vla-add\b",
    r"\(\s*vla-copy\b",
    r"\(\s*vla-move\b",
    r"\(\s*vla-rotate\b",
    r"\(\s*vla-scale",
    r"\(\s*command-s?\b",
    r"\(\s*setvar\b",
]
DESTRUCTIVE_PATTERNS = [
    r"\(\s*entdel\b",
    r"\(\s*vla-delete\b",
    r"\b_?\.?erase\b",
    r"\b_?\.?purge\b",
    r"\bvl-file-delete\b",
]


@dataclass
class AuditResult:
    path: Path
    relative_path: str
    module: str
    title: str
    commands: list[str]
    description: str
    description_source: str
    load_behavior: str
    mutates_drawing: bool
    destructive: bool
    risk: str
    notes: list[str] = field(default_factory=list)
    header_changed: bool = False


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def slug(value: str) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "capability"


def humanize(stem: str) -> str:
    s = re.sub(r"[_-]+", " ", stem)
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    return " ".join(s.split()).strip()


def strip_strings_and_comments(text: str) -> str:
    out: list[str] = []
    in_string = False
    escaped = False
    for line in text.splitlines():
        line_out: list[str] = []
        i = 0
        in_string = False
        escaped = False
        while i < len(line):
            ch = line[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                line_out.append(" ")
            else:
                if ch == ";":
                    line_out.extend(" " * (len(line) - i))
                    break
                if ch == '"':
                    in_string = True
                    line_out.append(" ")
                else:
                    line_out.append(ch)
            i += 1
        out.append("".join(line_out))
    return "\n".join(out)


def paren_balance(text: str) -> tuple[int, int | None]:
    cleaned = strip_strings_and_comments(text)
    bal = 0
    first_negative: int | None = None
    for line_no, line in enumerate(cleaned.splitlines(), 1):
        bal += line.count("(") - line.count(")")
        if bal < 0 and first_negative is None:
            first_negative = line_no
    return bal, first_negative


def discover_commands(text: str) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for match in PUBLIC_COMMAND_RE.finditer(text):
        cmd = match.group(1).strip().upper()
        if cmd and cmd not in seen:
            seen.add(cmd)
            result.append(cmd)
    return result


def existing_description(text: str) -> str | None:
    for line in text.splitlines()[:140]:
        m = DESCRIPTION_RE.match(line)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return None


def fallback_comment_description(text: str) -> str | None:
    ignore = (
        "file", "author", "version", "command", "module", "usage", "date",
        "tbh-header", "====", "----", "copyright",
    )
    for line in text.splitlines()[:80]:
        s = line.strip()
        if not s.startswith(";"):
            continue
        s = s.lstrip(";").strip()
        if len(s) < 8:
            continue
        low = s.lower()
        if any(token in low for token in ignore):
            continue
        if re.match(r"^[=*_-]+$", s):
            continue
        return s
    return None


def build_header(file_name: str, module: str, commands: list[str], description: str) -> str:
    command_text = ", ".join(commands) if commands else "(no public C: command detected)"
    return (
        ";;; =============================================================================\n"
        ";;; TBH-HEADER-START\n"
        ";;;\n"
        f";;; File         : {file_name}\n"
        f";;; Module       : {module}\n"
        f";;; Command      : {command_text}\n"
        f";;; Description  : {description}\n"
        ";;; Review       : Static metadata audit only; function logic is unchanged.\n"
        ";;;\n"
        ";;; TBH-HEADER-END\n"
        ";;; =============================================================================\n\n"
    )


def normalize_header(text: str, file_name: str, module: str, commands: list[str], description: str) -> tuple[str, bool]:
    # Existing standardized headers are retained to avoid overwriting curated
    # Inputs/Effects/Risk metadata. Missing standardized headers get one added.
    if HEADER_START.lower() in text.lower() and HEADER_END.lower() in text.lower():
        return text, False
    return build_header(file_name, module, commands, description) + text.lstrip("\ufeff"), True


def detect_load_behavior(text: str, commands: list[str]) -> tuple[str, list[str]]:
    cleaned = strip_strings_and_comments(text)
    notes: list[str] = []
    execute = False
    for cmd in commands:
        pattern = re.compile(rf"^\s*\(\s*c:{re.escape(cmd)}\s*\)\s*$", re.IGNORECASE | re.MULTILINE)
        if pattern.search(cleaned):
            execute = True
            notes.append(f"Top-level call to C:{cmd} detected; loading the file may execute drawing behavior immediately.")
    return ("execute_on_load" if execute else "define_only"), notes


def detect_static_notes(text: str, commands: list[str]) -> tuple[bool, bool, str, list[str]]:
    low = text.lower()
    cleaned = strip_strings_and_comments(text)
    notes: list[str] = []

    mutates = any(re.search(p, cleaned, re.IGNORECASE) for p in MUTATION_PATTERNS)
    destructive = any(re.search(p, cleaned, re.IGNORECASE) for p in DESTRUCTIVE_PATTERNS)

    bal, first_negative = paren_balance(text)
    if bal != 0 or first_negative is not None:
        detail = f"Static parenthesis scan: final balance={bal}"
        if first_negative is not None:
            detail += f", first negative balance at line {first_negative}"
        notes.append(detail + ". Function logic was not changed.")

    if re.search(r"-layer[^\n\r]{0,80}[\"']l[\"']", low, re.IGNORECASE):
        notes.append('Potential command-option ambiguity: -LAYER is used with shorthand "L"; verify whether Lock or Linetype is intended.')

    if "vla-delete" in low and "getextensiondictionary" in low:
        notes.append("Deletes an extension dictionary via VLA; verify that unrelated dictionary metadata cannot be removed.")

    if re.search(r"[a-z]:\\\\", text, re.IGNORECASE):
        notes.append("Hard-coded Windows drive path detected; portability should be reviewed before deployment.")

    if "load_dialog" in low or "new_dialog" in low:
        notes.append("DCL/dialog dependency detected; verify companion DCL/resource availability in the managed library.")

    if "startapp" in low or "vl-file-delete" in low or "vl-file-copy" in low:
        notes.append("External file/process side effect detected; review paths and user intent before execution.")

    if not commands:
        notes.append("No public C: command detected; file may be a helper/library or may expose commands through non-standard patterns.")

    if destructive:
        risk = "high"
    elif mutates:
        risk = "medium"
    else:
        risk = "low"
    return mutates, destructive, risk, notes


def audit_file(path: Path, root: Path, normalize_headers: bool) -> AuditResult:
    text = read_text(path)
    rel = path.relative_to(root).as_posix()
    parts = rel.split("/")
    module = parts[0] if len(parts) > 1 else "Core"
    title = humanize(path.stem)
    commands = discover_commands(text)

    desc = existing_description(text)
    source = "header"
    if not desc:
        desc = fallback_comment_description(text)
        source = "leading-comment"
    if not desc:
        desc = f"TBH Toolkit AutoLISP capability for {title}."
        source = "filename-fallback"

    load_behavior, load_notes = detect_load_behavior(text, commands)
    mutates, destructive, risk, notes = detect_static_notes(text, commands)
    notes = load_notes + notes
    if source == "filename-fallback":
        notes.append("Description is filename-derived because no reliable description comment was found; semantic wording should be manually refined when this capability is next edited.")

    changed = False
    if normalize_headers:
        new_text, changed = normalize_header(text, path.name, module, commands, desc)
        if changed:
            write_text(path, new_text)

    return AuditResult(
        path=path,
        relative_path=rel,
        module=module,
        title=title,
        commands=commands,
        description=desc,
        description_source=source,
        load_behavior=load_behavior,
        mutates_drawing=mutates,
        destructive=destructive,
        risk=risk,
        notes=notes,
        header_changed=changed,
    )


def make_entry(result: AuditResult, existing: dict[str, Any] | None) -> dict[str, Any]:
    if existing and existing.get("semantic_status") == "curated":
        entry = dict(existing)
        entry["commands"] = result.commands
        entry["module"] = result.module
        entry["relative_path"] = result.relative_path
        # Keep manually curated semantics/risk notes, but append newly detected static notes.
        merged_notes = list(entry.get("implementation_notes") or [])
        for note in result.notes:
            if note not in merged_notes:
                merged_notes.append(note)
        entry["implementation_notes"] = merged_notes
        return entry

    capability_id = f"tbh.lisp.{slug(result.relative_path.rsplit('.', 1)[0])}"
    tags = [slug(result.module)] + [t for t in slug(result.title).split("-") if t]
    return {
        "id": capability_id,
        "kind": "lisp",
        "registry": "user",
        "library_id": "tbh-toolkit",
        "relative_path": result.relative_path,
        "title": result.title,
        "ai_mode": "static",
        "class": f"tbh.{slug(result.module)}",
        "subclass": "autolisp",
        "tags": list(dict.fromkeys(tags)),
        "module": result.module,
        "commands": result.commands,
        "summary": result.description,
        "when_to_use": [f"Use when the TBH Toolkit workflow requires {result.title}."],
        "targets": [],
        "inputs": [],
        "effects": [],
        "interaction": "interactive" if result.commands else "library/helper",
        "load_behavior": result.load_behavior,
        "mutates_drawing": result.mutates_drawing,
        "destructive": result.destructive,
        "risk": result.risk,
        "dynamic_parameters": [],
        "semantic_status": "static-audited",
        "implementation_notes": result.notes,
        "description_source": result.description_source,
    }


def update_registry(registry_path: Path, results: list[AuditResult]) -> None:
    data = json.loads(read_text(registry_path)) if registry_path.exists() else {"version": 1, "entries": []}
    entries = list(data.get("entries") or [])

    existing_by_path = {
        e.get("relative_path"): e
        for e in entries
        if e.get("kind") == "lisp" and e.get("library_id") == "tbh-toolkit" and e.get("relative_path")
    }
    preserved = [
        e for e in entries
        if not (e.get("kind") == "lisp" and e.get("library_id") == "tbh-toolkit")
    ]

    generated = [make_entry(r, existing_by_path.get(r.relative_path)) for r in results]
    generated.sort(key=lambda e: str(e.get("relative_path", "")).lower())
    data["entries"] = generated + preserved
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_notes(root: Path, results: list[AuditResult]) -> None:
    total = len(results)
    issue_results = [r for r in results if r.notes]
    changed = sum(1 for r in results if r.header_changed)
    lines = [
        "# TBH Toolkit Static Audit Notes",
        "",
        "> Generated by `scripts/audit-tbh-toolkit.py`. This is a static metadata review; function issues are documented but not repaired.",
        "",
        f"- Lisp files audited: **{total}**",
        f"- Standard headers added: **{changed}**",
        f"- Files with notes/warnings: **{len(issue_results)}**",
        "",
        "## File inventory",
        "",
    ]
    for r in results:
        cmds = ", ".join(r.commands) if r.commands else "(none detected)"
        lines.append(f"### `{r.relative_path}`")
        lines.append("")
        lines.append(f"- Commands: `{cmds}`")
        lines.append(f"- Description: {r.description}")
        lines.append(f"- Description source: `{r.description_source}`")
        lines.append(f"- Load behavior: `{r.load_behavior}`")
        lines.append(f"- Static risk: `{r.risk}`")
        if r.notes:
            lines.append("- Notes:")
            for note in r.notes:
                lines.append(f"  - {note}")
        else:
            lines.append("- Notes: none from static scan")
        lines.append("")
    write_text(root / "AUDIT_NOTES.md", "\n".join(lines).rstrip() + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--library-root", default="appdata/libraries/lisp/tbh-toolkit")
    parser.add_argument("--registry", default="appdata/registry/user/capabilities.json")
    parser.add_argument("--no-normalize-headers", action="store_true")
    args = parser.parse_args()

    root = Path(args.library_root).resolve()
    registry = Path(args.registry).resolve()
    if not root.is_dir():
        raise SystemExit(f"TBH Toolkit managed library not found: {root}")

    files = sorted(
        (p for p in root.rglob("*") if p.is_file() and p.suffix.lower() == ".lsp"),
        key=lambda p: p.as_posix().lower(),
    )
    if not files:
        raise SystemExit(f"No .lsp files found under {root}")

    results = [audit_file(p, root, not args.no_normalize_headers) for p in files]
    update_registry(registry, results)
    write_notes(root, results)

    print(f"TBH Toolkit audit complete: {len(results)} Lisp files")
    print(f"Headers added: {sum(1 for r in results if r.header_changed)}")
    print(f"Files with notes: {sum(1 for r in results if r.notes)}")
    print(f"Registry updated: {registry}")
    print(f"Audit notes: {root / 'AUDIT_NOTES.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
