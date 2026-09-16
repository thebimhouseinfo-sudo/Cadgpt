"""Start CadGPT's AutoCAD MCP runtime over stdio.

Migration starts with document discovery/activation only. Additional tool groups
are enabled incrementally after CadGPT drawing binding can enforce an explicit
target rather than blindly trusting AutoCAD ActiveDocument.
"""

from mcp.server.fastmcp import FastMCP

from tools import document_tools
from utils.logger import get_logger

log = get_logger(__name__)
mcp = FastMCP("cad-mcp")

document_tools.register(mcp)

if __name__ == "__main__":
    log.info("Starting cad-mcp safe document slice with stdio transport...")
    mcp.run(transport="stdio")
