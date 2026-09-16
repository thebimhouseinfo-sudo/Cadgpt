"""Read-only AutoCAD layer queries for CadGPT.

CadGPT owns drawing selection in the outer MCP session. These service functions
therefore operate only on AutoCAD's current document after the outer proxy has
re-activated the explicitly bound drawing. They intentionally do not accept a
document_name override.
"""

from connection.acad import get_active_document


class LayerServiceError(RuntimeError):
    pass


def _active_document():
    try:
        return get_active_document()
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc


def get_current_layer_info() -> dict:
    """Return the current layer of the bound/active drawing."""
    try:
        layer = _active_document().ActiveLayer
        return {"name": str(layer.Name)}
    except LayerServiceError:
        raise
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc


def list_layers() -> list[dict]:
    """Return basic layer state for the bound/active drawing."""
    try:
        layers = _active_document().Layers
        result: list[dict] = []
        for layer in layers:
            result.append(
                {
                    "name": str(layer.Name),
                    "locked": bool(layer.Lock),
                    "frozen": bool(layer.Freeze),
                    "on": bool(layer.LayerOn),
                    "color_aci": int(layer.color),
                }
            )
        result.sort(key=lambda item: item["name"].lower())
        return result
    except LayerServiceError:
        raise
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc
