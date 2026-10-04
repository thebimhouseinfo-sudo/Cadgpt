"""CadGPT Drawing Anchor orchestration.

Python owns bound-document activation and durable-anchor value generation.
Native AutoLISP owns the actual DWG dictionary/XRecord read/write operation.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import secrets
import unicodedata

from connection.acad import AutoCADNotRunningError
from connection.session import activate_document
from services.lisp_service import (
    LispServiceError,
    load_lisp_file,
    run_lisp_function_sync,
)

ANCHOR_KEY = "CADGPT_DRAWING_ANCHOR"
ANCHOR_LISP_PATH = "resources/cad/core-lisp/drawing-anchor.lsp"
ANCHOR_LISP_FUNCTION = "cadgpt-drawing-anchor-ensure"
SCHEMA_VERSION = 1


class DrawingAnchorServiceError(RuntimeError):
    pass


def _clean_origin_name(name: str) -> str:
    stem = Path(name or "Drawing").stem or "Drawing"
    stem = unicodedata.normalize("NFKD", stem).encode(
        "ascii", "ignore"
    ).decode("ascii")
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem)
    stem = re.sub(r"-+", "-", stem).strip(" .-")
    return (stem or "Drawing")[:80]


def _new_anchor(doc) -> str:
    origin = _clean_origin_name(
        str(getattr(doc, "Name", "") or "Drawing")
    )
    stamp = datetime.now().strftime("%H%M%S-%d%m%y")
    return f"{origin}-{stamp}-{secrets.token_hex(4)}"


def _validate_anchor(value: str) -> str:
    anchor = str(value or "").strip()
    if (
        not anchor
        or len(anchor) > 180
        or anchor in {".", ".."}
        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", anchor)
        is None
    ):
        raise DrawingAnchorServiceError(
            "Drawing Anchor contains an unsafe drawing_anchor value"
        )
    return anchor


def _parse_lisp_result(raw: str) -> dict:
    parts = str(raw or "").split("|")
    if len(parts) != 3:
        raise DrawingAnchorServiceError(
            "Drawing Anchor Lisp returned an invalid result envelope"
        )

    schema_text, anchor_text, state = parts
    try:
        schema_version = int(schema_text)
    except ValueError as exc:
        raise DrawingAnchorServiceError(
            "Drawing Anchor Lisp returned an invalid schema_version"
        ) from exc

    if schema_version != SCHEMA_VERSION:
        raise DrawingAnchorServiceError(
            f"Unsupported Drawing Anchor schema_version: {schema_version}"
        )

    drawing_anchor = _validate_anchor(anchor_text)
    if state not in {"created", "existing"}:
        raise DrawingAnchorServiceError(
            "Drawing Anchor Lisp returned an invalid state"
        )

    return {
        "schema_version": schema_version,
        "drawing_anchor": drawing_anchor,
        "created": state == "created",
    }


def ensure_drawing_anchor(
    document_name: str = "",
    runtime_document_id: str = "",
    preferred_anchor: str = "",
) -> dict:
    """Ensure and return the canonical Drawing Anchor for one exact AutoCAD document."""
    try:
        doc = activate_document(
            document_name or None,
            runtime_document_id or None,
        )
        candidate = (
            _validate_anchor(preferred_anchor)
            if preferred_anchor
            else _new_anchor(doc)
        )

        loaded = load_lisp_file(ANCHOR_LISP_PATH)
        if not loaded.get("loaded"):
            raise DrawingAnchorServiceError(
                "Could not load internal Drawing Anchor Lisp: "
                + str(loaded.get("error") or "unknown load failure")
            )

        raw = run_lisp_function_sync(
            ANCHOR_LISP_FUNCTION,
            [candidate],
        )
        payload = _parse_lisp_result(raw)
        return {
            **payload,
            "xrecord_key": ANCHOR_KEY,
            "storage": (
                "named_objects_dictionary_"
                "extension_dictionary_xrecord"
            ),
            "adapter": "internal_autolisp",
            "lisp_path": ANCHOR_LISP_PATH,
        }
    except (
        AutoCADNotRunningError,
        ValueError,
        LispServiceError,
        DrawingAnchorServiceError,
    ):
        raise
    except Exception as exc:
        raise DrawingAnchorServiceError(
            f"Could not ensure CadGPT Drawing Anchor: {exc}"
        ) from exc
