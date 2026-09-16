"""Start CadGPT's AutoCAD MCP runtime over stdio.

CadGPT owns drawing selection in the outer MCP session. Every proxied CAD
business tool is called only after the outer layer re-activates the explicitly
bound drawing. Phase 2 expands the inner runtime read-only first.
"""

from mcp.server.fastmcp import FastMCP

from tools import document_tools, inventory_tools, layer_tools
from utils.logger import get_logger

log = get_logger(__name__)
mcp = FastMCP("cad-mcp")

document_tools.register(mcp)
inventory_tools.register(mcp)
layer_tools.register(mcp)

if __name__ == "__main__":
    log.info("Starting cad-mcp read-only inspection slice with stdio transport...")
    mcp.run(transport="stdio")
