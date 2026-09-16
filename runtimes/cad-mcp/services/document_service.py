"""Read-only document discovery and explicit activation for CadGPT."""

from connection.acad import AutoCADNotRunningError, get_active_document
from connection.session import activate_document, document_identity, iter_documents


class DocumentServiceError(RuntimeError):
    pass


def _to_dict(doc, active_name: str) -> dict:
    identity = document_identity(doc)
    return {
        **identity,
        "active": identity["name"].lower() == active_name.lower(),
        "host": "autocad",
    }


def list_open_documents() -> list[dict]:
    try:
        active_name = str(get_active_document().Name)
        return [_to_dict(doc, active_name) for doc in iter_documents()]
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
