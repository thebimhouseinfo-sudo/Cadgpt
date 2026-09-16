"""Structured CAD inventory for deterministic Job decisions.

CadGPT should prefer this evidence over visual interpretation when deciding
cleanup and layer-mapping steps.
"""

from collections import defaultdict

from connection.acad import AutoCADNotRunningError, get_active_document


class InventoryServiceError(RuntimeError):
    pass


def _safe_bool(obj, property_name: str, default=False):
    try:
        return bool(getattr(obj, property_name))
    except Exception:
        return default


def layer_object_inventory(
    include_block_definitions: bool = True,
    include_xref_definitions: bool = False,
) -> dict:
    """Aggregate entity counts by layer + AutoCAD object type.

    The outer CadGPT proxy re-activates the explicitly bound drawing before
    this tool is called. This service therefore reads ActiveDocument only as
    the already-enforced execution target.
    """
    try:
        doc = get_active_document()
        counts = defaultdict(int)
        failures = 0
        scanned = 0

        for block in doc.Blocks:
            try:
                name = str(block.Name)
                is_xref = _safe_bool(block, "IsXRef", False)
                is_layout = _safe_bool(block, "IsLayout", False)

                if is_xref and not include_xref_definitions:
                    continue
                if not include_block_definitions and not is_layout:
                    continue

                scope = "layout" if is_layout else "block_definition"
                for obj in block:
                    try:
                        layer = str(obj.Layer)
                        object_type = str(obj.ObjectName)
                        counts[(layer, object_type, scope, name)] += 1
                        scanned += 1
                    except Exception:
                        failures += 1
            except Exception:
                failures += 1

        rows = [
            {
                "layer": layer,
                "object_type": object_type,
                "scope": scope,
                "container": container,
                "count": count,
            }
            for (layer, object_type, scope, container), count in counts.items()
        ]
        rows.sort(key=lambda row: (row["layer"].lower(), row["object_type"], row["scope"], row["container"].lower()))

        layer_totals = defaultdict(int)
        type_totals = defaultdict(int)
        for row in rows:
            layer_totals[row["layer"]] += row["count"]
            type_totals[row["object_type"]] += row["count"]

        return {
            "drawing": {
                "name": str(doc.Name),
                "full_name": str(getattr(doc, "FullName", "") or ""),
            },
            "scanned_entities": scanned,
            "read_failures": failures,
            "include_block_definitions": include_block_definitions,
            "include_xref_definitions": include_xref_definitions,
            "layers": [
                {"layer": name, "count": count}
                for name, count in sorted(layer_totals.items(), key=lambda item: item[0].lower())
            ],
            "object_types": [
                {"object_type": name, "count": count}
                for name, count in sorted(type_totals.items())
            ],
            "layer_object_rows": rows,
        }
    except AutoCADNotRunningError:
        raise
    except Exception as exc:
        raise InventoryServiceError(str(exc)) from exc
