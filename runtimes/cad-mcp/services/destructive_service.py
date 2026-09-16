"""Guarded destructive operations for the CadGPT-bound drawing.

Deletion is intentionally two-phase:
1. preview a non-empty filter and receive an opaque, short-lived token;
2. execute that token against the exact handle snapshot.

The execution token is one-shot, tied to the active drawing identity, and is
consumed before mutation begins. A transport failure therefore cannot safely be
replayed with the same token; the caller must preview again.
"""

from __future__ import annotations

import os
import secrets
import time
from dataclasses import dataclass

from connection.acad import get_active_document
from services.entity_service import _find_entity, list_entities
from utils.filters import FilterError, normalize_filter


class DestructiveServiceError(RuntimeError):
    pass


PREVIEW_TTL_SECONDS = max(30, int(os.getenv("CADGPT_DESTRUCTIVE_PREVIEW_TTL", "300")))
PREVIEW_SAMPLE_LIMIT = 50


@dataclass
class DeletePreview:
    token: str
    drawing_identity: str
    created_at: float
    expires_at: float
    handles: list[str]
    filter_data: dict


_delete_previews: dict[str, DeletePreview] = {}


def _drawing_identity() -> str:
    try:
        doc = get_active_document()
        full_name = str(getattr(doc, "FullName", "") or "").strip()
        name = str(doc.Name).strip()
        return (full_name or name).lower()
    except Exception as exc:
        raise DestructiveServiceError(str(exc)) from exc


def _require_destructive_filter(filter_data: dict) -> None:
    selectors = ("types", "layer", "handle", "text_contains")
    if not any(filter_data.get(key) not in (None, "", []) for key in selectors):
        raise DestructiveServiceError(
            "destructive preview requires at least one selector: types, layer, handle, or text_contains"
        )


def _purge_expired() -> None:
    now = time.time()
    for token, preview in list(_delete_previews.items()):
        if preview.expires_at <= now:
            _delete_previews.pop(token, None)


def preview_delete_entities(
    filter: dict,
    include_paper_space: bool = False,
) -> dict:
    try:
        normalized = normalize_filter(filter)
    except FilterError as exc:
        raise DestructiveServiceError(str(exc)) from exc
    _require_destructive_filter(normalized)

    entities = list_entities(normalized, include_paper_space=include_paper_space)
    handles = [str(item.get("handle", "")).strip() for item in entities]
    handles = [handle for handle in handles if handle]
    if not handles:
        return {
            "preview": True,
            "matched": 0,
            "token": None,
            "expires_in_seconds": PREVIEW_TTL_SECONDS,
            "sample": [],
        }

    _purge_expired()
    token = secrets.token_urlsafe(24)
    now = time.time()
    _delete_previews[token] = DeletePreview(
        token=token,
        drawing_identity=_drawing_identity(),
        created_at=now,
        expires_at=now + PREVIEW_TTL_SECONDS,
        handles=handles,
        filter_data=normalized,
    )
    return {
        "preview": True,
        "matched": len(handles),
        "token": token,
        "expires_in_seconds": PREVIEW_TTL_SECONDS,
        "sample": entities[:PREVIEW_SAMPLE_LIMIT],
        "sample_truncated": len(entities) > PREVIEW_SAMPLE_LIMIT,
        "filter": normalized,
    }


def execute_delete_preview(token: str) -> dict:
    if not isinstance(token, str) or not token.strip():
        raise DestructiveServiceError("preview token is required")

    _purge_expired()
    preview = _delete_previews.pop(token, None)
    if preview is None:
        raise DestructiveServiceError(
            "delete preview token is invalid, expired, already consumed, or was lost after CAD MCP restart; preview again"
        )

    # One-shot safety: token is already consumed before the first Delete call.
    if preview.drawing_identity != _drawing_identity():
        raise DestructiveServiceError(
            "active drawing no longer matches the drawing used for this delete preview; preview again"
        )

    deleted: list[dict] = []
    skipped: list[dict] = []
    errors: list[dict] = []

    for handle in preview.handles:
        _doc, space, entity = _find_entity(handle, include_paper_space=True)
        if entity is None:
            skipped.append({"handle": handle, "reason": "no longer present"})
            continue
        try:
            entity_type = str(getattr(entity, "ObjectName", ""))
            layer = str(getattr(entity, "Layer", ""))
            entity.Delete()
            deleted.append(
                {
                    "handle": handle,
                    "object_name": entity_type,
                    "layer": layer,
                    "space": space,
                }
            )
        except Exception as exc:
            errors.append({"handle": handle, "error": str(exc)})

    remaining: list[str] = []
    for handle in preview.handles:
        _doc, _space, entity = _find_entity(handle, include_paper_space=True)
        if entity is not None:
            remaining.append(handle)

    return {
        "preview_token_consumed": True,
        "matched_before": len(preview.handles),
        "deleted_count": len(deleted),
        "skipped": skipped,
        "errors": errors,
        "remaining_count": len(remaining),
        "remaining_handles": remaining[:PREVIEW_SAMPLE_LIMIT],
        "remaining_truncated": len(remaining) > PREVIEW_SAMPLE_LIMIT,
        "verified": len(remaining) == 0,
        "deleted": deleted[:PREVIEW_SAMPLE_LIMIT],
        "deleted_truncated": len(deleted) > PREVIEW_SAMPLE_LIMIT,
        "filter": preview.filter_data,
    }
