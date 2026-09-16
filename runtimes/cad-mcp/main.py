"""Start CadGPT's AutoCAD MCP runtime over stdio.

Phase 2 enables read-only inspection incrementally. Mutation groups stay
disabled until their target/binding behavior and validation gates are reviewed.
"""

from mcp.server.fastmcp import FastMCP

from tools import (
    document_tools,
    entity_inspection_tools,
    inventory_tools,
    layer_inspection_tools,
)
from utils.logger import get_logger

log = get_logger(__name__)
mcp = FastMCP("cad-mcp")

document_tools.register(mcp)
inventory_tools.register(mcp)
layer_inspection_tools.register(mcp)
entity_inspection_tools.register(mcp)

if __name__ == "__main__":
    log.info("Starting cad-mcp document + read-only inspection slice over stdio...")
    mcp.run(transport="stdio")
