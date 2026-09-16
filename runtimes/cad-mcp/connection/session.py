"""Document lookup helpers for CadGPT CAD MCP.

The outer CadGPT session owns the selected drawing identity. These helpers
allow CAD MCP to resolve an explicit open drawing by name or full path.
"""

from connection.acad import get_acad_app, get_active_document


def iter_documents():
    return get_acad_app().Documents


def get_document(document_name: str | None = None):
    if not document_name:
        return get_active_document()

    needle = document_name.lower()
    for doc in iter_documents():
        name = str(doc.Name)
        full_name = str(getattr(doc, "FullName", "") or "")
        if name.lower() == needle or full_name.lower() == needle:
            return doc
    raise ValueError(f"Open drawing '{document_name}' was not found.")


def activate_document(document_name: str):
    doc = get_document(document_name)
    doc.Activate()
    return doc


def document_identity(doc) -> dict:
    return {
        "name": str(doc.Name),
        "full_name": str(getattr(doc, "FullName", "") or ""),
    }
