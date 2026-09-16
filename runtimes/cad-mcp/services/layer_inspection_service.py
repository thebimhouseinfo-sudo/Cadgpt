"""Read-only AutoCAD layer inspection for CadGPT.

This service intentionally contains no layer mutation methods. The outer
CadGPT proxy injects the explicitly bound drawing identity as document_name.
"""

from connection.session import document_identity, get_document


class LayerInspectionServiceError(RuntimeError):
    pass


def _document(document_name: str):
    if not document_name:
        raise LayerInspectionServiceError("document_name is required")
    try:
        return get_document(document_name)
    except ValueError as exc:
        raise LayerInspectionServiceError(str(exc)) from exc


def list_layers(document_name: str) -> dict:
    """Return layer state for one explicitly identified open drawing."""
    try:
        doc = _document(document_name)
        layers = []
        for layer in doc.Layers:
            layers.append(
                {
                    "name": str(layer.Name),
                    "locked": bool(layer.Lock),
                    "frozen": bool(layer.Freeze),
                    "on": bool(layer.LayerOn),
                    "color_aci": int(layer.Color),
                }
            )
        layers.sort(key=lambda item: item["name"].lower())
        return {
            "drawing": document_identity(doc),
            "count": len(layers),
            "layers": layers,
        }
    except LayerInspectionServiceError:
        raise
    except Exception as exc:
        raise LayerInspectionServiceError(str(exc)) from exc


def get_current_layer(document_name: str) -> dict:
    """Return the current layer for one explicitly identified open drawing."""
    try:
        doc = _document(document_name)
        layer = doc.ActiveLayer
        return {
            "drawing": document_identity(doc),
            "layer": {
                "name": str(layer.Name),
                "locked": bool(layer.Lock),
                "frozen": bool(layer.Freeze),
                "on": bool(layer.LayerOn),
                "color_aci": int(layer.Color),
            },
        }
    except LayerInspectionServiceError:
        raise
    except Exception as exc:
        raise LayerInspectionServiceError(str(exc)) from exc
