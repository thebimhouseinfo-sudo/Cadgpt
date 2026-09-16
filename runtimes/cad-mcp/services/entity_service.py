"""Read-only structured entity inspection for the CadGPT-bound drawing."""

from __future__ import annotations

import time
import pywintypes

from connection.acad import get_active_document
from utils.entity_mapper import entity_to_dict, is_supported_entity
from utils.filters import FilterError, matches_entity, normalize_filter


class EntityServiceError(RuntimeError):
    pass


def _doc():
    try:
        return get_active_document()
    except Exception as exc:
        raise EntityServiceError(str(exc)) from exc


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


def list_entities(filter: dict | None = None, include_paper_space: bool = False) -> list[dict]:
    try:
        normalized = normalize_filter(filter)
    except FilterError as exc:
        raise EntityServiceError(str(exc)) from exc

    doc = _doc()
    result: list[dict] = []
    for space_name, space in _spaces(doc, include_paper_space):
        for entity in _entities(space):
            if not is_supported_entity(entity):
                continue
            data = entity_to_dict(entity)
            if matches_entity(data, normalized):
                result.append({**data, "space": space_name})
                if len(result) >= normalized["limit"]:
                    return result
    return result


def get_entity(handle: str, include_paper_space: bool = True) -> dict:
    if not handle:
        raise EntityServiceError("handle is required")
    needle = handle.lower()
    doc = _doc()
    for space_name, space in _spaces(doc, include_paper_space):
        for entity in _entities(space):
            if not is_supported_entity(entity):
                continue
            try:
                if str(entity.Handle).lower() != needle:
                    continue
            except Exception:
                continue
            return {**entity_to_dict(entity), "space": space_name}
    raise EntityServiceError(f"Supported entity with handle '{handle}' was not found")
