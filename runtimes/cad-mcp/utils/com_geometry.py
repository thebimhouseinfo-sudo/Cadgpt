"""Small COM geometry helpers used by CadGPT mutation services."""

from __future__ import annotations

import pythoncom
from win32com.client import VARIANT


class GeometryValueError(ValueError):
    pass


def point3(value, label: str = "point") -> list[float]:
    if isinstance(value, (str, bytes, bool)) or not isinstance(value, (list, tuple)):
        raise GeometryValueError(f"{label} must be an array of 2 or 3 numbers")
    if len(value) not in (2, 3):
        raise GeometryValueError(f"{label} must contain 2 or 3 numbers")
    try:
        result = [float(item) for item in value]
    except (TypeError, ValueError) as exc:
        raise GeometryValueError(f"{label} must contain only numbers") from exc
    if len(result) == 2:
        result.append(0.0)
    return result


def com_point(value, label: str = "point"):
    return VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, point3(value, label))


def numeric(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise GeometryValueError(f"{label} must be a number")
    return float(value)


def positive_numeric(value, label: str) -> float:
    result = numeric(value, label)
    if result <= 0:
        raise GeometryValueError(f"{label} must be greater than zero")
    return result


def json_point(value) -> list[float] | None:
    try:
        return [float(item) for item in value]
    except Exception:
        return None
