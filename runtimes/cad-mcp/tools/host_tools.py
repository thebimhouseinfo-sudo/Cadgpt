"""Read-only MCP tools for AutoCAD host diagnostics."""

from connection.acad import AutoCADNotRunningError
from services.host_service import HostServiceError, host_status
from utils.logger import get_logger

log = get_logger(__name__)


def register(mcp):
    @mcp.tool()
    def cad_host_status() -> dict:
        """Return AutoCAD host/version/document diagnostics. Read-only."""
        try:
            return host_status()
        except (AutoCADNotRunningError, HostServiceError) as exc:
            raise RuntimeError(str(exc)) from exc
        except Exception as exc:
            log.exception("Unexpected host status error")
            raise RuntimeError(f"Unexpected host status error: {exc}") from exc
