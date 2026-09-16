"""Read-only MCP tools for structured entity inspection."""

from connection.acad import AutoCADNotRunningError
from services.entity_service import EntityServiceError, get_entity, list_entities
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (AutoCADNotRunningError, EntityServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected entity query error")
        raise RuntimeError(f"Unexpected entity query error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_list_entities(
        filter: dict | None = None,
        include_paper_space: bool = False,
    ) -> list[dict]:
        """List supported entities in the CadGPT-bound drawing. Read-only.

        Optional filter fields: types, layer, handle, text_contains, limit.
        Supported types include line, polyline, circle, arc, ellipse, spline,
        point, text, mtext, hatch, wipeout, solid, dimension and block.
        """
        return _safe(list_entities, filter, include_paper_space)

    @mcp.tool()
    def cad_get_entity(handle: str, include_paper_space: bool = True) -> dict:
        """Get one supported entity by AutoCAD handle from the bound drawing."""
        return _safe(get_entity, handle, include_paper_space)
