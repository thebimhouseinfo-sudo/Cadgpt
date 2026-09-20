"""Document lookup helpers for CadGPT CAD MCP.

The outer CadGPT session owns the selected drawing identity. These helpers
allow CAD MCP to resolve an explicit open drawing by a lifetime-stable runtime
document identity instead of trusting AutoCAD ActiveDocument or filename alone.
"""

from connection.acad import get_acad_app, get_active_document


def iter_documents():
    return get_acad_app().Documents


def runtime_document_id(doc) -> str:
    """Return an identity that is stable for this open document lifetime.

    AutoCAD's MDI document HWND is preferred because closing/reopening the same
    file creates a different document window. A COM identity fallback is kept
    for hosts where HWND is unavailable.
    """
    try:
        hwnd = int(getattr(doc, "HWND"))
        if hwnd:
            return f"hwnd:{hwnd}"
    except Exception:
        pass

    ole = getattr(doc, "_oleobj_", None)
    if ole is not None:
        try:
            return f"com:{int(ole)}"
        except Exception:
            return f"comrepr:{repr(ole)}"

    # Last-resort process-local identity. This is intentionally not persisted.
    return f"py:{id(doc)}"


def get_document(
    document_name: str | None = None,
    runtime_id: str | None = None,
):
    if runtime_id:
        for doc in iter_documents():
            if runtime_document_id(doc) == runtime_id:
                return doc
        raise ValueError(
            f"Open drawing runtime identity '{runtime_id}' was not found. "
            "The drawing may have been closed/reopened."
        )

    if not document_name:
        return get_active_document()

    needle = document_name.lower()
    for doc in iter_documents():
        name = str(doc.Name)
        full_name = str(getattr(doc, "FullName", "") or "")
        if name.lower() == needle or full_name.lower() == needle:
            return doc
    raise ValueError(f"Open drawing '{document_name}' was not found.")


def activate_document(
    document_name: str | None = None,
    runtime_id: str | None = None,
):
    doc = get_document(document_name, runtime_id)
    doc.Activate()
    return doc


def document_identity(doc) -> dict:
    return {
        "name": str(doc.Name),
        "full_name": str(getattr(doc, "FullName", "") or ""),
        "runtime_document_id": runtime_document_id(doc),
    }
