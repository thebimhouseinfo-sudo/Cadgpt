"""AutoCAD layer queries and reversible mutations for the CadGPT-bound drawing.

CadGPT owns drawing selection in the outer MCP session. These functions operate
only on AutoCAD's current document after the outer proxy re-activates the bound
DWG. No function accepts a document override and destructive layer deletion is
intentionally excluded.
"""

from connection.acad import get_active_document


class LayerServiceError(RuntimeError):
    pass


def _active_document():
    try:
        return get_active_document()
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc


def _layers():
    return _active_document().Layers


def _find_layer(name: str):
    needle = name.lower()
    for layer in _layers():
        if str(layer.Name).lower() == needle:
            return layer
    return None


def _validate_name(name: str) -> str:
    value = name.strip()
    if not value:
        raise LayerServiceError("layer name is required")
    if any(ch in value for ch in '<>/\\":;?*|=,'):
        raise LayerServiceError(f"invalid layer name: {name!r}")
    return value


def _validate_layer_color(color_aci: int) -> int:
    if isinstance(color_aci, bool) or not isinstance(color_aci, int) or not 1 <= color_aci <= 255:
        raise LayerServiceError("layer color_aci must be an integer from 1 to 255")
    return color_aci


def get_current_layer_info() -> dict:
    try:
        layer = _active_document().ActiveLayer
        return {"name": str(layer.Name)}
    except LayerServiceError:
        raise
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc


def list_layers() -> list[dict]:
    try:
        result: list[dict] = []
        for layer in _layers():
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


def set_current_layer(name: str) -> dict:
    target = _find_layer(_validate_name(name))
    if target is None:
        raise LayerServiceError(f"layer '{name}' was not found")
    try:
        doc = _active_document()
        before = str(doc.ActiveLayer.Name)
        doc.ActiveLayer = target
        return {"changed": before.lower() != str(target.Name).lower(), "old_name": before, "new_name": str(target.Name)}
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc


def create_layer(name: str, color_aci: int | None = None) -> dict:
    value = _validate_name(name)
    if _find_layer(value) is not None:
        raise LayerServiceError(f"layer '{value}' already exists")
    if color_aci is not None:
        _validate_layer_color(color_aci)
    try:
        layer = _layers().Add(value)
        if color_aci is not None:
            layer.color = color_aci
        return {"created": True, "name": str(layer.Name), "color_aci": int(layer.color)}
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc


def rename_layer(old_name: str, new_name: str) -> dict:
    old_value = _validate_name(old_name)
    new_value = _validate_name(new_name)
    if old_value.lower() == "0":
        raise LayerServiceError("layer '0' cannot be renamed")
    layer = _find_layer(old_value)
    if layer is None:
        raise LayerServiceError(f"layer '{old_value}' was not found")
    existing = _find_layer(new_value)
    if existing is not None and existing is not layer:
        raise LayerServiceError(f"layer '{new_value}' already exists")
    try:
        before = str(layer.Name)
        layer.Name = new_value
        return {"changed": before != str(layer.Name), "old_name": before, "new_name": str(layer.Name)}
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc


def set_layer_lock(name: str, locked: bool) -> dict:
    layer = _find_layer(_validate_name(name))
    if layer is None:
        raise LayerServiceError(f"layer '{name}' was not found")
    try:
        before = bool(layer.Lock)
        layer.Lock = bool(locked)
        return {"name": str(layer.Name), "changed": before != bool(locked), "old_locked": before, "locked": bool(locked)}
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc


def set_layer_freeze(name: str, frozen: bool) -> dict:
    layer = _find_layer(_validate_name(name))
    if layer is None:
        raise LayerServiceError(f"layer '{name}' was not found")
    try:
        before = bool(layer.Freeze)
        if before != bool(frozen):
            layer.Freeze = bool(frozen)
        return {"name": str(layer.Name), "changed": before != bool(frozen), "old_frozen": before, "frozen": bool(frozen)}
    except Exception as exc:
        raise LayerServiceError(f"unable to change freeze state for '{name}': {exc}") from exc


def set_layer_on(name: str, on: bool) -> dict:
    layer = _find_layer(_validate_name(name))
    if layer is None:
        raise LayerServiceError(f"layer '{name}' was not found")
    try:
        before = bool(layer.LayerOn)
        layer.LayerOn = bool(on)
        return {"name": str(layer.Name), "changed": before != bool(on), "old_on": before, "on": bool(on)}
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc


def set_layer_color(name: str, color_aci: int) -> dict:
    color = _validate_layer_color(color_aci)
    layer = _find_layer(_validate_name(name))
    if layer is None:
        raise LayerServiceError(f"layer '{name}' was not found")
    try:
        before = int(layer.color)
        layer.color = color
        return {"name": str(layer.Name), "changed": before != color, "old_color_aci": before, "color_aci": color}
    except Exception as exc:
        raise LayerServiceError(str(exc)) from exc
