"""Entity filter validation and matching helpers."""

from __future__ import annotations

SUPPORTED_FILTER_TYPES = {
    "line",
    "polyline",
    "circle",
    "arc",
    "ellipse",
    "spline",
    "point",
    "text",
    "mtext",
    "hatch",
    "wipeout",
    "solid",
    "dimension",
    "block",
}
DEFAULT_LIMIT = 200
MAX_LIMIT = 5000


class FilterError(ValueError):
    pass


def normalize_filter(filter_data: dict | None) -> dict:
    if filter_data is None:
        filter_data = {}
    if not isinstance(filter_data, dict):
        raise FilterError("filter must be an object.")

    result = dict(filter_data)
    types = result.get("types")
    if types is not None:
        if isinstance(types, str):
            types = [types]
        if not isinstance(types, list) or not all(isinstance(item, str) for item in types):
            raise FilterError("filter.types must be a string or list of strings.")
        normalized_types = [item.lower() for item in types]
        invalid = sorted(set(normalized_types) - SUPPORTED_FILTER_TYPES)
        if invalid:
            raise FilterError(f"Unsupported entity types: {', '.join(invalid)}")
        result["types"] = normalized_types

    for key in ["layer", "handle"]:
        value = result.get(key)
        if value is not None and not isinstance(value, str):
            raise FilterError(f"filter.{key} must be a string.")

    text_contains = result.get("text_contains")
    if text_contains is not None and not isinstance(text_contains, str):
        raise FilterError("filter.text_contains must be a string.")

    limit = result.get("limit", DEFAULT_LIMIT)
    if limit is None:
        limit = DEFAULT_LIMIT
    if not isinstance(limit, int) or limit < 1:
        raise FilterError("filter.limit must be a positive integer.")
    result["limit"] = min(limit, MAX_LIMIT)
    return result


def matches_entity(entity_data: dict, filter_data: dict) -> bool:
    types = filter_data.get("types")
    if types and entity_data.get("entity_type") not in types:
        return False

    layer = filter_data.get("layer")
    if layer and str(entity_data.get("layer", "")).lower() != layer.lower():
        return False

    handle = filter_data.get("handle")
    if handle and str(entity_data.get("handle", "")).lower() != handle.lower():
        return False

    text_contains = filter_data.get("text_contains")
    if text_contains and text_contains.lower() not in str(entity_data.get("text", "")).lower():
        return False

    return True
