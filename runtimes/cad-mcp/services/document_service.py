"""Document discovery, explicit activation, saving, and safe test-drawing creation for CadGPT."""

from connection.acad import AutoCADNotRunningError, get_acad_app, get_active_document
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


def save_active_document() -> dict:
    """Persist the currently active drawing to its existing DWG path.

    The outer CadGPT layer must first reactivate the explicitly bound drawing.
    This operation intentionally refuses unsaved drawings because choosing a
    Save-As path is a user/workflow decision, not a low-level runtime decision.
    """
    try:
        doc = get_active_document()
        before = document_identity(doc)
        full_name = str(before.get("full_name") or "")
        if not full_name:
            raise DocumentServiceError(
                "The active drawing has no saved file path. Save As is required before a durable Observator checkpoint can be created."
            )
        doc.Save()
        after = document_identity(doc)
        return {
            **after,
            "active": True,
            "host": "autocad",
            "saved": True,
        }
    except AutoCADNotRunningError:
        raise
    except DocumentServiceError:
        raise
    except Exception as exc:
        raise DocumentServiceError(f"Could not save active drawing: {exc}") from exc


def create_blank_test_document() -> dict:
    """Create a new unsaved AutoCAD drawing intended only for CadGPT testing.

    The document is intentionally not saved and is marked as a test drawing in
    the returned metadata. The outer CadGPT session must explicitly bind to the
    returned identity before any business/LISP tool can use it.
    """
    try:
        app = get_acad_app()
        doc = app.Documents.Add()
        doc.Activate()
        identity = document_identity(doc)
        return {
            **identity,
            "active": True,
            "host": "autocad",
            "test_drawing": True,
            "unsaved": not bool(identity.get("full_name")),
        }
    except AutoCADNotRunningError:
        raise
    except Exception as exc:
        raise DocumentServiceError(f"Could not create blank AutoCAD test drawing: {exc}") from exc
