"""Generate CadGPT's stable CAD tool manifest from AutoLISP/CAD MCP Python sources.

This script parses tool function signatures and docstrings with Python AST. It
never imports or starts CAD MCP and never connects to AutoCAD. The generated
manifest lets the outer CadGPT MCP expose a stable tool surface even while the
CAD runtime is sleeping.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = ROOT / "runtimes" / "cad-mcp" / "tools"
OUTPUT = ROOT / "runtimes" / "cad-mcp" / "tool-manifest.json"


def _name(node: ast.AST | None) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return ""


def _schema(annotation: ast.AST | None) -> dict:
    if annotation is None:
        return {}
    if isinstance(annotation, ast.Name):
        return {
            "str": {"type": "string"},
            "int": {"type": "integer"},
            "float": {"type": "number"},
            "bool": {"type": "boolean"},
            "dict": {"type": "object"},
            "list": {"type": "array"},
        }.get(annotation.id, {})
    if isinstance(annotation, ast.BinOp) and isinstance(annotation.op, ast.BitOr):
        left = _schema(annotation.left)
        right_name = _name(annotation.right)
        if right_name == "None" or isinstance(annotation.right, ast.Constant) and annotation.right.value is None:
            return {**left, "nullable": True}
        right = _schema(annotation.right)
        return {"anyOf": [left, right]}
    if isinstance(annotation, ast.Subscript):
        base = _name(annotation.value)
        if base == "list":
            return {"type": "array", "items": _schema(annotation.slice)}
        if base == "dict":
            return {"type": "object"}
        if base in {"Optional", "Union"}:
            values = annotation.slice.elts if isinstance(annotation.slice, ast.Tuple) else [annotation.slice]
            schemas = []
            nullable = False
            for value in values:
                if _name(value) == "None" or isinstance(value, ast.Constant) and value.value is None:
                    nullable = True
                else:
                    schemas.append(_schema(value))
            if len(schemas) == 1:
                result = dict(schemas[0])
                if nullable:
                    result["nullable"] = True
                return result
            result = {"anyOf": schemas}
            if nullable:
                result["nullable"] = True
            return result
    return {}


def _is_mcp_tool(fn: ast.FunctionDef) -> bool:
    for decorator in fn.decorator_list:
        call = decorator if isinstance(decorator, ast.Call) else None
        target = call.func if call else decorator
        if isinstance(target, ast.Attribute) and target.attr == "tool":
            return True
    return False


def _tool_from_function(fn: ast.FunctionDef) -> dict:
    defaults = [None] * (len(fn.args.args) - len(fn.args.defaults)) + list(fn.args.defaults)
    properties: dict[str, dict] = {}
    required: list[str] = []
    for arg, default in zip(fn.args.args, defaults):
        properties[arg.arg] = _schema(arg.annotation)
        if default is None:
            required.append(arg.arg)
        elif isinstance(default, ast.Constant) and default.value is not None:
            properties[arg.arg]["default"] = default.value

    input_schema = {"type": "object", "properties": properties}
    if required:
        input_schema["required"] = required
    return {
        "name": fn.name,
        "description": ast.get_docstring(fn) or fn.name,
        "inputSchema": input_schema,
    }


def main() -> None:
    tools: list[dict] = []
    for path in sorted(TOOLS_DIR.glob("*_tools.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and _is_mcp_tool(node):
                tools.append(_tool_from_function(node))

    tools.sort(key=lambda item: item["name"])
    OUTPUT.write_text(json.dumps({"version": 1, "tools": tools}, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(tools)} CAD MCP tool descriptors -> {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
