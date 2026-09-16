# Skill: write-lisp

Status: **active**

`write-lisp` is CadGPT's specialized AutoLISP/Visual LISP coding capability. It is deliberately **not** a generic application-development agent.

Its job is to understand existing Lisp, create or patch AutoLISP safely, validate the source, load/run it in the explicitly bound AutoCAD drawing, debug failures from concrete CAD evidence, and verify the resulting drawing state.

## Core rule

> Search first. Patch before rewrite. Validate before load. Debug from evidence. Verify the bound drawing before returning control to the Job.

## Boundaries

Editable source:

```text
lisp/**
```

Read-only skill knowledge:

```text
skills/write-lisp/**
```

Do not request generic shell, package-manager, Git, arbitrary filesystem, or application-development tooling. AutoLISP source is edited only through CadGPT's sandboxed file tools.

## Runtime tools

Core file tools:

```text
file_list
file_search
file_read
file_create
file_edit
```

Skill/harness tools:

```text
skill_list
skill_get
lisp_validate
```

Drawing/session tools:

```text
drawing_list
drawing_bind
drawing_status
```

AutoCAD inspection/execution tools used most often:

```text
cad__cad_inventory_layer_objects
cad__cad_list_layers
cad__cad_list_entities
cad__cad_get_entity
cad__cad_list_blocks
cad__cad_get_block
cad__cad_list_block_definitions
cad__cad_load_lisp_file
cad__cad_run_lisp_command
```

Other structured `cad__...` tools may be used when they directly express required inspection or postcondition verification.

## Coding-skill resources

`SKILL.md` is the orchestrator. For non-trivial work, load only the relevant resources with `skill_get(name="write-lisp", resource=...)`.

### `coding-skills/discovery-and-planning.md`

Use when locating existing commands/helpers, deciding patch versus new file, or understanding what the current drawing/code already does.

### `coding-skills/autolisp-language.md`

Use for AutoLISP/Visual LISP source structure, locals, symbols, strings, error handling, undo boundaries, and API choice discipline. This is baseline guidance for every meaningful source edit.

### `coding-skills/autocad-api-and-dxf.md`

Use when working with DXF, enames, handles, VLA/COM, layers, geometry, coordinate systems, or AutoCAD collections/properties.

### `coding-skills/selection-and-batch.md`

Use for cleanup, conversion, mapping, takeoff, or other high-volume operations. It covers selection-set filtering, classification-before-mutation, stable batch iteration, aggregate reporting, and CAD-specific efficiency.

### `coding-skills/blocks-xrefs-attributes.md`

Use for blocks, dynamic blocks, block definitions, nested entities, attributes, Revit-exported blocks/accessories/fittings, or xref layer mapping.

### `coding-skills/debugging-and-testing.md`

Use whenever an existing Lisp fails, AutoCAD reports COM/runtime errors, a patch needs regression checking, or the load/run result must be verified.

Do not create generic sub-skills for refactoring, dependency management, release engineering, Git review, or application performance. Those abstractions do not match CadGPT's AutoLISP role.

## Required workflow

### 1. Bind and inspect

When drawing state matters, confirm the explicit CadGPT drawing binding. Never infer the target from whichever AutoCAD tab is visible.

Inspect structured CAD state before deciding what Lisp must do.

### 2. Search existing Lisp

Search `lisp/**` before creating a file. Search by command name, helper prefix, relevant layer/object terminology, and similar behavior.

Preference order:

1. use an existing command unchanged;
2. change mapping/data if the algorithm already supports the request;
3. patch the smallest relevant function/branch;
4. add a narrow helper to an existing command;
5. create a new `.lsp` only when no suitable implementation exists.

### 3. Read the real change surface

Before editing, read the full affected `defun` and directly referenced helpers. Preserve public command names and working behavior unless the requested contract explicitly changes them.

For legacy Lisp, understand the code that exists instead of rewriting it into a preferred style merely for cleanliness.

### 4. Edit narrowly

Use `file_edit` for exact patches and `file_create` for genuinely new source.

Keep project mappings/configuration out of general algorithms when the Job owns that data.

For large/destructive batch operations, prefer the conceptual structure:

```text
collect/classify → validate → mutate → verify/report
```

### 5. Static harness — mandatory

Run:

```text
lisp_validate
```

on every changed `.lsp` before load.

The static harness is reader-aware for strings/comments and validates structural parentheses without raw character counting. It also extracts public commands/functions, can enforce expected command names, detects duplicate public commands, and emits AutoLISP-specific warnings such as COM use without `vl-load-com` or sysvar mutation without an error handler.

`valid: false` blocks the load gate.

Warnings require review but do not automatically mean the Lisp is wrong.

### 6. Load gate

Load the exact repository file through:

```text
cad__cad_load_lisp_file
```

A queued load is not proof of working code.

### 7. Runtime test

When safe and deterministic, invoke the intended command with:

```text
cad__cad_run_lisp_command
```

Interactive legacy commands may require a specific automation path. Do not invent prompt responses or repeatedly rerun destructive commands after an uncertain transport failure.

### 8. CAD postcondition gate

Verify actual drawing state with structured CAD tools.

Examples:

- expected layer/type counts changed;
- target handles/properties are correct;
- unwanted source/review/detail entities are gone;
- nested block entity layers were really changed, not only the INSERT layer;
- attributes have expected values;
- expected target layers exist;
- unresolved/unmapped objects are reported.

A successful edit, static validation, load, or command dispatch is **not completion** without the applicable CAD postcondition.

## Debugging loop

When a Lisp fails:

```text
reproduce
→ classify the failure
→ collect CAD/source evidence
→ read the affected function
→ patch narrowly
→ lisp_validate
→ reload
→ rerun when safe
→ inspect postcondition
```

Classify syntax/load/selection/DXF/COM/block-state/drawing-state/data-algorithm failures separately. Do not chase a local COM or mapping defect by rewriting the whole file.

## Completion criteria

A write-lisp task is complete only when all applicable conditions hold:

- the source change is restricted to `lisp/**`;
- the smallest relevant implementation was changed;
- `lisp_validate` reports `valid: true`;
- expected public command contracts are present;
- the exact file was loaded into the bound drawing;
- the command was run when runtime execution is required and safe;
- structured CAD inspection confirms the requested result;
- unresolved mismatches or untested interactive behavior are explicitly reported.

## Relationship to Jobs

A Job may call `write-lisp` when required automation is missing or insufficient. `write-lisp` is responsible for the Lisp engineering loop only. Once its completion gate passes, control returns to the exact Job step that invoked it.
