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
        """Queue loading of one repository `.lsp` file under `lisp/**`.

        Absolute paths and paths outside the CadGPT LISP sandbox are rejected.
        Loading is asynchronous; verify before depending on its side effects.
        """
        return _safe(load_lisp_file, path)

    @mcp.tool()
    def cad_run_lisp_command(name: str, args: list[str | int | float] | None = None) -> dict:
        """Queue a named AutoLISP/AutoCAD command on the CadGPT-bound drawing.

        This is intentionally not a raw command-string tool. Command names are
        restricted to identifier characters and arguments to scalar strings or
        numbers. Verify the drawing post-condition with structured read tools.
        """
        return _safe(run_lisp_command, name, args)
