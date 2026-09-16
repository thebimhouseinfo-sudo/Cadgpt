"""Structured entity inspection and reversible property mutations.

CadGPT owns drawing selection in the outer MCP session. This service operates
only on AutoCAD's current document after the outer proxy re-activates the bound
DWG. Destructive delete and geometry-creation operations are intentionally
excluded from this phase.
"""

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


def _find_entity(handle: str, include_paper_space: bool = True):
    needle = handle.lower()
    doc = _doc()
    for space_name, space in _spaces(doc, include_paper_space):
        for entity in _entities(space):
            if not is_supported_entity(entity):
                continue
            try:
                if str(entity.Handle).lower() == needle:
                    return doc, space_name, entity
            except Exception:
                continue
    return doc, None, None


def _require_handles(handles: list[str]) -> list[str]:
    if not isinstance(handles, list) or not handles:
        raise EntityServiceError("handles must be a non-empty list")
    result = []
    for handle in handles:
        if not isinstance(handle, str) or not handle.strip():
            raise EntityServiceError("every handle must be a non-empty string")
        result.append(handle.strip())
    return result


def _mutation_report(changed: list[dict], skipped: list[dict], errors: list[dict]) -> dict:
    return {
        "matched": len(changed) + len(errors),
        "changed_count": len(changed),
        "changed": changed,
        "skipped": skipped,
        "errors": errors,
    }


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
    _doc_obj, space_name, entity = _find_entity(handle, include_paper_space)
    if entity is None:
        raise EntityServiceError(f"Supported entity with handle '{handle}' was not found")
    return {**entity_to_dict(entity), "space": space_name}


def set_entity_layer(handles: list[str], layer: str) -> dict:
    handles = _require_handles(handles)
    target_name = layer.strip()
    if not target_name:
        raise EntityServiceError("layer is required")
    doc = _doc()
    target = None
    for candidate in doc.Layers:
        if str(candidate.Name).lower() == target_name.lower():
            target = str(candidate.Name)
            break
    if target is None:
        raise EntityServiceError(f"layer '{layer}' was not found")

    changed, skipped, errors = [], [], []
    for handle in handles:
        _doc_obj, _space, entity = _find_entity(handle)
        if entity is None:
            skipped.append({"handle": handle, "reason": "not found"})
            continue
        try:
            before = str(entity.Layer)
            entity.Layer = target
            changed.append({"handle": handle, "old_layer": before, "new_layer": target})
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})
    return _mutation_report(changed, skipped, errors)


def set_entity_color(handles: list[str], color_aci: int) -> dict:
    handles = _require_handles(handles)
    if isinstance(color_aci, bool) or not isinstance(color_aci, int) or not 0 <= color_aci <= 256:
        raise EntityServiceError("color_aci must be an integer from 0 to 256")

    changed, skipped, errors = [], [], []
    for handle in handles:
        _doc_obj, _space, entity = _find_entity(handle)
        if entity is None:
            skipped.append({"handle": handle, "reason": "not found"})
            continue
        try:
            before = int(entity.Color)
            entity.Color = color_aci
            changed.append({"handle": handle, "old_color_aci": before, "color_aci": color_aci})
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})
    return _mutation_report(changed, skipped, errors)


def set_entity_visibility(handles: list[str], visible: bool) -> dict:
    handles = _require_handles(handles)
    changed, skipped, errors = [], [], []
    for handle in handles:
        _doc_obj, _space, entity = _find_entity(handle)
        if entity is None:
            skipped.append({"handle": handle, "reason": "not found"})
            continue
        try:
            before = bool(entity.Visible)
            entity.Visible = bool(visible)
            changed.append({"handle": handle, "old_visible": before, "visible": bool(visible)})
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})
    return _mutation_report(changed, skipped, errors)


def set_entity_linetype(handles: list[str], linetype: str) -> dict:
    handles = _require_handles(handles)
    requested = linetype.strip()
    if not requested:
        raise EntityServiceError("linetype is required")
    doc = _doc()
    resolved = None
    if requested.lower() in {"bylayer", "byblock"}:
        resolved = "ByLayer" if requested.lower() == "bylayer" else "ByBlock"
    else:
        for candidate in doc.Linetypes:
            if str(candidate.Name).lower() == requested.lower():
                resolved = str(candidate.Name)
                break
    if resolved is None:
        raise EntityServiceError(f"linetype '{linetype}' is not loaded in the drawing")

    changed, skipped, errors = [], [], []
    for handle in handles:
        _doc_obj, _space, entity = _find_entity(handle)
        if entity is None:
            skipped.append({"handle": handle, "reason": "not found"})
            continue
        try:
            before = str(entity.Linetype)
            entity.Linetype = resolved
            changed.append({"handle": handle, "old_linetype": before, "linetype": resolved})
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})
    return _mutation_report(changed, skipped, errors)
