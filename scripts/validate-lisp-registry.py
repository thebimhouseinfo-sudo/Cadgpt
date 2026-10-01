"""Validate repo-bundled/internal Lisp ownership.

User AppData is runtime state under CADGPT_APPDATA_ROOT (normally
%LOCALAPPDATA%\CadGPT on Windows) and is intentionally not committed.
The repository may ship installation-owned/internal Lisp only under
resources/cad/internal-lisp/**.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPDATA = ROOT / "appdata"
INTERNAL_LISP_ROOT = ROOT / "resources" / "cad" / "internal-lisp"


def main() -> None:
    errors: list[str] = []

    tracked_appdata = [
        p
        for p in APPDATA.rglob("*")
        if p.is_file() and p.name != "README.md"
    ]
    if tracked_appdata:
        for item in tracked_appdata:
            errors.append(
                f"repo appdata must not contain runtime/user assets: {item.relative_to(ROOT).as_posix()}"
            )

    lisps = sorted(
        p for p in INTERNAL_LISP_ROOT.rglob("*")
        if p.is_file() and p.suffix.lower() == ".lsp"
    )
    if not lisps:
        errors.append("internal Lisp bundle is empty")

    roots = {
        p.relative_to(INTERNAL_LISP_ROOT).parts[0]
        for p in lisps
        if p.relative_to(INTERNAL_LISP_ROOT).parts
    }
    if roots != {"tbh-toolkit"}:
        errors.append(
            f"unexpected internal Lisp library roots: {sorted(roots)}"
        )

    if errors:
        print("Bundled/Internal Lisp contract FAILED:")
        for error in errors:
            print(f" - {error}")
        raise SystemExit(1)

    print(
        f"Bundled/Internal Lisp contract passed: {len(lisps)} Lisp files, "
        "user AppData remains runtime-only"
    )


if __name__ == "__main__":
    main()
