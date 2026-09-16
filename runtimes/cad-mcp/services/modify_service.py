"""Non-creating geometric transforms for the CadGPT-bound drawing.

Only existing entities identified by explicit handles are mutated. This phase
intentionally excludes COPY, MIRROR, EXPLODE and DELETE because those create or
destroy geometry and need a stronger preflight/verification contract.
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


def _report(changed: list[dict], skipped: list[dict], errors: list[dict]) -> dict:
    return {
        "matched": len(changed) + len(errors),
        "changed_count": len(changed),
        "changed": changed,
        "skipped": skipped,
        "errors": errors,
    }


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
