"""Shared configuration for cad-mcp.

Keep this file limited to constants, paths, and connection settings.
"""

import os


def _repo_root() -> str:
    cad_mcp_dir = os.path.dirname(os.path.abspath(__file__))
    runtimes_dir = os.path.dirname(cad_mcp_dir)
    return os.path.dirname(runtimes_dir)


def get_cadgpt_appdata_root() -> str:
    """Resolve the same CadGPT AppData root as the TypeScript core.

    Default on Windows: %LOCALAPPDATA%\\CadGPT.
    CADGPT_APPDATA_ROOT may override this for development/tests.
    The historical relative value "appdata" is treated as unset.
    """
    configured_raw = (os.environ.get("CADGPT_APPDATA_ROOT") or "").strip()
    configured = "" if configured_raw.lower() == "appdata" else configured_raw

    if configured:
        if os.path.isabs(configured):
            return os.path.realpath(configured)
        return os.path.realpath(os.path.join(_repo_root(), configured))

    local = (os.environ.get("LOCALAPPDATA") or "").strip()
    if os.name == "nt" and local:
        return os.path.realpath(os.path.join(local, "CadGPT"))

    home = os.path.expanduser("~")
    return os.path.realpath(os.path.join(home, ".local", "share", "CadGPT"))


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
