"""AutoCAD COM connection helpers for CadGPT CAD MCP.

This module may observe AutoCAD ActiveDocument for discovery only. CadGPT's
actual target is owned by the outer CadGPT session binding; business tools must
be forced back to that bound document before execution.
"""

import subprocess

import pywintypes
import win32com.client

from config import AUTOCAD_PROGID
from utils.logger import get_logger

log = get_logger(__name__)
_app_cache = None


class AutoCADNotRunningError(RuntimeError):
    """AutoCAD is not running, or no drawing is open."""


def _is_acad_process_running() -> bool:
    try:
        res = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq acad.exe"],
            capture_output=True,
            text=True,
            check=False,
            timeout=3,
        )
        return "acad.exe" in res.stdout.lower()
    except Exception:
        return False


def _clear_gen_py_cache() -> bool:
    import os
    import shutil

    try:
        cache_dir = win32com.__gen_path__
    except AttributeError:
        return False
    if not cache_dir or not os.path.isdir(cache_dir):
        return False
    try:
        shutil.rmtree(cache_dir, ignore_errors=True)
        os.makedirs(cache_dir, exist_ok=True)
        log.info("Cleared corrupt win32com gen_py cache at %s", cache_dir)
        return True
    except Exception as exc:
        log.warning("Failed to clear gen_py cache at %s: %s", cache_dir, exc)
        return False


def _get_acad_app_inner():
    global _app_cache
    if _app_cache is not None:
        try:
            _ = _app_cache.Name
            return _app_cache
        except pywintypes.com_error:
            _app_cache = None

    progids = [
        "AutoCAD.Application",
        AUTOCAD_PROGID,
        "AutoCAD.Application.24.3",
        "AutoCAD.Application.24.2",
        "AutoCAD.Application.24.1",
        "AutoCAD.Application.24",
        "AutoCAD.Application.23.1",
        "AutoCAD.Application.23",
        "AutoCAD.Application.22",
    ]
    ordered = list(dict.fromkeys(progids))
    last_error = None
    for progid in ordered:
        try:
            app = win32com.client.GetActiveObject(progid)
            _app_cache = app
            log.info("Attached to running AutoCAD via %s", progid)
            return app
        except pywintypes.com_error as exc:
            last_error = exc

    if _is_acad_process_running():
        raise AutoCADNotRunningError(
            "AutoCAD is running but COM is unavailable. Open a drawing and ensure AutoCAD is not elevated above CadGPT."
        ) from last_error
    raise AutoCADNotRunningError(
        "AutoCAD is not running. Start AutoCAD and open a drawing."
    ) from last_error


def get_acad_app():
    try:
        return _get_acad_app_inner()
    except AttributeError as exc:
        message = str(exc)
        if "CLSIDToClassMap" in message or "CLSIDToPackageMap" in message:
            if _clear_gen_py_cache():
                import sys

                for key in [k for k in sys.modules if "gen_py" in k]:
                    del sys.modules[key]
                return _get_acad_app_inner()
        raise


def get_active_document():
    """Return AutoCAD ActiveDocument for discovery/legacy adapter use only."""
    app = get_acad_app()
    try:
        return app.ActiveDocument
    except pywintypes.com_error as exc:
        raise AutoCADNotRunningError(
            "AutoCAD is running, but no drawing is currently open."
        ) from exc


def reset_connection():
    global _app_cache
    _app_cache = None
