"""MCP tools for structured entity inspection and reversible property changes."""

from connection.acad import AutoCADNotRunningError
from services.entity_service import (
    EntityServiceError,
    get_entity,
    list_entities,
    set_entity_color,
    set_entity_layer,
    set_entity_linetype,
    set_entity_visibility,
)
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (AutoCADNotRunningError, EntityServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected entity tool error")
        raise RuntimeError(f"Unexpected entity tool error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_list_entities(
        filter: dict | None = None,
        include_paper_space: bool = False,
    ) -> list[dict]:
        """List supported entities in the CadGPT-bound drawing. Read-only."""
        return _safe(list_entities, filter, include_paper_space)

    @mcp.tool()
    def cad_get_entity(handle: str, include_paper_space: bool = True) -> dict:
        """Get one supported entity by AutoCAD handle from the bound drawing."""
        return _safe(get_entity, handle, include_paper_space)

    @mcp.tool()
    def cad_set_entity_layer(handles: list[str], layer: str) -> dict:
        """Move specific entities to an existing layer by handle."""
        return _safe(set_entity_layer, handles, layer)

    @mcp.tool()
    def cad_set_entity_color(handles: list[str], color_aci: int) -> dict:
        """Set entity color by ACI; 0=ByBlock, 256=ByLayer."""
        return _safe(set_entity_color, handles, color_aci)

    @mcp.tool()
    def cad_set_entity_visibility(handles: list[str], visible: bool) -> dict:
        """Show or hide specific entities without deleting them."""
        return _safe(set_entity_visibility, handles, visible)

    @mcp.tool()
    def cad_set_entity_linetype(handles: list[str], linetype: str) -> dict:
        """Set entity linetype to ByLayer/ByBlock or a loaded linetype."""
        return _safe(set_entity_linetype, handles, linetype)
