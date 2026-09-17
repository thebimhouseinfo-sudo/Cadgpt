"""Read direct AutoCAD COM properties without nested entity traversal."""

from __future__ import annotations

import math
from typing import Any


KNOWN_PROPERTIES = {
    "ObjectName",
    "ObjectID",
    "OwnerID",
    "Handle",
    "HasExtensionDictionary",
    "Layer",
    "Color",
    "TrueColor",
    "Linetype",
    "LinetypeScale",
    "Lineweight",
    "Material",
    "PlotStyleName",
    "Visible",
}


def _is_com_object(value: Any) -> bool:
    return hasattr(value, "_oleobj_") or hasattr(value, "_olerepr_")


def _com_summary(value: Any) -> dict[str, Any]:
    summary: dict[str, Any] = {"kind": "com_object"}
    for attr, key in (("ObjectName", "object_name"), ("Name", "name"), ("Handle", "handle")):
        try:
            item = getattr(value, attr)
            if item is not None:
                summary[key] = str(item)
        except Exception:
            continue
    return summary


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, bytes):
        return value.hex()
    if _is_com_object(value):
        return _com_summary(value)
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    try:
        return [json_safe(item) for item in value]
    except Exception:
        try:
            return str(value)
        except Exception:
            return f"<{type(value).__name__}>"


def direct_property_names(entity: Any) -> list[str]:
    names = set(KNOWN_PROPERTIES)

    generated_map = getattr(entity, "_prop_map_get_", None)
    if isinstance(generated_map, dict):
        names.update(str(name) for name in generated_map)

    ole_repr = getattr(entity, "_olerepr_", None)
    if ole_repr is not None:
        for map_name in ("propMap", "propMapGet"):
            mapping = getattr(ole_repr, map_name, None)
            if isinstance(mapping, dict):
                names.update(str(name) for name in mapping)

    try:
        names.update(name for name in dir(entity) if isinstance(name, str) and not name.startswith("_"))
    except Exception:
        pass

    return sorted(name for name in names if name and not name.startswith("_"))


def read_direct_properties(entity: Any) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    unreadable: dict[str, str] = {}

    for name in direct_property_names(entity):
        try:
            value = getattr(entity, name)
        except Exception as exc:
            unreadable[name] = str(exc)
            continue
        if callable(value):
            continue
        try:
            properties[name] = json_safe(value)
        except Exception as exc:
            unreadable[name] = str(exc)

    return {
        "object_name": str(properties.get("ObjectName") or ""),
        "handle": str(properties.get("Handle") or ""),
        "properties": properties,
        "unreadable_properties": unreadable,
        "nested_traversal": False,
    }
