"""Sandboxed AutoLISP execution bridge for the CadGPT-bound drawing.

File editing belongs to CadGPT's outer file tools. This service only loads
existing .lsp files from the repository lisp/** sandbox and queues named
AutoCAD commands on the already-bound drawing. Raw arbitrary SendCommand is
intentionally not exposed.
"""

from __future__ import annotations

import os
import re
import time

import pywintypes

from connection.acad import get_active_document


class LispServiceError(RuntimeError):
    pass


_COMMAND_NAME = re.compile(r"^[A-Za-z0-9_+\-.$:]+$")


def _repo_root() -> str:
    services_dir = os.path.dirname(os.path.abspath(__file__))
    cad_mcp_dir = os.path.dirname(services_dir)
    runtimes_dir = os.path.dirname(cad_mcp_dir)
    return os.path.dirname(runtimes_dir)


def _lisp_root() -> str:
    return os.path.realpath(os.path.join(_repo_root(), "lisp"))


def _resolve_lisp_path(input_path: str) -> tuple[str, str]:
    if not isinstance(input_path, str) or not input_path.strip():
        raise LispServiceError("path is required")

    raw = input_path.strip().replace("\\", "/")
    if os.path.isabs(raw):
        raise LispServiceError("absolute paths are not allowed; use a repository-relative lisp/** path")

    normalized = raw[2:] if raw.startswith("./") else raw
    if normalized.lower().startswith("lisp/"):
        normalized = normalized[5:]
    candidate = os.path.realpath(os.path.join(_lisp_root(), normalized))
    root = _lisp_root()
    try:
        inside = os.path.commonpath([candidate, root]) == root
    except ValueError:
        inside = False
    if not inside:
        raise LispServiceError("LISP path escapes the repository lisp/** sandbox")
    if os.path.splitext(candidate)[1].lower() != ".lsp":
        raise LispServiceError("only .lsp files can be loaded")
    if not os.path.isfile(candidate):
        raise LispServiceError(f"LISP file was not found: lisp/{normalized}")
    relative = os.path.relpath(candidate, _repo_root()).replace("\\", "/")
    return candidate, relative


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


def load_lisp_file(path: str) -> dict:
    absolute, relative = _resolve_lisp_path(path)
    lisp_path = absolute.replace("\\", "/")
    # Windows file names cannot contain a double quote; normalized forward
    # slashes make the path safe for AutoLISP's load expression.
    expression = f'(load "{lisp_path}")'
    _send(expression)
    return {
        "queued": True,
        "path": relative,
        "note": "LISP load is asynchronous; verify by running a known command or inspecting drawing state.",
    }


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
