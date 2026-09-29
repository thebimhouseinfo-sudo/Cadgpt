"""Document lookup helpers for CadGPT CAD MCP.

The outer CadGPT session owns the selected drawing identity. These helpers
allow CAD MCP to resolve an explicit open drawing by a lifetime-stable runtime
document identity instead of trusting AutoCAD ActiveDocument or filename alone.
"""

from connection.acad import get_acad_app, get_active_document


def iter_documents():
    return get_acad_app().Documents


def _window_handle(obj) -> int | None:
    for name in ("HWND", "HWND32"):
        try:
            value = int(getattr(obj, name))
            if value:
                return value
        except Exception:
            continue
    return None


def runtime_document_id(doc) -> str:
    """Return a host-owned identity for the current open document lifetime.

    AutoCAD owns the application/document window handles, so they survive a
    CadGPT Python MCP subprocess reconnect. Do not include Python/COM wrapper
    identities here because those are client-process-local and would falsely
    stale a still-open drawing after reconnect.

    The document window handle is the host-side discriminator for an open MDI
    document, and the application window handle scopes it to one AutoCAD host
    lifetime. Close/reopen behavior remains part of real-host acceptance. If
    either handle is unavailable, fail closed instead of silently falling back
    to a process-local identity.
    """
    doc_hwnd = _window_handle(doc)
    if doc_hwnd is None:
        raise RuntimeError(
            "AutoCAD document HWND is unavailable; CadGPT cannot establish a reconnect-stable drawing identity."
        )

    app = None
    try:
        app = getattr(doc, "Application")
    except Exception:
        app = None
    if app is None:
        try:
            app = get_acad_app()
        except Exception:
            app = None

    app_hwnd = _window_handle(app) if app is not None else None
    if app_hwnd is None:
        raise RuntimeError(
            "AutoCAD application HWND is unavailable; CadGPT cannot scope the drawing identity to one AutoCAD host lifetime."
        )
    return f"acad-hwnd:{app_hwnd}:doc-hwnd:{doc_hwnd}"


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
