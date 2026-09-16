"""Read-only block-reference and block-definition inspection.

CadGPT owns the target drawing in the outer MCP session. This module reads only
from AutoCAD's current document after the outer proxy re-activates the bound
DWG; it intentionally exposes no document override and no mutation methods.
"""

from connection.acad import get_active_document
from utils.entity_mapper import entity_to_dict, entity_type
from utils.filters import FilterError, matches_entity, normalize_filter


class BlockServiceError(RuntimeError):
    pass


def _doc():
    try:
        return get_active_document()
    except Exception as exc:
        raise BlockServiceError(str(exc)) from exc


def _point(value):
    if value is None:
        return None
    try:
        return [float(item) for item in value]
    except Exception:
        return None


def _attributes(entity) -> list[dict]:
    try:
        attrs = entity.GetAttributes()
    except Exception:
        return []
    result = []
    for attr in attrs:
        result.append(
            {
                "tag": str(getattr(attr, "TagString", "")),
                "value": str(getattr(attr, "TextString", "")),
                "prompt": str(getattr(attr, "PromptString", "")),
                "height": getattr(attr, "Height", None),
                "rotation": getattr(attr, "Rotation", None),
                "insertion_point": _point(getattr(attr, "InsertionPoint", None)),
            }
        )
    return result


def _spaces(doc):
    yield "ModelSpace", doc.ModelSpace
    for layout in doc.Layouts:
        try:
            if str(layout.Name).lower() != "model":
                yield f"Layout:{layout.Name}", layout.Block
        except Exception:
            continue


def _iter_entities(space):
    try:
        count = int(space.Count)
    except Exception:
        return
    for index in range(count):
        try:
            entity = space.Item(index)
            if entity is not None:
                yield entity
        except Exception:
            continue


def list_blocks(filter: dict | None = None) -> list[dict]:
    try:
        normalized = normalize_filter(filter)
    except FilterError as exc:
        raise BlockServiceError(str(exc)) from exc

    # This tool is block-specific regardless of whether callers omit types.
    normalized["types"] = ["block"]
    result: list[dict] = []
    doc = _doc()
    for space_name, space in _spaces(doc):
        for entity in _iter_entities(space):
            if entity_type(entity) != "block":
                continue
            data = entity_to_dict(entity)
            if not matches_entity(data, normalized):
                continue
            result.append(
                {
                    **data,
                    "space": space_name,
                    "attribute_count": len(_attributes(entity)),
                }
            )
            if len(result) >= normalized["limit"]:
                return result
    return result


def get_block(handle: str) -> dict:
    if not handle:
        raise BlockServiceError("handle is required")
    needle = handle.lower()
    doc = _doc()
    for space_name, space in _spaces(doc):
        for entity in _iter_entities(space):
            try:
                if str(entity.Handle).lower() != needle:
                    continue
            except Exception:
                continue
            if entity_type(entity) != "block":
                raise BlockServiceError(f"Entity with handle '{handle}' is not a block reference")
            return {
                **entity_to_dict(entity),
                "space": space_name,
                "attributes": _attributes(entity),
            }
    raise BlockServiceError(f"Block reference with handle '{handle}' was not found")


def list_block_definitions() -> list[dict]:
    doc = _doc()
    result: list[dict] = []
    try:
        count = int(doc.Blocks.Count)
    except Exception as exc:
        raise BlockServiceError(str(exc)) from exc

    for index in range(count):
        try:
            block = doc.Blocks.Item(index)
            name = str(block.Name)
        except Exception:
            continue
        if name.startswith("*"):
            continue

        attrs = []
        try:
            for item_index in range(int(block.Count)):
                item = block.Item(item_index)
                if str(getattr(item, "ObjectName", "")) != "AcDbAttributeDefinition":
                    continue
                attrs.append(
                    {
                        "tag": str(getattr(item, "TagString", "")),
                        "prompt": str(getattr(item, "PromptString", "")),
                        "value": str(getattr(item, "TextString", "")),
                        "height": getattr(item, "Height", None),
                    }
                )
        except Exception:
            pass
        result.append(
            {
                "name": name,
                "attribute_count": len(attrs),
                "attributes": attrs,
            }
        )

    result.sort(key=lambda item: item["name"].lower())
    return result
