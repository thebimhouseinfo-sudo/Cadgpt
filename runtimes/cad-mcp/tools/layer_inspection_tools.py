"""Read-only MCP tools for inspecting AutoCAD layers."""

from connection.acad import AutoCADNotRunningError
from services.layer_inspection_service import (
    LayerInspectionServiceError,
    get_current_layer,
    list_layers,
)
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (AutoCADNotRunningError, LayerInspectionServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected layer inspection tool error")
        raise RuntimeError(f"Unexpected layer inspection error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def acad_list_layers(document_name: str) -> dict:
        """List all layers and basic layer state in the bound drawing. Read-only.

        CadGPT supplies document_name from the session binding. ChatGPT must not
        select another drawing through this tool.
        """
        return _safe(list_layers, document_name)

    @mcp.tool()
    def acad_get_current_layer(document_name: str) -> dict:
        """Return the current layer and state in the bound drawing. Read-only.

        CadGPT supplies document_name from the session binding. ChatGPT must not
        select another drawing through this tool.
        """
        return _safe(get_current_layer, document_name)
