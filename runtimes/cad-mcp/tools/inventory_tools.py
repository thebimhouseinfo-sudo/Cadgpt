"""MCP tools for structured drawing inventory."""

from connection.acad import AutoCADNotRunningError
from services.inventory_service import InventoryServiceError, layer_object_inventory
from utils.logger import get_logger

log = get_logger(__name__)


def register(mcp):
    @mcp.tool()
    def cad_inventory_layer_objects(
        include_block_definitions: bool = True,
        include_xref_definitions: bool = False,
    ) -> dict:
        """Return structured entity counts grouped by layer and AutoCAD object type.

        Use this instead of visual inspection for cleanup/mapping decisions when
        layer/object evidence is sufficient. The CadGPT proxy enforces the bound
        drawing before this call.
        """
        try:
            return layer_object_inventory(
                include_block_definitions=include_block_definitions,
                include_xref_definitions=include_xref_definitions,
            )
        except (AutoCADNotRunningError, InventoryServiceError) as exc:
            raise RuntimeError(str(exc)) from exc
        except Exception as exc:
            log.exception("Unexpected inventory tool error")
            raise RuntimeError(f"Unexpected inventory error: {exc}") from exc
