"""Read-only MCP tools for block references and block definitions."""

from connection.acad import AutoCADNotRunningError
from services.block_service import (
    BlockServiceError,
    get_block,
    list_block_definitions,
    list_blocks,
)
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (AutoCADNotRunningError, BlockServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected block query error")
        raise RuntimeError(f"Unexpected block query error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_list_blocks(filter: dict | None = None) -> list[dict]:
        """List block references in the CadGPT-bound drawing. Read-only.

        Optional filter fields: layer, handle and limit. The tool is always
        restricted to block references regardless of any supplied type filter.
        """
        return _safe(list_blocks, filter)

    @mcp.tool()
    def cad_get_block(handle: str) -> dict:
        """Get one block reference by handle, including attribute values."""
        return _safe(get_block, handle)

    @mcp.tool()
    def cad_list_block_definitions() -> list[dict]:
        """List named block definitions and attribute definitions. Read-only."""
        return _safe(list_block_definitions)
