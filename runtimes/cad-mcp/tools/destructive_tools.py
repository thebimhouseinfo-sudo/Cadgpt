"""MCP tools for guarded destructive entity deletion."""

from connection.acad import AutoCADNotRunningError
from services.destructive_service import (
    DestructiveServiceError,
    execute_delete_preview,
    preview_delete_entities,
)
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (AutoCADNotRunningError, DestructiveServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected destructive tool error")
        raise RuntimeError(f"Unexpected destructive tool error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_preview_delete_entities(
        filter: dict,
        include_paper_space: bool = False,
    ) -> dict:
        """Preview a non-empty entity filter and return a short-lived delete token.

        This tool never deletes geometry. The returned token captures the exact
        handle snapshot and drawing identity. Inspect the preview before calling
        cad_execute_delete_preview.
        """
        return _safe(preview_delete_entities, filter, include_paper_space)

    @mcp.tool()
    def cad_execute_delete_preview(token: str) -> dict:
        """Delete the exact entity snapshot represented by a one-shot preview token.

        The token expires, is tied to the previewed drawing, and is consumed
        before deletion starts. If execution is uncertain or interrupted, do not
        retry the same token; preview again and verify current drawing state.
        """
        return _safe(execute_delete_preview, token)
