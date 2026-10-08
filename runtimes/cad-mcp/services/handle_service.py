"""Resolve exact AutoCAD handles without repeatedly enumerating the full drawing.

A handle is only accepted for a top-level ModelSpace/PaperSpace entity in the
currently bound document. Nested ATTRIBs and objects inside block definitions
are never returned as deletion/mutation targets.
"""
from __future__ import annotations

import re
import time

import pywintypes
from connection.acad import get_active_document

_HANDLE = re.compile(r"^[0-9a-fA-F]{1,32}$")
_BUSY_COM_HRESULTS = {-2147418111, -2147417846, -2147417845}


class HandleResolutionError(RuntimeError):
    pass


def normalize_handle(handle: str) -> str:
    if not isinstance(handle, str) or not _HANDLE.fullmatch(handle.strip()):
        raise HandleResolutionError("A non-empty hexadecimal AutoCAD handle is required")
    return handle.strip().upper()


def read_com(call, attempts: int = 4, delay: float = 0.08):
    """Retry only COM 'server busy' reads, never an uncertain mutating call."""
    for attempt in range(attempts):
        try:
            return call()
        except pywintypes.com_error as exc:
            if getattr(exc, "hresult", None) not in _BUSY_COM_HRESULTS or attempt == attempts - 1:
                raise
            time.sleep(delay * (attempt + 1))


def top_level_owner_map(doc, include_paper_space: bool = True) -> dict[int, str]:
    owners = {int(read_com(lambda: doc.ModelSpace.ObjectID)): "ModelSpace"}
    if include_paper_space:
        for layout in read_com(lambda: doc.Layouts):
            try:
                name = str(read_com(lambda: layout.Name))
                if name.casefold() != "model":
                    block = read_com(lambda: layout.Block)
                    owners[int(read_com(lambda: block.ObjectID))] = "Layout:" + name
            except Exception:
                # One inaccessible paper-space layout must not grant access to it.
                continue
    return owners


def resolve_top_level(handle: str, include_paper_space: bool = True, doc=None):
    needle = normalize_handle(handle)
    if doc is None:
        doc = get_active_document()
    try:
        entity = read_com(lambda: doc.HandleToObject(needle))
    except pywintypes.com_error as exc:
        if getattr(exc, "hresult", None) in _BUSY_COM_HRESULTS:
            raise HandleResolutionError("AutoCAD COM remained busy while resolving handle " + needle) from exc
        # Never classify an arbitrary COM failure as a deleted entity.
        # Otherwise a failed verification could falsely report delete success.
        message = str(exc).casefold()
        if any(value in message for value in ("invalid handle", "invalid object handle", "unknown handle", "handle not found", "object was erased")):
            return doc, None, None
        raise HandleResolutionError(
            "AutoCAD could not resolve handle " + needle + " reliably: " + str(exc)
        ) from exc
    except (ValueError, KeyError):
        return doc, None, None

    try:
        if str(read_com(lambda: entity.Handle)).upper() != needle:
            raise HandleResolutionError("AutoCAD returned an entity with a different handle")
        owner_id = int(read_com(lambda: entity.OwnerID))
        space = top_level_owner_map(doc, include_paper_space).get(owner_id)
    except (pywintypes.com_error, TypeError, ValueError) as exc:
        raise HandleResolutionError("Unable to verify top-level ownership for " + needle) from exc

    # A found but nested object must NOT be treated as a missing top-level
    # target eligible for a different mutation path.
    return doc, space, entity if space else None
