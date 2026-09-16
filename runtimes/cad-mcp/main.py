"""Start the AutoCAD 2018 MCP server.

Run with: python main.py
MCP clients connect through stdio transport.

This file only creates the server and registers tools. It does not contain
business logic.
"""

from mcp.server.fastmcp import FastMCP

from tools import (
    block_tools,
    capability_tools,
    dimension_tools,
    document_tools,
    draw_tools,
    entity_tools,
    geometry_tools,
    layer_tools,
    lisp_tools,
    modify_tools,
    text_tools,
)
from utils.logger import get_logger

log = get_logger(__name__)

mcp = FastMCP("cad-mcp")

capability_tools.register(mcp)
document_tools.register(mcp)
layer_tools.register(mcp)
entity_tools.register(mcp)
text_tools.register(mcp)
geometry_tools.register(mcp)
draw_tools.register(mcp)
modify_tools.register(mcp)
lisp_tools.register(mcp)
dimension_tools.register(mcp)
block_tools.register(mcp)

if __name__ == "__main__":
    log.info("Starting cad-mcp server with stdio transport...")
    mcp.run(transport="stdio")
