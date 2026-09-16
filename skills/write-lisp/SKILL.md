# Skill: write-lisp

Status: **active**

`write-lisp` is CadGPT's specialized **AutoLISP/Visual LISP for AutoCAD** coding capability. It is deliberately not a generic Lisp agent and not a generic application-development agent.

Its job is to understand existing AutoLISP, create or patch it safely, validate the exact AutoLISP dialect and TBH library structure, load/test it in an explicitly approved AutoCAD drawing, debug concrete load/runtime failures, and verify the resulting drawing state when the command can be automated safely.

## Core rule

> AutoLISP is not Common Lisp. Search first. Patch before rewrite. Scaffold new files from the TBH library standard. Static validation is not enough: every changed production Lisp must be loaded successfully in AutoCAD before handoff.

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
drawing_create_test
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
- `coding-skills/debugging-and-testing.md` — approved test drawing, verified load, runtime/user-test handoff.

### New file or substantial rewrite

Also load:

- `coding-skills/library-style-and-scaffold.md` — canonical TBH presentation and file structure.

Use `lisp_scaffold` for every new production command file instead of inventing a new file layout.

### Task-specific resources

- `coding-skills/discovery-and-planning.md` — locate commands/helpers and choose reuse/patch/new-file path.
- `coding-skills/autocad-api-and-dxf.md` — DXF, enames, handles, VLA/COM, layers, geometry, coordinate systems.
- `coding-skills/selection-and-batch.md` — cleanup, conversion, mapping, takeoff, batch classification/mutation.
- `coding-skills/blocks-xrefs-attributes.md` — blocks, dynamic blocks, nested definitions, attributes and xrefs.

Do not create generic sub-skills for refactoring, dependency management, release engineering, Git review, or application performance. Those abstractions do not match CadGPT's AutoLISP role.

## Required workflow

### 1. Inspect the real requirement

When drawing state matters, inspect structured CAD state before deciding what AutoLISP must do. Do not infer the target or required logic visually when AutoCAD can return deterministic entity/layer/block data.

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

Run `lisp_validate` on every changed `.lsp` before any AutoCAD load.

The harness rejects recognizable Common Lisp syntax such as Common Lisp-only binding/control forms, lambda-list keywords like `&optional`/`&rest`, and `#'` reader shorthand. Dialect errors are always errors.

With the normal `enforce_library_style=true`, the harness also checks the canonical TBH production header and public-command/header agreement. It is reader-aware for comments/strings, validates parenthesis structure, extracts commands/functions, detects duplicate public commands, and checks AutoLISP/Visual LISP conventions such as `(vl-load-com)` before COM use.

`valid: false` blocks the load gate.

`enforce_library_style=false` exists only for deliberate diagnosis of imported/legacy source; it is not the normal path for newly generated production code.

### 6. Ask the user where to test — mandatory

After the code passes the static gate and is ready for AutoCAD testing, do **not** silently choose a drawing.

If the user has already explicitly named a test drawing in the current request, use it. Otherwise ask:

```text
Lisp đã sẵn sàng để load test. Bạn muốn:
1. tạo một drawing mới để test; hay
2. test trên drawing hiện tại?
```

Do not proceed to load until the user has chosen one of these paths.

#### User chooses a new drawing

Call `drawing_create_test`.

CadGPT's current CAD MCP includes a blank-drawing creation path backed by AutoCAD's document collection. If `drawing_create_test` is available and succeeds, it creates a new unsaved blank DWG and binds the CadGPT session to it.

If the tool is unavailable on the installed CAD MCP/AutoCAD host or creation fails, **do not fall back to the project drawing**. Tell the user to create/open a blank test drawing manually, then use `drawing_list` + `drawing_bind` to bind exactly that drawing.

#### User chooses the current drawing

Use `drawing_status` to show/confirm the currently bound drawing identity. The user's explicit choice is authorization to perform the agreed Lisp load/runtime test on that drawing.

Do not treat a previously-open project drawing as implicitly approved merely because it is active or bound.

### 7. Verified AutoCAD load gate — mandatory

Load the exact repository file through:

```text
cad__cad_load_lisp_file
```

The tool must report:

```text
loaded: true
```

before the Lisp can be handed off or executed.

A queued `SendCommand` is not proof of load success. When load fails, read the returned `error` and `log_tail`, patch the source, run `lisp_validate` again, and repeat the load test on the same approved test drawing until it succeeds or a concrete external blocker is identified.

Many AutoLISP defects fail here before the user ever invokes the command; these must be fixed before delivery.

### 8. Decide automated execution vs user interaction

If the command can run deterministically without manual point-picking, selection, keyword prompts, dialogs, or other user interaction, invoke it with:

```text
cad__cad_run_lisp_command
```

then verify the CAD postcondition.

If the command **requires user interaction**, do not invent prompt input merely to claim a successful test. Once static validation and verified load have both passed, stop automated execution and ask the user to run the named command manually in the approved test drawing.

For an interactive command, this is a valid handoff state:

```text
static validate PASS
verified load PASS
manual command test REQUIRED
```

If the user reports a runtime error after manual command testing, resume the same debug loop from that concrete error evidence.

### 9. CAD postcondition gate for safely automated commands

When automated execution is possible, verify actual drawing state with structured CAD tools.

Examples:

- expected layer/type counts changed;
- target handles/properties are correct;
- unwanted source/review/detail entities are gone;
- nested block entity layers were really changed, not only the INSERT layer;
- attributes have expected values;
- expected target layers exist;
- unresolved/unmapped objects are reported.

A successful edit, static validation, verified load, or command dispatch is not completion without the applicable CAD postcondition.

## Debugging loop

When an AutoLISP file fails:

```text
classify syntax/dialect/load/DXF/COM/CAD-state failure
→ collect source/CAD evidence
→ patch narrowly
→ lisp_validate
→ use the same user-approved test drawing
→ verified load
→ read error/log evidence
→ patch and repeat
→ run when safely automatable
→ inspect postcondition
```

If the failure is caused by Common Lisp-like syntax, fix the dialect instead of trying to emulate Common Lisp inside AutoLISP.

## Completion / handoff states

### Automated test complete

All applicable conditions hold:

- source changes are restricted to `lisp/**`;
- new command files originate from `lisp_scaffold` or match the same canonical structure;
- source is AutoLISP/Visual LISP, not another Lisp-family dialect;
- `lisp_validate` reports `valid: true` with the normal TBH style gate;
- the user approved the actual test drawing;
- `cad__cad_load_lisp_file` reports `loaded: true`;
- command execution is safely automatable;
- structured CAD postcondition confirms the requested result.

### User interaction required

All applicable conditions hold:

- static validation passed;
- the user approved the actual test drawing;
- verified load passed with `loaded: true`;
- the command requires manual interaction;
- the user is told exactly which command to run in that drawing and that runtime command behavior still requires their manual test.

### Blocked

- concrete load/runtime evidence identifies a blocker that cannot be resolved automatically;
- the blocker and untested portion are stated explicitly.

Never hand off a changed Lisp with an unverified load state.

## Relationship to Jobs

A Job may call `write-lisp` when required automation is missing or insufficient. `write-lisp` owns the AutoLISP engineering loop only. Once the applicable completion/handoff gate passes, control returns to the exact Job step that invoked it.
