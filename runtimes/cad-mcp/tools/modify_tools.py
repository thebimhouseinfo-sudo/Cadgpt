"""MCP tools for non-creating geometric transforms."""

from connection.acad import AutoCADNotRunningError
from services.modify_service import ModifyServiceError, move_entities, rotate_entities, scale_entities
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args):
    try:
        return fn(*args)
    except (AutoCADNotRunningError, ModifyServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected modify tool error")
        raise RuntimeError(f"Unexpected modify tool error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_move_entities(handles: list[str], displacement: list[float]) -> dict:
        """Move existing entities by a displacement vector. No new geometry is created."""
        return _safe(move_entities, handles, displacement)

    @mcp.tool()
    def cad_rotate_entities(handles: list[str], base_point: list[float], angle: float) -> dict:
        """Rotate existing entities around a base point; angle is radians."""
        return _safe(rotate_entities, handles, base_point, angle)

    @mcp.tool()
    def cad_scale_entities(handles: list[str], base_point: list[float], scale_factor: float) -> dict:
        """Scale existing entities about a base point by a positive factor."""
        return _safe(scale_entities, handles, base_point, scale_factor)
