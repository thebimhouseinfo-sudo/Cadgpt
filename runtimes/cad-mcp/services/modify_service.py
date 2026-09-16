"""Bounded geometric transforms for the CadGPT-bound drawing.

Existing-entity transforms mutate explicit handles. COPY and MIRROR may create
new entities but never delete their source in this phase. EXPLODE and DELETE
remain excluded because they need destructive preflight and verification.
"""

from __future__ import annotations

from services.entity_service import _find_entity
from utils.com_geometry import GeometryValueError, com_point, numeric, point3, positive_numeric


class ModifyServiceError(RuntimeError):
    pass


def _handles(handles: list[str]) -> list[str]:
    if not isinstance(handles, list) or not handles:
        raise ModifyServiceError("handles must be a non-empty list")
    result: list[str] = []
    for handle in handles:
        if not isinstance(handle, str) or not handle.strip():
            raise ModifyServiceError("every handle must be a non-empty string")
        result.append(handle.strip())
    return result


def _report(
    changed: list[dict],
    skipped: list[dict],
    errors: list[dict],
    new_handles: list[str] | None = None,
) -> dict:
    result = {
        "matched": len(changed) + len(errors),
        "changed_count": len(changed),
        "changed": changed,
        "skipped": skipped,
        "errors": errors,
    }
    if new_handles is not None:
        result["new_handles"] = new_handles
        result["created_count"] = len(new_handles)
    return result


def move_entities(handles: list[str], displacement: list[float]) -> dict:
    handles = _handles(handles)
    try:
        disp = point3(displacement, "displacement")
    except GeometryValueError as exc:
        raise ModifyServiceError(str(exc)) from exc

    changed, skipped, errors = [], [], []
    origin = com_point([0.0, 0.0, 0.0])
    target = com_point(disp)
    for handle in handles:
        _doc, _space, entity = _find_entity(handle)
        if entity is None:
            skipped.append({"handle": handle, "reason": "not found"})
            continue
        try:
            entity.Move(origin, target)
            changed.append({"handle": handle, "displacement": disp})
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})
    return _report(changed, skipped, errors)


def rotate_entities(handles: list[str], base_point: list[float], angle: float) -> dict:
    handles = _handles(handles)
    try:
        base = point3(base_point, "base_point")
        radians = numeric(angle, "angle")
    except GeometryValueError as exc:
        raise ModifyServiceError(str(exc)) from exc

    changed, skipped, errors = [], [], []
    base_com = com_point(base)
    for handle in handles:
        _doc, _space, entity = _find_entity(handle)
        if entity is None:
            skipped.append({"handle": handle, "reason": "not found"})
            continue
        try:
            entity.Rotate(base_com, radians)
            changed.append({"handle": handle, "base_point": base, "angle": radians})
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})
    return _report(changed, skipped, errors)


def scale_entities(handles: list[str], base_point: list[float], scale_factor: float) -> dict:
    handles = _handles(handles)
    try:
        base = point3(base_point, "base_point")
        factor = positive_numeric(scale_factor, "scale_factor")
    except GeometryValueError as exc:
        raise ModifyServiceError(str(exc)) from exc

    changed, skipped, errors = [], [], []
    base_com = com_point(base)
    for handle in handles:
        _doc, _space, entity = _find_entity(handle)
        if entity is None:
            skipped.append({"handle": handle, "reason": "not found"})
            continue
        try:
            entity.ScaleEntity(base_com, factor)
            changed.append({"handle": handle, "base_point": base, "scale_factor": factor})
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})
    return _report(changed, skipped, errors)


def copy_entities(handles: list[str], displacement: list[float]) -> dict:
    """Copy explicit entities and optionally displace the copies."""
    handles = _handles(handles)
    try:
        disp = point3(displacement, "displacement")
    except GeometryValueError as exc:
        raise ModifyServiceError(str(exc)) from exc

    changed, skipped, errors, new_handles = [], [], [], []
    origin = com_point([0.0, 0.0, 0.0])
    target = com_point(disp)
    for handle in handles:
        _doc, _space, entity = _find_entity(handle)
        if entity is None:
            skipped.append({"handle": handle, "reason": "not found"})
            continue
        try:
            copied = entity.Copy()
            if any(abs(value) > 0.0 for value in disp):
                copied.Move(origin, target)
            new_handle = str(copied.Handle)
            new_handles.append(new_handle)
            changed.append(
                {
                    "source_handle": handle,
                    "new_handle": new_handle,
                    "displacement": disp,
                }
            )
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})
    return _report(changed, skipped, errors, new_handles)


def mirror_entities(handles: list[str], point1: list[float], point2: list[float]) -> dict:
    """Mirror explicit entities and always preserve their source entities."""
    handles = _handles(handles)
    try:
        p1 = point3(point1, "point1")
        p2 = point3(point2, "point2")
    except GeometryValueError as exc:
        raise ModifyServiceError(str(exc)) from exc
    if p1 == p2:
        raise ModifyServiceError("point1 and point2 must define a non-zero mirror axis")

    changed, skipped, errors, new_handles = [], [], [], []
    p1_com = com_point(p1)
    p2_com = com_point(p2)
    for handle in handles:
        _doc, _space, entity = _find_entity(handle)
        if entity is None:
            skipped.append({"handle": handle, "reason": "not found"})
            continue
        try:
            mirrored = entity.Mirror(p1_com, p2_com)
            new_handle = str(mirrored.Handle)
            new_handles.append(new_handle)
            changed.append(
                {
                    "source_handle": handle,
                    "new_handle": new_handle,
                    "point1": p1,
                    "point2": p2,
                    "source_preserved": True,
                }
            )
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})
    return _report(changed, skipped, errors, new_handles)
