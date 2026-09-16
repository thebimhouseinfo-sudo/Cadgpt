# Skill: write-lisp

Status: **active**

`write-lisp` is CadGPT's specialized AutoLISP/Visual LISP coding capability. It is not a CAD business Job and not a generic coding agent.

Its purpose is to safely inspect, create, patch, load, run, and verify AutoLISP required by Jobs.

## Core rule

> Search first. Patch before rewrite. Validate before load. Verify the bound drawing before returning control to the Job.

## Workspace boundary

Source mutations are restricted to:

```text
lisp/**
```

Use CadGPT's sandboxed file tools. Do not request unrestricted filesystem access, generic shell, package-manager, or Git tools.

`skills/**` is read-only runtime guidance; the Skill must not rewrite itself during normal CAD work.

## Actual tool surface

Use these CadGPT tools where applicable:

```text
file_list
file_search
file_read
file_create
file_edit
lisp_validate

drawing_list
drawing_bind
drawing_status

cad__cad_inventory_layer_objects
cad__cad_list_layers
cad__cad_list_entities
cad__cad_get_entity
cad__cad_list_blocks
cad__cad_get_block
cad__cad_load_lisp_file
cad__cad_run_lisp_command
```

Other structured `cad__...` tools may be used when they directly express the required inspection or verification. Prefer them over creating new LISP for an operation already covered safely by CAD MCP.

## Required workflow

### 1. Establish the target and evidence

When CAD state matters, confirm the explicitly bound drawing and inspect it with structured CAD tools. Never infer the target from the visible AutoCAD tab.

Do not infer unrelated business rules beyond the calling Job or explicit user request.

### 2. Search existing LISP

Search `lisp/**` before creating a file.

Prefer in order:

1. reuse an existing command unchanged;
2. patch the smallest relevant implementation;
3. extend a reusable implementation;
4. create a new LISP only when no suitable implementation exists.

### 3. Read before editing

Before changing a file:

- read the complete relevant command/function region;
- inspect referenced helpers when needed;
- preserve public command names unless the requested contract changes;
- preserve unrelated behavior.

### 4. Write or patch narrowly

Use `file_edit` for exact replacements and `file_create` for genuinely new files.

Baseline coding rules:

- use `(vl-load-com)` when Visual LISP/COM is required;
- namespace helper functions with a module-specific prefix;
- declare local variables in the `defun` `/` section;
- restore modified system variables on success and error/cancel paths;
- use guarded COM calls where failure is possible;
- prefer data/config changes over algorithm rewrites when the engine already supports the requested behavior;
- prefer deterministic, non-interactive automation for Job-driven work unless interaction is intrinsic to the command;
- use explicit undo/error boundaries for mutating commands where appropriate;
- avoid hard-coded project-specific mappings when they belong in Job-local data.

### 5. Static validation — mandatory

Run `lisp_validate` on every changed `.lsp` file.

Block loading when `valid` is false. Review warnings rather than ignoring them.

The validator is token-aware for comments and strings; raw parenthesis counts are not an acceptable final validation method.

### 6. Load validation

Load the exact repository file with:

```text
cad__cad_load_lisp_file
```

Only `lisp/**` files are loadable. A queued load is not proof that the requested behavior works.

### 7. Execution test

When safe and testable, run the intended named command with:

```text
cad__cad_run_lisp_command
```

Avoid interactive commands unless the Job explicitly defines how prompt arguments are supplied.

### 8. Postcondition validation — completion gate

Inspect actual CAD state with structured read tools and compare it with the calling Job's success criteria.

Examples:

- target entity count changed as expected;
- unwanted layer/entity combination is gone;
- expected layer/property exists;
- created or converted objects have the expected structured properties;
- command did not leave partial or contradictory state.

A successful file edit, static validation, load, or command queue is **not sufficient** by itself.

## Error loop

If validation fails:

1. identify the failing stage and concrete evidence;
2. read the relevant source again;
3. patch only the needed logic;
4. rerun `lisp_validate`;
5. reload the changed file;
6. rerun the intended command when safe;
7. re-check the CAD postcondition.

Do not repeatedly rewrite the whole file to chase a local defect.

## Relationship to Jobs

A Job calls `write-lisp` when required automation is missing or insufficient. After the Skill passes its validation loop, control returns to the same Job step.

```text
Job step
   ↓
automation missing / insufficient
   ↓
write-lisp
   ↓
inspect → search → read → patch/create → validate → load → run → verify
   ↓
return to same Job step
```

## Completion criteria

A write-lisp task is complete only when all applicable conditions hold:

- changed source is under `lisp/**`;
- `lisp_validate` reports `valid: true`;
- expected command definitions are present;
- the file was queued for load into the bound drawing;
- the intended command was run when required;
- structured CAD inspection confirms the requested postcondition;
- unresolved mismatches are explicitly reported rather than hidden.
