# Skill: write-lisp

Status: **active**

`write-lisp` is CadGPT's specialized **AutoLISP/Visual LISP for AutoCAD** coding capability. It is deliberately not a generic Lisp agent and not a generic application-development agent.

Its job is to understand existing AutoLISP, create or patch it safely, validate the exact AutoLISP dialect and TBH library structure, load/run it in the explicitly bound AutoCAD drawing, debug failures from concrete CAD evidence, and verify the resulting drawing state.

## Core rule

> AutoLISP is not Common Lisp. Search first. Patch before rewrite. Scaffold new files from the TBH library standard. Validate before load. Debug from evidence. Verify the bound drawing before returning control to the Job.

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
lisp_scaffold
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

`SKILL.md` is the orchestrator. Load only the relevant resources with `skill_get(name="write-lisp", resource=...)`.

### Baseline resources for every meaningful source edit

- `coding-skills/autolisp-dialect-boundary.md` — strict AutoLISP vs Common Lisp boundary.
- `coding-skills/autolisp-language.md` — AutoLISP/Visual LISP source discipline.

### New file or substantial rewrite

Also load:

- `coding-skills/library-style-and-scaffold.md` — canonical TBH presentation and file structure.

Use `lisp_scaffold` for every new production command file instead of inventing a new file layout.

### Task-specific resources

- `coding-skills/discovery-and-planning.md` — locate commands/helpers and choose reuse/patch/new-file path.
- `coding-skills/autocad-api-and-dxf.md` — DXF, enames, handles, VLA/COM, layers, geometry, coordinate systems.
- `coding-skills/selection-and-batch.md` — cleanup, conversion, mapping, takeoff, batch classification/mutation.
- `coding-skills/blocks-xrefs-attributes.md` — blocks, dynamic blocks, nested definitions, attributes and xrefs.
- `coding-skills/debugging-and-testing.md` — syntax/load/runtime/COM/CAD-state debugging and validation.

Do not create generic sub-skills for refactoring, dependency management, release engineering, Git review, or application performance. Those abstractions do not match CadGPT's AutoLISP role.

## Required workflow

### 1. Bind and inspect

When drawing state matters, confirm the explicit CadGPT drawing binding. Never infer the target from whichever AutoCAD tab is visible.

Inspect structured CAD state before deciding what AutoLISP must do.

### 2. Search existing AutoLISP

Search `lisp/**` before creating a file. Search by command name, helper prefix, relevant layer/object terminology, and similar behavior.

Preference order:

1. use an existing command unchanged;
2. change mapping/data if the algorithm already supports the request;
3. patch the smallest relevant function/branch;
4. add a narrow helper to an existing command;
5. create a new `.lsp` only when no suitable implementation exists.

### 3. Read the real change surface

Before editing, read the full affected `defun` and directly referenced helpers. Preserve public command names and working behavior unless the requested contract explicitly changes them.

For a narrow legacy patch, preserve the local style unless it causes a defect. Do not rewrite an entire working file for cosmetic consistency.

### 4. Scaffold new files; patch existing files narrowly

For a **new production command file**, call `lisp_scaffold` first and create the source from the returned TBH skeleton. Do not write a new `.lsp` from an empty page.

The canonical file structure is derived from the existing TBH Toolkit and includes the TBH metadata header, predictable helper/main-command order, command-local cleanup pattern where applicable, TBH load banner and quiet final `(princ)`.

For an **existing file**, use `file_edit` for exact patches. Use `file_create` only for genuinely new source.

Keep project mappings/configuration out of general algorithms when the Job owns that data.

For large/destructive batch operations, prefer:

```text
collect/classify → validate → mutate → verify/report
```

### 5. AutoLISP dialect + library static gate — mandatory

Run `lisp_validate` on every changed `.lsp` before load.

The harness must reject recognizable Common Lisp syntax such as Common Lisp-only binding/control forms, lambda-list keywords like `&optional`/`&rest`, and `#'` reader shorthand. Do not bypass such failures by disabling library style; dialect errors are always errors.

With the default `enforce_library_style=true`, the harness also checks the canonical TBH production header and public-command/header agreement. It is reader-aware for comments/strings, validates parenthesis structure, extracts commands/functions, detects duplicate public commands, and checks AutoLISP/Visual LISP conventions such as `(vl-load-com)` before COM use.

`valid: false` blocks the load gate.

`enforce_library_style=false` exists only for deliberate diagnosis of imported/legacy source; it is not the normal path for newly generated production code.

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

When an AutoLISP file fails:

```text
reproduce
→ classify syntax/dialect/load/DXF/COM/CAD-state failure
→ collect CAD/source evidence
→ read affected function
→ patch narrowly
→ lisp_validate
→ reload
→ rerun when safe
→ inspect postcondition
```

If the failure is caused by Common Lisp-like syntax, fix the dialect instead of trying to emulate Common Lisp inside AutoLISP.

## Completion criteria

A write-lisp task is complete only when all applicable conditions hold:

- source changes are restricted to `lisp/**`;
- new command files originate from `lisp_scaffold` or demonstrably match the same canonical structure;
- source is AutoLISP/Visual LISP, not another Lisp-family dialect;
- the smallest relevant implementation was changed;
- `lisp_validate` reports `valid: true` with the normal TBH style gate;
- expected public command contracts are present and match header metadata;
- the exact file was loaded into the bound drawing;
- the command was run when runtime execution is required and safe;
- structured CAD inspection confirms the requested result;
- unresolved mismatches or untested interactive behavior are explicitly reported.

## Relationship to Jobs

A Job may call `write-lisp` when required automation is missing or insufficient. `write-lisp` owns the AutoLISP engineering loop only. Once its completion gate passes, control returns to the exact Job step that invoked it.
