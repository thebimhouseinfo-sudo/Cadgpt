"""CadGPT Drawing Anchor persistence in AutoCAD's Named Objects Dictionary extension dictionary."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import secrets
import unicodedata

import pythoncom
import pywintypes
import win32com.client.dynamic
from win32com.client import VARIANT

from connection.acad import AutoCADNotRunningError, get_active_document
from connection.session import activate_document

ANCHOR_KEY = "CADGPT_DRAWING_ANCHOR"
SCHEMA_VERSION = 1
TYPE_SCHEMA = 90
TYPE_STRING = 1


class DrawingAnchorServiceError(RuntimeError):
    pass


def _dynamic(obj):
    return win32com.client.dynamic.DumbDispatch(obj)


def _unwrap(value):
    return getattr(value, "value", value)


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


def _try_get_xrecord(extension_dictionary):
    try:
        return extension_dictionary.GetObject(ANCHOR_KEY)
    except pywintypes.com_error:
        return None


def _read_xrecord(xrecord) -> dict:
    dynamic = _dynamic(xrecord)
    types_ref = VARIANT(
        pythoncom.VT_BYREF | pythoncom.VT_VARIANT,
        None,
    )
    values_ref = VARIANT(
        pythoncom.VT_BYREF | pythoncom.VT_VARIANT,
        None,
    )
    dynamic.GetXRecordData(types_ref, values_ref)

    types = list(types_ref.value or ())
    values = list(values_ref.value or ())
    if len(types) != 2 or len(values) != 2:
        raise DrawingAnchorServiceError(
            "Drawing Anchor XRecord has an invalid field count"
        )
    if int(_unwrap(types[0])) != TYPE_SCHEMA or int(
        _unwrap(types[1])
    ) != TYPE_STRING:
        raise DrawingAnchorServiceError(
            "Drawing Anchor XRecord has an invalid DXF schema"
        )

    schema_version = int(_unwrap(values[0]))
    if schema_version != SCHEMA_VERSION:
        raise DrawingAnchorServiceError(
            f"Unsupported Drawing Anchor schema_version: {schema_version}"
        )
    drawing_anchor = _validate_anchor(_unwrap(values[1]))
    return {
        "schema_version": schema_version,
        "drawing_anchor": drawing_anchor,
    }


def _write_xrecord(xrecord, drawing_anchor: str) -> None:
    drawing_anchor = _validate_anchor(drawing_anchor)
    types = VARIANT(
        pythoncom.VT_ARRAY | pythoncom.VT_I2,
        [TYPE_SCHEMA, TYPE_STRING],
    )
    values = VARIANT(
        pythoncom.VT_ARRAY | pythoncom.VT_VARIANT,
        [
            VARIANT(pythoncom.VT_I4, SCHEMA_VERSION),
            VARIANT(pythoncom.VT_BSTR, drawing_anchor),
        ],
    )
    _dynamic(xrecord).SetXRecordData(types, values)


def ensure_drawing_anchor(
    document_name: str = "",
    runtime_document_id: str = "",
    preferred_anchor: str = "",
) -> dict:
    """Ensure and return the canonical Drawing Anchor for one exact AutoCAD document."""
    try:
        if document_name or runtime_document_id:
            doc = activate_document(
                document_name or None,
                runtime_document_id or None,
            )
        else:
            doc = get_active_document()

        dictionaries = doc.Dictionaries
        extension_dictionary = (
            dictionaries.GetExtensionDictionary()
        )
        xrecord = _try_get_xrecord(extension_dictionary)
        created = False

        if xrecord is None:
            anchor = (
                _validate_anchor(preferred_anchor)
                if preferred_anchor
                else _new_anchor(doc)
            )
            xrecord = extension_dictionary.AddXRecord(
                ANCHOR_KEY
            )
            try:
                _write_xrecord(xrecord, anchor)
                payload = _read_xrecord(xrecord)
            except Exception:
                try:
                    xrecord.Delete()
                except Exception:
                    pass
                raise
            created = True
        else:
            payload = _read_xrecord(xrecord)
        if preferred_anchor and not created:
            _validate_anchor(preferred_anchor)

        return {
            **payload,
            "created": created,
            "xrecord_key": ANCHOR_KEY,
            "storage": (
                "named_objects_dictionary_"
                "extension_dictionary_xrecord"
            ),
        }
    except (
        AutoCADNotRunningError,
        ValueError,
        DrawingAnchorServiceError,
    ):
        raise
    except Exception as exc:
        raise DrawingAnchorServiceError(
            f"Could not ensure CadGPT Drawing Anchor: {exc}"
        ) from exc
