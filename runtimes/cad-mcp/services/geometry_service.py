"""Explicit Line and Arc geometry updates for the CadGPT-bound drawing."""

from __future__ import annotations

from services.entity_service import _find_entity
from utils.com_geometry import (
    GeometryValueError,
    com_point,
    json_point,
    numeric,
    point3,
    positive_numeric,
)
from utils.entity_mapper import entity_type


class GeometryServiceError(RuntimeError):
    pass


def _typed_entity(handle: str, expected_type: str):
    if not isinstance(handle, str) or not handle.strip():
        raise GeometryServiceError("handle is required")
    _doc, _space, entity = _find_entity(handle.strip())
    if entity is None:
        raise GeometryServiceError(f"Supported entity with handle '{handle}' was not found")
    actual = entity_type(entity)
    if actual != expected_type:
        raise GeometryServiceError(
            f"Entity with handle '{handle}' is {actual or 'unsupported'}, expected {expected_type}"
        )
    return entity


def update_line(
    handle: str,
    start_point: list[float] | None = None,
    end_point: list[float] | None = None,
) -> dict:
    if start_point is None and end_point is None:
        raise GeometryServiceError("provide start_point, end_point, or both")
    try:
        start = point3(start_point, "start_point") if start_point is not None else None
        end = point3(end_point, "end_point") if end_point is not None else None
    except GeometryValueError as exc:
        raise GeometryServiceError(str(exc)) from exc

    entity = _typed_entity(handle, "line")
    old = {
        "start_point": json_point(entity.StartPoint),
        "end_point": json_point(entity.EndPoint),
    }
    try:
        if start is not None:
            entity.StartPoint = com_point(start)
        if end is not None:
            entity.EndPoint = com_point(end)
    except Exception as exc:
        raise GeometryServiceError(str(exc)) from exc
    return {
        "handle": handle,
        "changed": True,
        "old": old,
        "new": {
            "start_point": json_point(entity.StartPoint),
            "end_point": json_point(entity.EndPoint),
        },
    }


def update_arc(
    handle: str,
    center: list[float] | None = None,
    radius: float | None = None,
    start_angle: float | None = None,
    end_angle: float | None = None,
) -> dict:
    if center is None and radius is None and start_angle is None and end_angle is None:
        raise GeometryServiceError("provide at least one arc property to update")
    try:
        center_value = point3(center, "center") if center is not None else None
        radius_value = positive_numeric(radius, "radius") if radius is not None else None
        start_value = numeric(start_angle, "start_angle") if start_angle is not None else None
        end_value = numeric(end_angle, "end_angle") if end_angle is not None else None
    except GeometryValueError as exc:
        raise GeometryServiceError(str(exc)) from exc

    entity = _typed_entity(handle, "arc")
    old = {
        "center": json_point(entity.Center),
        "radius": float(entity.Radius),
        "start_angle": float(entity.StartAngle),
        "end_angle": float(entity.EndAngle),
    }
    try:
        if center_value is not None:
            entity.Center = com_point(center_value)
        if radius_value is not None:
            entity.Radius = radius_value
        if start_value is not None:
            entity.StartAngle = start_value
        if end_value is not None:
            entity.EndAngle = end_value
    except Exception as exc:
        raise GeometryServiceError(str(exc)) from exc
    return {
        "handle": handle,
        "changed": True,
        "old": old,
        "new": {
            "center": json_point(entity.Center),
            "radius": float(entity.Radius),
            "start_angle": float(entity.StartAngle),
            "end_angle": float(entity.EndAngle),
        },
    }
