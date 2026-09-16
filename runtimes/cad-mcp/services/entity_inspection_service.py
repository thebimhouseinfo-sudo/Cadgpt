"""Read-only structured entity inspection for the CadGPT bound drawing."""

from __future__ import annotations

import time

import pywintypes

from connection.session import document_identity, get_document
from utils.entity_mapper import entity_to_dict, is_supported_entity
from utils.filters import FilterError, matches_entity, normalize_filter


class EntityInspectionServiceError(RuntimeError):
    pass


def _document(document_name: str):
    if not document_name:
        raise EntityInspectionServiceError("document_name is required")
    try:
        return get_document(document_name)
    except ValueError as exc:
        raise EntityInspectionServiceError(str(exc)) from exc


def _retry_com(call, attempts: int = 3, delay: float = 0.05):
    last_error = None
    for attempt in range(attempts):
        try:
            return call()
        except pywintypes.com_error as exc:
            last_error = exc
            time.sleep(delay * (attempt + 1))
    raise last_error


def _iter_space_entities(space):
    try:
        count = _retry_com(lambda: space.Count)
    except Exception:
        return
    for index in range(count):
        try:
            entity = _retry_com(lambda idx=index: space.Item(idx))
            if entity is not None:
                yield entity
        except Exception:
            continue


def _iter_spaces(doc, include_paper_space: bool):
    yield "ModelSpace", doc.ModelSpace
    if include_paper_space:
        for layout in doc.Layouts:
            try:
                if str(layout.Name).lower() != "model":
                    yield f"Layout:{layout.Name}", layout.Block
            except Exception:
                continue


def _iter_supported(doc, include_paper_space: bool):
    for space_name, space in _iter_spaces(doc, include_paper_space):
        for entity in _iter_space_entities(space):
            if is_supported_entity(entity):
                yield space_name, entity


def _matching(doc, filter_data: dict, include_paper_space: bool):
    result = []
    for space_name, entity in _iter_supported(doc, include_paper_space):
        data = entity_to_dict(entity)
        if matches_entity(data, filter_data):
            result.append({**data, "space": space_name})
            if len(result) >= filter_data["limit"]:
                break
    return result


def list_entities(
    document_name: str,
    filter_data: dict | None = None,
    include_paper_space: bool = False,
) -> dict:
    """List supported entities without mutating drawing state."""
    try:
        normalized = normalize_filter(filter_data)
    except FilterError as exc:
        raise EntityInspectionServiceError(str(exc)) from exc

    doc = _document(document_name)
    entities = _matching(doc, normalized, include_paper_space)

    # Preserve the useful legacy behavior: if ModelSpace has no match, search
    # layouts so a query does not silently miss sheet-only annotation.
    searched_paper_space_fallback = False
    if not entities and not include_paper_space:
        all_spaces = _matching(doc, normalized, True)
        entities = [item for item in all_spaces if item.get("space") != "ModelSpace"]
        searched_paper_space_fallback = bool(entities)

    return {
        "drawing": document_identity(doc),
        "filter": normalized,
        "include_paper_space": include_paper_space,
        "paper_space_fallback": searched_paper_space_fallback,
        "count": len(entities),
        "entities": entities,
    }


def get_entity(
    document_name: str,
    handle: str,
    include_paper_space: bool = True,
) -> dict:
    """Get one supported entity by handle without mutating drawing state."""
    if not handle:
        raise EntityInspectionServiceError("handle is required")

    doc = _document(document_name)
    needle = handle.lower()
    for space_name, entity in _iter_supported(doc, include_paper_space):
        try:
            if str(entity.Handle).lower() == needle:
                return {
                    "drawing": document_identity(doc),
                    "space": space_name,
                    "entity": entity_to_dict(entity),
                }
        except Exception:
            continue
    raise EntityInspectionServiceError(f"Supported entity with handle '{handle}' was not found")
