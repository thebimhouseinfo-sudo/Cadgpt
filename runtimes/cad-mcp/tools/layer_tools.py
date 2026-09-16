"""Read-only MCP tools for bound-drawing layer inspection."""

from connection.acad import AutoCADNotRunningError
from services.layer_service import LayerServiceError, get_current_layer_info, list_layers
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn):
    try:
        return fn()
    except (AutoCADNotRunningError, LayerServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected layer query error")
        raise RuntimeError(f"Unexpected layer query error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_get_current_layer() -> dict:
        """Return the current layer of the CadGPT-bound drawing. Read-only."""
        return _safe(get_current_layer_info)

    @mcp.tool()
    def cad_list_layers() -> list[dict]:
        """List layers and basic state for the CadGPT-bound drawing. Read-only."""
        return _safe(list_layers)
