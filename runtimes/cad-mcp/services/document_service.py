"""Read-only document discovery and explicit activation for CadGPT."""

from connection.acad import AutoCADNotRunningError, get_active_document
from connection.session import activate_document, document_identity, iter_documents


class DocumentServiceError(RuntimeError):
    pass


def _same_document(left: dict, right: dict) -> bool:
    """Prefer full path identity; fall back to AutoCAD document name for unsaved DWGs."""
    left_full = str(left.get("full_name") or "").lower()
    right_full = str(right.get("full_name") or "").lower()
    if left_full and right_full:
        return left_full == right_full
    return str(left.get("name") or "").lower() == str(right.get("name") or "").lower()


def _to_dict(doc, active_identity: dict) -> dict:
    identity = document_identity(doc)
    return {
        **identity,
        "active": _same_document(identity, active_identity),
        "host": "autocad",
    }


def list_open_documents() -> list[dict]:
    try:
        active_identity = document_identity(get_active_document())
        return [_to_dict(doc, active_identity) for doc in iter_documents()]
    except AutoCADNotRunningError:
        raise
    except Exception as exc:
        raise DocumentServiceError(str(exc)) from exc


def get_active_document_info() -> dict:
    try:
        doc = get_active_document()
        identity = document_identity(doc)
        return {**identity, "active": True, "host": "autocad"}
    except AutoCADNotRunningError:
        raise
    except Exception as exc:
        raise DocumentServiceError(str(exc)) from exc


def set_active_document(document_name: str) -> dict:
    if not document_name:
        raise DocumentServiceError("document_name is required")
    try:
        doc = activate_document(document_name)
        identity = document_identity(doc)
        return {**identity, "active": True, "host": "autocad"}
    except (AutoCADNotRunningError, ValueError) as exc:
        raise DocumentServiceError(str(exc)) from exc
    except Exception as exc:
        raise DocumentServiceError(str(exc)) from exc
