# Coding Skill: AutoCAD API, DXF, and COM

Purpose: choose the correct AutoCAD mechanism and avoid fragile mixed abstractions.

## Entity access

- Use `entget`/`entmod` when DXF-level edits are simple and well-defined.
- Use VLA/ActiveX when properties or collections are exposed more safely there.
- Convert with `vlax-ename->vla-object` and `vlax-vla-object->ename` deliberately; do not retain stale VLA objects after destructive operations.
- Use handles for stable reporting/verification when possible, but resolve them against the current bound drawing before mutation.

## Selection

- Prefer `ssget` filters that narrow entity type/layer before iterating.
- Avoid scanning the entire drawing when AutoCAD can filter natively.
- Validate empty selection sets explicitly.
- When operating inside blocks or definitions, distinguish block references from block table records and nested entities.

## Layers and properties

- Check layer existence before assignment.
- Respect locked/frozen/current-layer restrictions.
- Distinguish ByLayer, ByBlock, and explicit entity properties.
- Do not silently create project-standard layers unless the calling workflow requires it.

## Blocks and attributes

- Distinguish block reference layer from internal entity layers.
- Distinguish block definition editing from insert/reference editing.
- Dynamic block `EffectiveName` may differ from anonymous reference name.
- Attribute definitions and attribute references are different objects; changing one does not automatically synchronize the other.

## Geometry

- Keep WCS/UCS/OCS distinctions explicit when coordinate systems matter.
- Validate 2D versus 3D assumptions.
- Preserve Z when the workflow does not explicitly flatten geometry.
- Do not compare floating-point points using exact equality when tolerance is required.

## COM robustness

- Call `(vl-load-com)` before Visual LISP COM APIs.
- Guard COM operations that commonly fail on proxy objects, erased entities, locked layers, xrefs, or unsupported object classes.
- Release temporary COM objects only when lifecycle management is actually needed; do not add noisy release calls blindly.
- Prefer batch/native filtering over thousands of chat-level MCP mutations when LISP can execute deterministically in-process.
