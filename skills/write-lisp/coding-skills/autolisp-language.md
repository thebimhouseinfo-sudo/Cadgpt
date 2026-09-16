# Coding Skill: AutoLISP Language Discipline

Purpose: produce maintainable AutoLISP/Visual LISP rather than merely syntactically plausible text.

## Function and command structure

- Public commands use `c:COMMAND` names intentionally and preserve existing names by default.
- Helper functions use a module prefix such as `rvt2cad:` or `xrefmap:` to reduce global symbol collisions.
- Declare locals after `/` in every non-trivial `defun`.
- Keep helpers small enough that selection, transformation, validation, and reporting logic can be inspected separately.
- Avoid hidden global mutable state unless the existing module explicitly relies on it.

## Data handling

- Prefer lists/alists for small structured data and explicit helper accessors for readability.
- Validate expected types before arithmetic or COM calls.
- Normalize layer/command comparisons consistently; AutoCAD names are often case-insensitive.
- Treat entity names, handles, VLA objects, DXF alists, selection sets, and points as distinct types; do not interchange them casually.

## Strings, comments, and source safety

- Keep strings properly escaped and avoid constructing command strings when a direct API is available.
- Comments should explain invariants or CAD-specific reasons, not restate obvious code.
- Keep source encoding conservative when interoperability with legacy AutoLISP environments matters.

## Error handling

- Commands that modify sysvars must save and restore them on success, cancel, and error.
- Use a local `*error*` handler when command state, undo state, sysvars, temporary entities, or selection sets require cleanup.
- Treat normal cancel messages separately from real failures.
- Use `vl-catch-all-apply` around COM calls that can fail because of object state or host constraints.

## Undo boundaries

For mutating user commands, use one coherent undo group when practical. Do not leave an open undo group after cancel/error.

## Preferred primitives

Use the highest-level deterministic primitive that fits:

1. direct entity/DXF or VLA operation;
2. `entmake`/`entmakex` for deterministic creation;
3. structured AutoCAD command only when the API path is impractical;
4. interactive command flows only when interaction is the requested behavior.

Do not default to `(command ...)` just because it is shorter to write.
