"""Internal CAD MCP tool for CadGPT Drawing Anchor persistence."""

from connection.acad import AutoCADNotRunningError
from services.drawing_anchor_service import (
    DrawingAnchorServiceError,
    ensure_drawing_anchor,
)
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (
        AutoCADNotRunningError,
        DrawingAnchorServiceError,
        ValueError,
    ) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected Drawing Anchor tool error")
        raise RuntimeError(f"Unexpected error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_ensure_drawing_anchor(
        document_name: str = "",
        runtime_document_id: str = "",
        preferred_anchor: str = "",
    ) -> dict:
        """Ensure the canonical CadGPT Drawing Anchor exists on one explicitly identified AutoCAD document and return it.

        This low-level primitive stores schema_version + drawing_anchor in the
        Named Objects Dictionary extension dictionary as
        CADGPT_DRAWING_ANCHOR XRecord. Existing valid anchors are never
        replaced.
        """
        return _safe(
            ensure_drawing_anchor,
            document_name,
            runtime_document_id,
            preferred_anchor,
        )
