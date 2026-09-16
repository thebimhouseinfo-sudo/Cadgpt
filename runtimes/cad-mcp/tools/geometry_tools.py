"""MCP tools for explicit Line and Arc geometry updates."""

from connection.acad import AutoCADNotRunningError
from services.geometry_service import GeometryServiceError, update_arc, update_line
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (AutoCADNotRunningError, GeometryServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected geometry tool error")
        raise RuntimeError(f"Unexpected geometry tool error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_update_line(
        handle: str,
        start_point: list[float] | None = None,
        end_point: list[float] | None = None,
    ) -> dict:
        """Update Line endpoints by handle. At least one endpoint is required."""
        return _safe(update_line, handle, start_point, end_point)

    @mcp.tool()
    def cad_update_arc(
        handle: str,
        center: list[float] | None = None,
        radius: float | None = None,
        start_angle: float | None = None,
        end_angle: float | None = None,
    ) -> dict:
        """Update Arc center/radius/angles by handle. Angles are radians."""
        return _safe(update_arc, handle, center, radius, start_angle, end_angle)
