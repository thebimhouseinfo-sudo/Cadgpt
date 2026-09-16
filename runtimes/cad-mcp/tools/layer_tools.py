"""MCP tools for bound-drawing layer inspection and reversible mutations."""

from connection.acad import AutoCADNotRunningError
from services.layer_service import (
    LayerServiceError,
    create_layer,
    get_current_layer_info,
    list_layers,
    rename_layer,
    set_current_layer,
    set_layer_color,
    set_layer_freeze,
    set_layer_lock,
    set_layer_on,
)
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args):
    try:
        return fn(*args)
    except (AutoCADNotRunningError, LayerServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected layer tool error")
        raise RuntimeError(f"Unexpected layer tool error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_get_current_layer() -> dict:
        """Return the current layer of the CadGPT-bound drawing. Read-only."""
        return _safe(get_current_layer_info)

    @mcp.tool()
    def cad_list_layers() -> list[dict]:
        """List layers and basic state for the CadGPT-bound drawing. Read-only."""
        return _safe(list_layers)

    @mcp.tool()
    def cad_set_current_layer(name: str) -> dict:
        """Set the current layer of the bound drawing. Reversible state change."""
        return _safe(set_current_layer, name)

    @mcp.tool()
    def cad_create_layer(name: str, color_aci: int | None = None) -> dict:
        """Create a named layer in the bound drawing. Does not create geometry."""
        return _safe(create_layer, name, color_aci)

    @mcp.tool()
    def cad_rename_layer(old_name: str, new_name: str) -> dict:
        """Rename a layer without changing entity geometry."""
        return _safe(rename_layer, old_name, new_name)

    @mcp.tool()
    def cad_set_layer_lock(name: str, locked: bool) -> dict:
        """Lock or unlock a layer in the bound drawing."""
        return _safe(set_layer_lock, name, locked)

    @mcp.tool()
    def cad_set_layer_freeze(name: str, frozen: bool) -> dict:
        """Freeze or thaw a layer in the bound drawing."""
        return _safe(set_layer_freeze, name, frozen)

    @mcp.tool()
    def cad_set_layer_on(name: str, on: bool) -> dict:
        """Turn a layer on or off in the bound drawing."""
        return _safe(set_layer_on, name, on)

    @mcp.tool()
    def cad_set_layer_color(name: str, color_aci: int) -> dict:
        """Set a layer AutoCAD Color Index (1-255)."""
        return _safe(set_layer_color, name, color_aci)
