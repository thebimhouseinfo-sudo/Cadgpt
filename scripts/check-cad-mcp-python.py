from __future__ import annotations

from pathlib import Path
import sys
import traceback

ROOT = Path(__file__).resolve().parents[1]
CAD_MCP_ROOT = ROOT / "runtimes" / "cad-mcp"

def main() -> int:
    files = sorted(
        p for p in CAD_MCP_ROOT.rglob("*.py")
        if "__pycache__" not in p.parts
    )
    failures: list[tuple[Path, BaseException]] = []

    for path in files:
        try:
            source = path.read_text(encoding="utf-8-sig")
            compile(source, str(path), "exec")
        except BaseException as exc:
            failures.append((path, exc))

    if failures:
        print(f"CAD MCP compile check failed: {len(failures)} file(s)", file=sys.stderr)
        for path, exc in failures:
            rel = path.relative_to(ROOT)
            print(f"--- {rel} ---", file=sys.stderr)
            traceback.print_exception(type(exc), exc, exc.__traceback__, file=sys.stderr)
        return 1

    print(f"compiled {len(files)} CAD MCP Python files in-memory")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
