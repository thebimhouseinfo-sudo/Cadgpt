# Coding Skill: Discovery and Planning

Purpose: understand the existing AutoLISP codebase and the bound drawing before editing anything.

## Required behavior

1. Confirm the requested outcome and the calling Job step.
2. Inspect the bound drawing with structured CAD tools when drawing state matters.
3. Search `lisp/**` by command name, helper prefix, layer/object terminology, and related behavior.
4. Read the full relevant command/function region plus helpers it calls.
5. Identify the smallest safe change surface.
6. Decide whether the request is best solved by existing CAD MCP, existing LISP reuse, a small patch, or a new file.

## Planning output

Before editing, form a compact internal plan containing:

- target file(s);
- public command(s) affected;
- helpers affected;
- CAD state assumptions;
- expected postcondition;
- validation path;
- rollback/repair path if runtime testing fails.

## Rules

- Never create a new LISP before searching existing code.
- Do not redesign unrelated code while fixing a local defect.
- Treat current command names and user-facing behavior as contracts unless the request explicitly changes them.
- Prefer Job-local mapping/config changes when the algorithm already supports the requested behavior.
- Do not infer business rules from geometry when structured evidence is available.
