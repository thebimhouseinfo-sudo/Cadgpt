# CadGPT Capability Registry

The registry is a semantic catalog for ChatGPT. It is not an execution path and must never bypass normal MCP/CAD/LISP safety gates.

## Why it exists

Legacy Lisp filenames and command names are often personal shorthand and do not reliably describe behavior. ChatGPT should normally select a capability from registry metadata first and only read source when it needs to modify, debug, audit, or generate a dynamic variant.

## Lisp entry contract

Every user-facing Lisp under `lisp/**` (except `lisp/_cadgpt-system/**`) must have one curated entry in `registry/lisp-registry.json`.

Required semantic fields:

- `id`: stable canonical identifier independent of filename.
- `title`: human-readable capability name.
- `type`: `static` or `dynamic`.
- `dynamic_role`: `template` or `instance` when applicable.
- `class` / `subclass`: semantic catalog hierarchy.
- `tags`: additional retrieval hints.
- `module`: owning functional module.
- `commands`: public AutoCAD commands defined by the source.
- `path`: source library path for library/template entries.
- `summary`: concise description of actual current implementation.
- `when_to_use`: scenarios where the capability is appropriate.
- `targets`: drawing objects/state affected.
- `inputs`: required user/runtime inputs.
- `effects`: actual drawing changes performed.
- `interaction`: `interactive` or `non-interactive`.
- `load_behavior`: `define_only` or `execute_on_load`.
- `mutates_drawing`: whether execution changes drawing state.
- `destructive`: whether execution may delete or irreversibly overwrite data.
- `risk`: `low`, `medium`, or `high`.
- `dynamic_parameters`: parameters intended for runtime materialization when `type=dynamic`.
- `implementation_notes`: important discrepancies, constraints, or caveats found by reading the implementation.

## Static vs dynamic

`static` means the repository source is normally loaded as-is.

`dynamic` means the library entry is a semantic template/capability. ChatGPT may create an ephemeral validated instance with runtime parameters without rewriting the source library file. Dynamic instances belong under `.runtime/dynamic-lisp/**`, are identified by artifact ID, and still pass AutoLISP validation plus verified AutoCAD load before use.

## Source of truth

The registry description must reflect actual implementation, not merely filename or header text. Build/CI validation checks path and command drift; semantic fields remain deliberately curated.

## Tool registry

Normal MCP `tools/list` remains the execution source of truth. CadGPT's stable CAD tool manifest provides tool schemas while CAD MCP sleeps. Registry tooling may expose the same tool inventory with semantic grouping, but execution always goes through the registered MCP tool itself.
