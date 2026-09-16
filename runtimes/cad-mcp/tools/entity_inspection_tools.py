"""Read-only MCP tools for structured AutoCAD entity inspection."""

from connection.acad import AutoCADNotRunningError
from services.entity_inspection_service import (
    EntityInspectionServiceError,
    get_entity,
    list_entities,
)
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (AutoCADNotRunningError, EntityInspectionServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected entity inspection tool error")
        raise RuntimeError(f"Unexpected entity inspection error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def acad_list_entities(
        document_name: str,
        filter: dict | None = None,
        include_paper_space: bool = False,
    ) -> dict:
        """List supported entities in the bound drawing. Read-only.

        Prefer cad_inventory_layer_objects for broad counts. Use this tool when
        handles, geometry, text, block-reference details, or a targeted filter
        are needed. filter supports types, layer, handle, text_contains, limit.
        CadGPT injects document_name from the session binding.
        """
        return _safe(list_entities, document_name, filter, include_paper_space)

    @mcp.tool()
    def acad_get_entity(
        document_name: str,
        handle: str,
        include_paper_space: bool = True,
    ) -> dict:
        """Get one supported entity by AutoCAD handle. Read-only.

        CadGPT injects document_name from the session binding.
        """
        return _safe(get_entity, document_name, handle, include_paper_space)
