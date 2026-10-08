"""Bounded, verified grille attribute updates and idempotent grille-tag deletion.

No whole-DWG scan, raw command, or general-purpose destructive bypass:
the caller supplies exact handles in the already-bound drawing. The tag
deletion shortcut requires explicit confirmation and validates both the
GrilleTag layer and the GR- block name before ever calling Delete().
"""
from __future__ import annotations

from services.handle_service import HandleResolutionError, normalize_handle, read_com, resolve_top_level

_GRILLE_LAYERS = {
    "hvac-sagrille", "hvac-ragrille", "hvac-oagrille",
    "hvac-eagrille", "hvac-tagrille",
}
_TAG_LAYER = "hvac-grilletag"


class GrilleServiceError(RuntimeError):
    pass


def _require_grille(handle):
    handle = normalize_handle(handle)
    doc, space, entity = resolve_top_level(handle)
    if entity is None:
        raise GrilleServiceError("Grille block was not found at top level: " + handle)
    if str(read_com(lambda: entity.ObjectName)) != "AcDbBlockReference":
        raise GrilleServiceError("Handle does not reference a block INSERT: " + handle)
    if str(read_com(lambda: entity.Layer)).casefold() not in _GRILLE_LAYERS:
        raise GrilleServiceError("Handle is not on an HVAC grille layer: " + handle)
    return doc, entity


def _normalize_values(values, label, empty_ok=False):
    if not isinstance(values, dict) or (not values and not empty_ok):
        raise GrilleServiceError(label + " must be a non-empty map of ATT tags to string values")
    if len(values) > 64:
        raise GrilleServiceError(label + " must have at most 64 ATT tags")
    normalized = {}
    for tag, value in values.items():
        if not isinstance(tag, str) or not tag.strip() or not isinstance(value, str):
            raise GrilleServiceError(label + " must contain non-empty string tags and string values")
        key = tag.strip().upper()
        if key in normalized:
            raise GrilleServiceError(label + " contains duplicate case-insensitive ATT tag " + key)
        normalized[key] = value
    return normalized


def _editable_atts(entity):
    atts = {}
    for att in read_com(lambda: entity.GetAttributes()):
        tag = str(read_com(lambda a=att: a.TagString)).strip().upper()
        if tag in atts:
            raise GrilleServiceError("Ambiguous duplicate ATT tag in grille: " + tag)
        atts[tag] = att
    return atts


def update_grille_attributes(handle: str, updates: dict[str, str],
                             expected_values: dict[str, str] | None = None) -> dict:
    """Edit multiple ATT values by one block handle; verify each change.

    Retried calls are idempotent: a field already equal to its desired value
    is a verified no-op. Conflicting expected old values fail before writes.
    """
    needle = normalize_handle(handle)
    wanted = _normalize_values(updates, "updates")
    expected = _normalize_values(expected_values, "expected_values", empty_ok=True) if expected_values is not None else {}
    if set(expected) - set(wanted):
        raise GrilleServiceError("expected_values contains ATT tags absent from updates")
    _doc, entity = _require_grille(needle)
    atts = _editable_atts(entity)
    missing = sorted(set(wanted) - set(atts))
    if missing:
        raise GrilleServiceError("Grille is missing ATT tag(s): " + ", ".join(missing))

    before = {tag: str(read_com(lambda a=atts[tag]: a.TextString)) for tag in wanted}
    conflicts = [
        tag for tag, old in before.items()
        if tag in expected and old != expected[tag] and old != wanted[tag]
    ]
    if conflicts:
        raise GrilleServiceError(
            "ATT_CONFLICT: grille values changed since inspection: " + ", ".join(conflicts)
        )

    errors = []
    for tag, value in wanted.items():
        if before[tag] == value:
            continue
        try:
            atts[tag].TextString = value  # Never blindly replay uncertain COM writes.
            atts[tag].Update()
        except Exception as exc:
            # Readback below determines whether the write already succeeded.
            errors.append({"tag": tag, "error": str(exc)})

    after = {}
    for tag in wanted:
        try:
            after[tag] = str(read_com(lambda a=atts[tag]: a.TextString))
        except Exception as exc:
            errors.append({"tag": tag, "error": "readback unavailable: " + str(exc)})
    verified = len(after) == len(wanted) and all(after.get(tag) == value for tag, value in wanted.items())
    unresolved = sorted(tag for tag, value in wanted.items() if after.get(tag) != value)
    return {
        "handle": needle, "requested_count": len(wanted),
        "changed_count": sum(1 for tag in wanted if before[tag] != wanted[tag] and after.get(tag) == wanted[tag]),
        "already_correct_count": sum(1 for tag in wanted if before[tag] == wanted[tag]),
        "before": before, "after": after,
        "verified": verified, "unresolved_tags": unresolved,
        "errors": [e for e in errors if e["tag"] in unresolved],
    }


def _is_grille_tag(entity):
    if str(read_com(lambda: entity.ObjectName)) != "AcDbBlockReference":
        return False
    layer = str(read_com(lambda: entity.Layer)).casefold()
    name = str(read_com(lambda: entity.Name)).upper()
    return layer == _TAG_LAYER and name.startswith("GR-")


def delete_grille_tags(handles: list[str], confirmed: bool = False,
                       expected_tag_numbers: dict[str, str] | None = None) -> dict:
    """Delete only explicitly confirmed GR-* blocks on Hvac-GrilleTag.

    Idempotent after a lost response: absent handles count as already absent.
    Validation is done for ALL existing targets BEFORE deleting any of them.
    """
    if confirmed is not True:
        raise GrilleServiceError("Explicit user approval is required: confirmed=true")
    if not isinstance(handles, list) or not 1 <= len(handles) <= 50:
        raise GrilleServiceError("Specify 1 to 50 exact grille-tag handles")
    normalized = [normalize_handle(h) for h in handles]
    if len(set(normalized)) != len(normalized):
        raise GrilleServiceError("Duplicate grille-tag handles are not allowed")
    expected_tag_numbers = expected_tag_numbers or {}
    if not isinstance(expected_tag_numbers, dict):
        raise GrilleServiceError("expected_tag_numbers must map handles to TAG_NUMBER strings")
    expected_map = {normalize_handle(k): v for k, v in expected_tag_numbers.items()}
    if set(expected_map) - set(normalized) or any(not isinstance(v, str) for v in expected_map.values()):
        raise GrilleServiceError("expected_tag_numbers has an invalid or unrequested handle/value")

    # Preflight the entire requested batch before mutating a single entity.
    found, already_absent = {}, []
    for handle in normalized:
        _doc, _space, entity = resolve_top_level(handle)
        if entity is None:
            already_absent.append(handle)
            continue
        if not _is_grille_tag(entity):
            raise GrilleServiceError(
                "DELETE_BLOCKED: " + handle + " is not a GR-* block on Hvac-GrilleTag"
            )
        if handle in expected_map:
            values = _editable_atts(entity)
            att = values.get("TAG_NUMBER") or values.get("TAGNO")
            actual = str(read_com(lambda: att.TextString)) if att else None
            if actual != expected_map[handle]:
                raise GrilleServiceError("DELETE_CONFLICT: TAG_NUMBER changed for " + handle)
        found[handle] = entity

    deleted, errors, remaining = [], [], []
    for handle, entity in found.items():
        try:
            entity.Delete()  # No blind retry: the first call may have succeeded.
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})
        try:
            _doc, _space, survivor = resolve_top_level(handle)
            if survivor is None:
                deleted.append(handle)
            else:
                remaining.append(handle)
        except Exception as exc:
            remaining.append(handle)
            errors.append({"handle": handle, "error": "verification unavailable: " + str(exc)})

    unresolved = set(remaining)
    return {
        "requested_count": len(normalized),
        "deleted_count": len(deleted),
        "already_absent_count": len(already_absent),
        "deleted_handles": deleted,
        "already_absent_handles": already_absent,
        "remaining_handles": remaining,
        "verified": not unresolved,
        "errors": [e for e in errors if e["handle"] in unresolved],
        "idempotent": True,
    }
