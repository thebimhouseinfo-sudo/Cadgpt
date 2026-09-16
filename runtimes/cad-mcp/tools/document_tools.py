"""MCP tools for AutoCAD document discovery, activation, and safe test drawing creation."""

from connection.acad import AutoCADNotRunningError
from services.document_service import (
    DocumentServiceError,
    create_blank_test_document,
    get_active_document_info,
    list_open_documents,
    set_active_document,
)
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (AutoCADNotRunningError, DocumentServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected document tool error")
        raise RuntimeError(f"Unexpected error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def acad_get_active_document() -> dict:
        """Return AutoCAD's currently active drawing. Discovery only; not CadGPT binding."""
        return _safe(get_active_document_info)

    @mcp.tool()
    def acad_list_open_documents() -> list[dict]:
        """List all open AutoCAD drawings and mark AutoCAD's current active tab. Read-only."""
        return _safe(list_open_documents)

    @mcp.tool()
    def acad_set_active_document(document_name: str) -> dict:
        """Explicitly activate an already-open drawing by file name or full path."""
        return _safe(set_active_document, document_name)

    @mcp.tool()
    def acad_create_blank_test_document() -> dict:
        """Create a new unsaved blank drawing for isolated CadGPT testing.

        This low-level tool is consumed by the outer `drawing_create_test` tool
        and is not intended to be exposed directly to ChatGPT.
        """
        return _safe(create_blank_test_document)
