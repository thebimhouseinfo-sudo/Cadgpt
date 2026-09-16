"""Helpers for converting AutoCAD COM entities into JSON-safe dictionaries."""

from __future__ import annotations

import math
from typing import Any

SUPPORTED_ENTITY_TYPES = {
    "AcDbLine": "line",
    "AcDbPolyline": "polyline",
    "AcDb2dPolyline": "polyline",
    "AcDb3dPolyline": "polyline",
    "AcDbCircle": "circle",
    "AcDbArc": "arc",
    "AcDbEllipse": "ellipse",
    "AcDbSpline": "spline",
    "AcDbPoint": "point",
    "AcDbText": "text",
    "AcDbMText": "mtext",
    "AcDbHatch": "hatch",
    "AcDbMPolygon": "hatch",
    "AcDbWipeout": "wipeout",
    "AcDbSolid": "solid",
    "AcDbFace": "solid",
    "AcDbRegion": "solid",
    "AcDbBlockReference": "block",
    "AcDbAlignedDimension": "dimension",
    "AcDbRotatedDimension": "dimension",
    "AcDbRadialDimension": "dimension",
    "AcDbDiametricDimension": "dimension",
    "AcDbAngularDimension": "dimension",
    "AcDb3PointAngularDimension": "dimension",
    "AcDbArcDimension": "dimension",
    "AcDbOrdinateDimension": "dimension",
}


def _safe_get(obj: Any, attr: str, default: Any = None) -> Any:
    try:
        return getattr(obj, attr)
    except Exception:
        return default


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    try:
        return [_json_value(item) for item in value]
    except Exception:
        return str(value)


def _point(value: Any) -> list[float] | None:
    if value is None:
        return None
    try:
        return [float(item) for item in value]
    except Exception:
        return None


def _bbox(entity: Any) -> dict | None:
    try:
        min_point, max_point = entity.GetBoundingBox()
    except Exception:
        return None
    return {"min": _point(min_point), "max": _point(max_point)}


def entity_type(entity: Any) -> str | None:
    object_name = str(_safe_get(entity, "ObjectName", ""))
    mapped = SUPPORTED_ENTITY_TYPES.get(object_name)
    if mapped:
        return mapped
    name_lower = object_name.lower()
    if "hatch" in name_lower or "mpolygon" in name_lower:
        return "hatch"
    if "polyline" in name_lower or "lwpolyline" in name_lower:
        return "polyline"
    if "line" in name_lower and "polyline" not in name_lower:
        return "line"
    if "text" in name_lower:
        return "mtext" if "mtext" in name_lower else "text"
    if "dimension" in name_lower:
        return "dimension"
    if "blockreference" in name_lower or "insert" in name_lower:
        return "block"
    return None


def is_supported_entity(entity: Any) -> bool:
    return entity_type(entity) is not None


def entity_to_dict(entity: Any) -> dict:
    object_name = str(_safe_get(entity, "ObjectName", ""))
    mapped_type = entity_type(entity) or "unsupported"
    data = {
        "handle": str(_safe_get(entity, "Handle", "")),
        "object_name": object_name,
        "entity_type": mapped_type,
        "layer": str(_safe_get(entity, "Layer", "")),
        "color": _json_value(_safe_get(entity, "Color")),
        "linetype": _json_value(_safe_get(entity, "Linetype")),
        "visible": bool(_safe_get(entity, "Visible", True)),
        "bbox": _bbox(entity),
    }
    if mapped_type in {"text", "mtext"}:
        data.update({"text": _json_value(_safe_get(entity, "TextString", "")), "insertion_point": _point(_safe_get(entity, "InsertionPoint")), "height": _json_value(_safe_get(entity, "Height")), "rotation": _json_value(_safe_get(entity, "Rotation")), "style_name": _json_value(_safe_get(entity, "StyleName"))})
        if mapped_type == "mtext":
            data["width"] = _json_value(_safe_get(entity, "Width"))
    elif mapped_type == "line":
        data.update({"start_point": _point(_safe_get(entity, "StartPoint")), "end_point": _point(_safe_get(entity, "EndPoint")), "length": _json_value(_safe_get(entity, "Length"))})
    elif mapped_type == "polyline":
        data.update({"coordinates": _json_value(_safe_get(entity, "Coordinates")), "closed": _json_value(_safe_get(entity, "Closed"))})
    elif mapped_type == "circle":
        data.update({"center": _point(_safe_get(entity, "Center")), "radius": _json_value(_safe_get(entity, "Radius")), "area": _json_value(_safe_get(entity, "Area"))})
    elif mapped_type == "arc":
        data.update({"center": _point(_safe_get(entity, "Center")), "radius": _json_value(_safe_get(entity, "Radius")), "start_angle": _json_value(_safe_get(entity, "StartAngle")), "end_angle": _json_value(_safe_get(entity, "EndAngle"))})
    elif mapped_type == "hatch":
        data.update({"pattern_name": _json_value(_safe_get(entity, "PatternName")), "area": _json_value(_safe_get(entity, "Area"))})
    elif mapped_type == "block":
        data.update({"name": _json_value(_safe_get(entity, "Name")), "effective_name": _json_value(_safe_get(entity, "EffectiveName")), "insertion_point": _point(_safe_get(entity, "InsertionPoint")), "rotation": _json_value(_safe_get(entity, "Rotation")), "has_attributes": bool(_safe_get(entity, "HasAttributes", False))})
    elif mapped_type == "dimension":
        data.update({"measurement": _json_value(_safe_get(entity, "Measurement")), "style_name": _json_value(_safe_get(entity, "StyleName")), "text_override": _json_value(_safe_get(entity, "TextOverride", ""))})
    return data
