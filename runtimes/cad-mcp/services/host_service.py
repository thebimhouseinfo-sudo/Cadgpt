"""Read-only AutoCAD host diagnostics for CadGPT."""

from connection.acad import get_acad_app


class HostServiceError(RuntimeError):
    pass


def host_status() -> dict:
    try:
        app = get_acad_app()
        documents = app.Documents
        document_count = int(documents.Count)
        active_name = None
        active_full_name = None
        if document_count > 0:
            try:
                active = app.ActiveDocument
                active_name = str(active.Name)
                active_full_name = str(getattr(active, "FullName", "") or "")
            except Exception:
                pass
        return {
            "host": "autocad",
            "application_name": str(getattr(app, "Name", "AutoCAD")),
            "version": str(getattr(app, "Version", "")),
            "document_count": document_count,
            "active_document": active_name,
            "active_full_name": active_full_name,
        }
    except Exception as exc:
        raise HostServiceError(str(exc)) from exc
