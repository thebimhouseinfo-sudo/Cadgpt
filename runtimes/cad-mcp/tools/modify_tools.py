"""MCP tools for bounded geometric transforms and source-preserving creation."""

from connection.acad import AutoCADNotRunningError
from services.modify_service import (
    ModifyServiceError,
    copy_entities,
    mirror_entities,
    move_entities,
    rotate_entities,
    scale_entities,
)
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

    @mcp.tool()
    def cad_copy_entities(handles: list[str], displacement: list[float]) -> dict:
        """Copy explicit entities and return the newly created handles."""
        return _safe(copy_entities, handles, displacement)

    @mcp.tool()
    def cad_mirror_entities(
        handles: list[str], point1: list[float], point2: list[float]
    ) -> dict:
        """Mirror explicit entities while always preserving source entities."""
        return _safe(mirror_entities, handles, point1, point2)
