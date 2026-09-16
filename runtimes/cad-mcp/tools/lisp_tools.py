"""MCP tools for sandboxed AutoLISP load/run on the bound drawing."""

from connection.acad import AutoCADNotRunningError
from services.lisp_service import LispServiceError, load_lisp_file, run_lisp_command
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args):
    try:
        return fn(*args)
    except (AutoCADNotRunningError, LispServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected LISP bridge error")
        raise RuntimeError(f"Unexpected LISP bridge error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_load_lisp_file(path: str) -> dict:
        """Load and verify one repository `.lsp` file under `lisp/**`.

        Absolute paths and paths outside the CadGPT LISP sandbox are rejected.
        The tool waits for an AutoCAD load sentinel and returns `loaded`, error
        evidence, and command-log tail when available. `loaded: false` blocks
        command execution and must be debugged before handoff.
        """
        return _safe(load_lisp_file, path)

    @mcp.tool()
    def cad_run_lisp_command(name: str, args: list[str | int | float] | None = None) -> dict:
        """Queue a named AutoLISP/AutoCAD command on the CadGPT-bound drawing.

        This is intentionally not a raw command-string tool. Command names are
        restricted to identifier characters and arguments to scalar strings or
        numbers. Use only after `cad_load_lisp_file` reports `loaded: true`.
        Interactive Lisp commands should normally be handed to the user after a
        verified load instead of inventing prompt input. Automated commands must
        be verified with structured CAD postconditions.
        """
        return _safe(run_lisp_command, name, args)
