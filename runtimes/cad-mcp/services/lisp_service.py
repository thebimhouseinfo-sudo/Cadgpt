"""Sandboxed AutoLISP execution bridge for the CadGPT-bound drawing.

File editing belongs to CadGPT's outer managed-AppData tools. This service only
loads existing .lsp files from explicit CadGPT namespaces and invokes named
AutoCAD commands on the already-bound drawing. Raw arbitrary SendCommand is
intentionally not exposed.

Allowed load namespaces:
- resources/cad/**                         internal CadGPT fixtures/bundled Lisp/resources
- appdata/libraries/lisp/**               managed user Lisp libraries
- appdata/workspace/lisp-draft/**         write-lisp working drafts
- appdata/runtime/dynamic-lisp/**         parameterized/session-only artifacts
- appdata/workspace/job-draft/**/lisp/**   Job-owned static helpers under authoring
- appdata/workspace/job-draft/**/dynamic-lisp/** Job-owned dynamic derivatives under authoring
- appdata/libraries/jobs/**/lisp/**        promoted Job-owned static helpers
- appdata/libraries/jobs/**/dynamic-lisp/** promoted Job-owned dynamic derivatives

External user source folders are never accepted here. They must first be
imported into managed AppData through the outer library_import workflow.

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
_CALL_TIMEOUT_SECONDS = 8.0


def _repo_root() -> str:
    services_dir = os.path.dirname(os.path.abspath(__file__))
    cad_mcp_dir = os.path.dirname(services_dir)
    runtimes_dir = os.path.dirname(cad_mcp_dir)
    return os.path.dirname(runtimes_dir)


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


def _is_job_owned_lisp_path(candidate: str, root: str) -> bool:
    relative = os.path.relpath(candidate, root).replace("\\", "/")
    parts = [
        part.lower()
        for part in relative.split("/")
        if part not in ("", ".")
    ]
    if len(parts) < 2:
        return False
    return any(
        part in {"lisp", "dynamic-lisp"}
        for part in parts[:-1]
    )


def _resolve_lisp_path(input_path: str) -> tuple[str, str]:
    if not isinstance(input_path, str) or not input_path.strip():
        raise LispServiceError("path is required")

    raw = input_path.strip()
    normalized = raw.replace("\\", "/")
    roots = [
        (os.path.realpath(os.path.join(_repo_root(), "resources", "cad")), "resources/cad"),
        (os.path.realpath(os.path.join(_appdata_root(), "libraries", "lisp")), "appdata/libraries/lisp"),
        (os.path.realpath(os.path.join(_appdata_root(), "workspace", "lisp-draft")), "appdata/workspace/lisp-draft"),
        (os.path.realpath(os.path.join(_appdata_root(), "runtime", "dynamic-lisp")), "appdata/runtime/dynamic-lisp"),
        (os.path.realpath(os.path.join(_appdata_root(), "workspace", "job-draft")), "appdata/workspace/job-draft"),
        (os.path.realpath(os.path.join(_appdata_root(), "libraries", "jobs")), "appdata/libraries/jobs"),
    ]

    if os.path.isabs(raw):
        candidate = os.path.realpath(raw)
        match = next(((root, prefix) for root, prefix in roots if _inside(candidate, root)), None)
        if not match:
            raise LispServiceError("absolute LISP path is outside approved CadGPT Lisp roots")
        root, virtual_prefix = match
    else:
        normalized = normalized[2:] if normalized.startswith("./") else normalized
        lower = normalized.lower()

        if lower.startswith("resources/cad/"):
            suffix = normalized[len("resources/cad/") :]
            root, virtual_prefix = roots[0]
        elif lower.startswith("appdata/libraries/lisp/"):
            suffix = normalized[len("appdata/libraries/lisp/") :]
            root, virtual_prefix = roots[1]
        elif lower.startswith("appdata/workspace/lisp-draft/"):
            suffix = normalized[len("appdata/workspace/lisp-draft/") :]
            root, virtual_prefix = roots[2]
        elif lower.startswith("appdata/runtime/dynamic-lisp/"):
            suffix = normalized[len("appdata/runtime/dynamic-lisp/") :]
            root, virtual_prefix = roots[3]
        elif lower.startswith("appdata/workspace/job-draft/"):
            suffix = normalized[len("appdata/workspace/job-draft/") :]
            root, virtual_prefix = roots[4]
        elif lower.startswith("appdata/libraries/jobs/"):
            suffix = normalized[len("appdata/libraries/jobs/") :]
            root, virtual_prefix = roots[5]
        else:
            raise LispServiceError(
                "LISP path must be under resources/cad/**, appdata/libraries/lisp/**, "
                "appdata/workspace/lisp-draft/**, appdata/runtime/dynamic-lisp/**, "
                "appdata/workspace/job-draft/**/(lisp|dynamic-lisp)/**, or "
                "appdata/libraries/jobs/**/(lisp|dynamic-lisp)/**"
            )

        candidate = os.path.realpath(os.path.join(root, suffix))
        if not _inside(candidate, root):
            raise LispServiceError(f"LISP path escapes the {virtual_prefix}/** sandbox")
    if virtual_prefix in {
        "appdata/workspace/job-draft",
        "appdata/libraries/jobs",
    }:
        if not _is_job_owned_lisp_path(candidate, root):
            raise LispServiceError(
                "Job-owned LISP is loadable only from a Job lisp/** or dynamic-lisp/** folder"
            )
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


def _serialize_lisp_value(value) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise LispServiceError("Lisp function args may contain only strings or numbers")
    if isinstance(value, str):
        if any(ch in value for ch in ("\n", "\r", "\x00")):
            raise LispServiceError("Lisp function string args cannot contain line breaks or NUL")
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return str(value)


def run_lisp_function_sync(
    name: str,
    args: list | None = None,
    timeout_seconds: float = _CALL_TIMEOUT_SECONDS,
) -> str:
    """Call one already-loaded Lisp function and synchronously return its string result.

    This is an internal runtime bridge, not an MCP surface. Result/error transfer
    uses USERS5 only for the duration of the call and restores the previous value.
    """
    if not isinstance(name, str) or not name.strip():
        raise LispServiceError("Lisp function name is required")
    function_name = name.strip()
    if not _COMMAND_NAME.fullmatch(function_name):
        raise LispServiceError("Lisp function name contains unsupported characters")

    values = [] if args is None else args
    if not isinstance(values, (list, tuple)):
        raise LispServiceError("Lisp function args must be a list")
    serialized = [_serialize_lisp_value(value) for value in values]
    arg_list = "(list" + ((" " + " ".join(serialized)) if serialized else "") + ")"

    doc = get_active_document()
    token = uuid.uuid4().hex[:12]
    pending = f"CADGPT_SYNC_PENDING:{token}"
    ok_prefix = f"CADGPT_SYNC_OK:{token}:"
    err_prefix = f"CADGPT_SYNC_ERR:{token}:"
    previous_users5 = _safe_getvar(doc, "USERS5", "")

    expression = (
        "(progn "
        "(vl-load-com) "
        f"(setq *cadgpt-sync-result* (vl-catch-all-apply '{function_name} {arg_list})) "
        "(cond "
        "((vl-catch-all-error-p *cadgpt-sync-result*) "
        f"(setvar \"USERS5\" (strcat \"{err_prefix}\" (substr (vl-catch-all-error-message *cadgpt-sync-result*) 1 160)))) "
        "((= (type *cadgpt-sync-result*) 'STR) "
        f"(setvar \"USERS5\" (strcat \"{ok_prefix}\" *cadgpt-sync-result*))) "
        "(T "
        f"(setvar \"USERS5\" \"{err_prefix}Lisp function did not return a string\"))) "
        "(princ))"
    )

    _safe_setvar(doc, "USERS5", pending)
    try:
        _send(expression)
        deadline = time.monotonic() + max(0.25, float(timeout_seconds))
        result = pending
        while time.monotonic() < deadline:
            time.sleep(_LOAD_POLL_INTERVAL)
            result = str(_safe_getvar(doc, "USERS5", pending) or "")
            if result.startswith(ok_prefix) or result.startswith(err_prefix):
                break

        if result.startswith(ok_prefix):
            return result[len(ok_prefix) :]
        if result.startswith(err_prefix):
            raise LispServiceError(
                result[len(err_prefix) :].strip()
                or "AutoLISP function returned an unspecified error"
            )
        raise LispServiceError(
            "AutoCAD did not return the Lisp function result before timeout."
        )
    finally:
        _safe_setvar(
            doc,
            "USERS5",
            previous_users5
            if isinstance(previous_users5, str)
            else str(previous_users5 or ""),
        )


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
    load_dir = os.path.dirname(lisp_path).replace("\\", "/")
    return (
        "(progn "
        "(vl-load-com) "
        f"(setq *cadgpt-load-dir* \"{load_dir}\") "
        f"(setq *cadgpt-load-result* (vl-catch-all-apply 'load (list \"{lisp_path}\"))) "
        "(setq *cadgpt-load-dir* nil) "
        "(if (vl-catch-all-error-p *cadgpt-load-result*) "
        f"(setvar \"USERS5\" (strcat \"{err}\" (substr (vl-catch-all-error-message *cadgpt-load-result*) 1 180))) "
        f"(setvar \"USERS5\" \"{ok}\")) "
        "(princ))"
    )


def load_lisp_file(path: str) -> dict:
    """Load one sandboxed Lisp file and verify AutoCAD reached a success sentinel."""
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

        time.sleep(0.15)
        log_tail = _read_log_tail(log_path, log_start)

        if result.startswith(ok_prefix):
            return {
                "loaded": True,
                "path": relative,
                "error": None,
                "log_tail": log_tail[-4000:] if log_tail else "",
                "note": "AutoCAD reached the verified Lisp load-success sentinel.",
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
            "error": "AutoCAD did not reach the Lisp load-success sentinel before timeout.",
            "log_tail": log_tail[-8000:] if log_tail else "",
            "note": "Inspect command-history evidence; do not run the Lisp command until load is verified.",
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
