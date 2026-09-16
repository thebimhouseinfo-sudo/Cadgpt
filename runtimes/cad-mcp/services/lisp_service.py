"""Sandboxed AutoLISP execution bridge for the CadGPT-bound drawing.

File editing belongs to CadGPT's outer file tools. This service only loads
existing .lsp files from explicit CadGPT Lisp namespaces and invokes named
AutoCAD commands on the already-bound drawing. Raw arbitrary SendCommand is
intentionally not exposed.

Allowed load namespaces:
- lisp/**                         permanent reusable library
- appdata/lisp-draft/**           work-in-progress Lisp approved for testing
- appdata/runtime/dynamic-lisp/** parameterized/session-only Lisp artifacts

LISP loading is verified inside AutoCAD. A SendCommand enqueue is never treated
as proof that source loaded successfully.
"""

from __future__ import annotations

import os
import re
import time
import uuid

import pywintypes

from connection.acad import get_active_document


class LispServiceError(RuntimeError):
    pass


_COMMAND_NAME = re.compile(r"^[A-Za-z0-9_+\-.$:]+$")
_LOAD_POLL_INTERVAL = 0.10
_LOAD_TIMEOUT_SECONDS = 8.0


def _repo_root() -> str:
    services_dir = os.path.dirname(os.path.abspath(__file__))
    cad_mcp_dir = os.path.dirname(services_dir)
    runtimes_dir = os.path.dirname(cad_mcp_dir)
    return os.path.dirname(runtimes_dir)


def _lisp_root() -> str:
    return os.path.realpath(os.path.join(_repo_root(), "lisp"))


def _appdata_root() -> str:
    configured = (os.environ.get("CADGPT_APPDATA_ROOT") or "appdata").strip() or "appdata"
    if os.path.isabs(configured):
        return os.path.realpath(configured)
    return os.path.realpath(os.path.join(_repo_root(), configured))


def _inside(candidate: str, root: str) -> bool:
    try:
        return os.path.commonpath([candidate, root]) == root
    except ValueError:
        return False


def _resolve_lisp_path(input_path: str) -> tuple[str, str]:
    if not isinstance(input_path, str) or not input_path.strip():
        raise LispServiceError("path is required")

    raw = input_path.strip().replace("\\", "/")
    if os.path.isabs(raw):
        raise LispServiceError("absolute paths are not allowed; use a CadGPT virtual Lisp path")

    normalized = raw[2:] if raw.startswith("./") else raw
    lower = normalized.lower()

    if lower.startswith("lisp/"):
        suffix = normalized[5:]
        root = _lisp_root()
        virtual_prefix = "lisp"
    elif lower.startswith("appdata/lisp-draft/"):
        suffix = normalized[len("appdata/lisp-draft/") :]
        root = os.path.realpath(os.path.join(_appdata_root(), "lisp-draft"))
        virtual_prefix = "appdata/lisp-draft"
    elif lower.startswith("appdata/runtime/dynamic-lisp/"):
        suffix = normalized[len("appdata/runtime/dynamic-lisp/") :]
        root = os.path.realpath(os.path.join(_appdata_root(), "runtime", "dynamic-lisp"))
        virtual_prefix = "appdata/runtime/dynamic-lisp"
    else:
        raise LispServiceError(
            "LISP path must be under lisp/**, appdata/lisp-draft/**, or appdata/runtime/dynamic-lisp/**"
        )

    candidate = os.path.realpath(os.path.join(root, suffix))
    if not _inside(candidate, root):
        raise LispServiceError(f"LISP path escapes the {virtual_prefix}/** sandbox")
    if os.path.splitext(candidate)[1].lower() != ".lsp":
        raise LispServiceError("only .lsp files can be loaded")
    if not os.path.isfile(candidate):
        raise LispServiceError(f"LISP file was not found: {virtual_prefix}/{suffix}")

    relative_suffix = os.path.relpath(candidate, root).replace("\\", "/")
    return candidate, f"{virtual_prefix}/{relative_suffix}"


def _send(command: str) -> None:
    doc = get_active_document()
    text = command if command.endswith(("\n", "\r", " ")) else command + "\n"
    last_error = None
    for attempt in range(3):
        try:
            doc.SendCommand(text)
            return
        except pywintypes.com_error as exc:
            last_error = exc
            # RPC_E_CALL_REJECTED: AutoCAD is temporarily busy.
            if getattr(exc, "hresult", None) == -2147418111 and attempt < 2:
                time.sleep(0.5 * (attempt + 1))
                continue
            raise LispServiceError(str(exc)) from exc
    raise LispServiceError(str(last_error))


def _serialize_arg(value) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise LispServiceError("command args may contain only strings or numbers")
    if isinstance(value, str):
        if any(ch in value for ch in ("\n", "\r", "\x00")):
            raise LispServiceError("command string args cannot contain line breaks or NUL")
        if not value:
            return '""'
        if any(ch.isspace() for ch in value) or '"' in value:
            escaped = value.replace('"', '\\"')
            return f'"{escaped}"'
        return value
    return str(value)


def _safe_getvar(doc, name: str, default=None):
    try:
        return doc.GetVariable(name)
    except Exception:
        return default


def _safe_setvar(doc, name: str, value) -> bool:
    try:
        doc.SetVariable(name, value)
        return True
    except Exception:
        return False


def _log_position(path: str | None) -> int:
    if not path or not os.path.isfile(path):
        return 0
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def _read_log_tail(path: str | None, start: int = 0, max_bytes: int = 16000) -> str:
    if not path or not os.path.isfile(path):
        return ""
    try:
        size = os.path.getsize(path)
        offset = start if 0 <= start <= size else max(0, size - max_bytes)
        if size - offset > max_bytes:
            offset = size - max_bytes
        with open(path, "rb") as handle:
            handle.seek(offset)
            data = handle.read(max_bytes)
        return data.decode("utf-8", errors="replace").strip()
    except OSError:
        return ""


def _verified_load_expression(lisp_path: str, token: str) -> str:
    """Build a controlled expression that records load success/error in USERS5."""
    ok = f"CADGPT_OK:{token}"
    err = f"CADGPT_ERR:{token}:"
    # Keep the error payload short enough for a USER string system variable.
    return (
        "(progn "
        "(vl-load-com) "
        f"(setq *cadgpt-load-result* (vl-catch-all-apply 'load (list \"{lisp_path}\"))) "
        "(if (vl-catch-all-error-p *cadgpt-load-result*) "
        f"(setvar \"USERS5\" (strcat \"{err}\" (substr (vl-catch-all-error-message *cadgpt-load-result*) 1 180))) "
        f"(setvar \"USERS5\" \"{ok}\")) "
        "(princ))"
    )


def load_lisp_file(path: str) -> dict:
    """Load one sandboxed LISP file and verify AutoCAD reached a success sentinel.

    On failure, return captured AutoLISP error text when available and the
    relevant command-history log tail as evidence for the write-lisp debug loop.
    """
    absolute, relative = _resolve_lisp_path(path)
    lisp_path = absolute.replace("\\", "/")
    doc = get_active_document()

    token = uuid.uuid4().hex[:12]
    pending = f"CADGPT_PENDING:{token}"
    ok_prefix = f"CADGPT_OK:{token}"
    err_prefix = f"CADGPT_ERR:{token}:"

    previous_users5 = _safe_getvar(doc, "USERS5", "")
    previous_log_mode = _safe_getvar(doc, "LOGFILEMODE", 0)
    log_path = str(_safe_getvar(doc, "LOGFILENAME", "") or "")
    log_start = _log_position(log_path)

    # Command history is diagnostic evidence. Restore the user's mode afterwards.
    _safe_setvar(doc, "LOGFILEMODE", 1)
    _safe_setvar(doc, "USERS5", pending)

    try:
        _send(_verified_load_expression(lisp_path, token))
        deadline = time.monotonic() + _LOAD_TIMEOUT_SECONDS
        result = pending
        while time.monotonic() < deadline:
            time.sleep(_LOAD_POLL_INTERVAL)
            value = _safe_getvar(doc, "USERS5", pending)
            result = str(value or "")
            if result.startswith(ok_prefix) or result.startswith(err_prefix):
                break

        # Give AutoCAD a moment to flush the command history before reading it.
        time.sleep(0.15)
        log_tail = _read_log_tail(log_path, log_start)

        if result.startswith(ok_prefix):
            return {
                "loaded": True,
                "path": relative,
                "error": None,
                "log_tail": log_tail[-4000:] if log_tail else "",
                "note": "AutoCAD reached the verified LISP load-success sentinel.",
            }

        if result.startswith(err_prefix):
            message = result[len(err_prefix) :].strip() or "AutoLISP load returned an unspecified error"
            return {
                "loaded": False,
                "path": relative,
                "error": message,
                "log_tail": log_tail[-8000:] if log_tail else "",
                "note": "Fix the source and run static validation + verified load again before handoff.",
            }

        return {
            "loaded": False,
            "path": relative,
            "error": "AutoCAD did not reach the LISP load-success sentinel before timeout.",
            "log_tail": log_tail[-8000:] if log_tail else "",
            "note": "Inspect the command-history evidence; do not run the Lisp command until load is verified.",
        }
    finally:
        _safe_setvar(doc, "USERS5", previous_users5 if isinstance(previous_users5, str) else str(previous_users5 or ""))
        if previous_log_mode is not None:
            _safe_setvar(doc, "LOGFILEMODE", int(previous_log_mode))


def run_lisp_command(name: str, args: list | None = None) -> dict:
    if not isinstance(name, str) or not name.strip():
        raise LispServiceError("command name is required")
    command_name = name.strip()
    if not _COMMAND_NAME.fullmatch(command_name):
        raise LispServiceError("command name contains unsupported characters")

    values = [] if args is None else args
    if not isinstance(values, (list, tuple)):
        raise LispServiceError("args must be a list")
    serialized = [_serialize_arg(value) for value in values]
    command = command_name if not serialized else f"{command_name} " + " ".join(serialized)
    _send(command)
    return {
        "queued": True,
        "name": command_name,
        "arg_count": len(serialized),
        "note": "Command execution is asynchronous; verify its post-condition with structured CAD read tools.",
    }
