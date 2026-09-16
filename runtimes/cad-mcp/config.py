"""Shared configuration for cad-mcp.

Keep this file limited to constants, paths, and connection settings.
"""

import os

AUTOCAD_PROGID = "AutoCAD.Application.22"
COM_CALL_TIMEOUT = 15
LISP_DIR = "lisp"

LISP_COMMAND_WHITELIST = {
    "XRLAYER",
    "PURGERECONCILEDLAYERS",
    "CLEANALL",
    "CATT",
    "CMTEXT",
    "VPLK",
    "VPULK",
    "SPLITVP",
    "SET1",
    "CHUANHOADRAWING",
    "RENEW",
    "C2L",
    "TABSORT",
    "REFINETEXT",
    "NUMINC",
    "COLORBYBLOCK",
    "COLORBYLAYER",
    "EXPORTLAYERS",
    "EXPLAY",
    "DF",
    "TBH",
    "LBTBH",
    "BLL",
    "BLLRELOAD",
    "PJ",
    "MH",
    "MHRESET",
    "NR",
    "B2LAY0",
    "TC",
    "HDEMO",
}

CAD_HOST = os.environ.get("CAD_HOST", "vinacad")
VINACAD_BRIDGE_HOST = os.environ.get("VINACAD_BRIDGE_HOST", "127.0.0.1")
VINACAD_BRIDGE_PORT = int(os.environ.get("VINACAD_BRIDGE_PORT", "48675"))
DEBUG = True
