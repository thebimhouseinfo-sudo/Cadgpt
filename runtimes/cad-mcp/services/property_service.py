"""Read complete direct properties for one or many AutoCAD entities.

This service is intentionally entity-generic. It resolves requested handles
directly through the active CadGPT-bound document and reads direct COM
properties only. It never enumerates the whole drawing and does not traverse
nested entities or block definitions.
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


def _normalize_handles(handles: list[str]) -> list[str]:
    if not isinstance(handles, list) or not handles:
        raise PropertyServiceError("handles must be a non-empty list")
    result: list[str] = []
    for handle in handles:
        if not isinstance(handle, str) or not handle.strip():
            raise PropertyServiceError("every handle must be a non-empty string")
        result.append(handle.strip())
    return result


def _top_level_owner_map(doc, include_paper_space: bool) -> dict[int, str]:
    owners: dict[int, str] = {int(doc.ModelSpace.ObjectID): "ModelSpace"}
    if include_paper_space:
        for layout in doc.Layouts:
            try:
                name = str(layout.Name)
                if name.casefold() == "model":
                    continue
                block = layout.Block
                owners[int(block.ObjectID)] = f"Layout:{name}"
            except Exception:
                continue
    return owners


def read_entities_properties(
    handles: list[str],
    include_paper_space: bool = True,
) -> dict:
    requested = _normalize_handles(handles)
    doc = _doc()
    owner_map = _top_level_owner_map(doc, include_paper_space)

    entities: list[dict] = []
    missing: list[str] = []
    non_top_level: list[str] = []

    for handle in requested:
        try:
            entity = _retry(lambda h=handle: doc.HandleToObject(h))
        except Exception:
            missing.append(handle)
            continue

        try:
            owner_id = int(entity.OwnerID)
        except Exception:
            missing.append(handle)
            continue

        space_name = owner_map.get(owner_id)
        if space_name is None:
            non_top_level.append(handle)
            continue

        snapshot = read_direct_properties(entity)
        snapshot["space"] = space_name
        entities.append(snapshot)

    return {
        "document_name": str(doc.Name),
        "requested_count": len(requested),
        "found_count": len(entities),
        "entities": entities,
        "missing_handles": missing,
        "non_top_level_handles": non_top_level,
        "nested_traversal": False,
        "full_drawing_scan": False,
    }
