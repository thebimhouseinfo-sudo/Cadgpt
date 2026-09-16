"""Read complete direct properties for one or many AutoCAD entities.

This service is intentionally entity-generic. It accepts handles, finds the
corresponding top-level entities in the active CadGPT-bound drawing, and reads
direct COM properties only. It does not traverse nested entities or block
definitions.
"""

from __future__ import annotations

import time

import pywintypes

from connection.acad import get_active_document
from utils.property_reader import read_direct_properties


class PropertyServiceError(RuntimeError):
    pass


def _doc():
    try:
        return get_active_document()
    except Exception as exc:
        raise PropertyServiceError(str(exc)) from exc


def _retry(call, attempts: int = 3, delay: float = 0.05):
    last_error = None
    for attempt in range(attempts):
        try:
            return call()
        except pywintypes.com_error as exc:
            last_error = exc
            time.sleep(delay * (attempt + 1))
    raise last_error


def _spaces(doc, include_paper_space: bool):
    yield "ModelSpace", doc.ModelSpace
    if include_paper_space:
        for layout in doc.Layouts:
            try:
                if str(layout.Name).lower() != "model":
                    yield f"Layout:{layout.Name}", layout.Block
            except Exception:
                continue


def _entities(space):
    try:
        count = int(_retry(lambda: space.Count))
    except Exception:
        return
    for index in range(count):
        try:
            entity = _retry(lambda idx=index: space.Item(idx))
            if entity is not None:
                yield entity
        except Exception:
            continue


def _normalize_handles(handles: list[str]) -> list[str]:
    if not isinstance(handles, list) or not handles:
        raise PropertyServiceError("handles must be a non-empty list")
    result: list[str] = []
    for handle in handles:
        if not isinstance(handle, str) or not handle.strip():
            raise PropertyServiceError("every handle must be a non-empty string")
        result.append(handle.strip())
    return result


def read_entities_properties(
    handles: list[str],
    include_paper_space: bool = True,
) -> dict:
    requested = _normalize_handles(handles)
    wanted = {handle.lower() for handle in requested}
    found: dict[str, dict] = {}
    doc = _doc()

    for space_name, space in _spaces(doc, include_paper_space):
        for entity in _entities(space):
            try:
                handle = str(entity.Handle)
            except Exception:
                continue
            key = handle.lower()
            if key not in wanted or key in found:
                continue
            snapshot = read_direct_properties(entity)
            snapshot["space"] = space_name
            found[key] = snapshot
            if len(found) == len(wanted):
                break
        if len(found) == len(wanted):
            break

    entities = [found[handle.lower()] for handle in requested if handle.lower() in found]
    missing = [handle for handle in requested if handle.lower() not in found]
    return {
        "document_name": str(doc.Name),
        "requested_count": len(requested),
        "found_count": len(entities),
        "entities": entities,
        "missing_handles": missing,
        "nested_traversal": False,
    }
