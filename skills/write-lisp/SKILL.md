# Skill: write-lisp

Status: **active**

`write-lisp` is CadGPT's specialized **AutoLISP/Visual LISP for AutoCAD** coding capability. It is not a generic Lisp agent and not a generic application-development agent.

Its job is to understand existing AutoLISP, create or patch it safely, validate the exact AutoLISP dialect and TBH library structure, load/test it in an explicitly approved AutoCAD drawing, debug concrete load/runtime failures, verify drawing results when automation is safe, and only then promote reusable code into the permanent library.

## Core rule

> AutoLISP is not Common Lisp. Search first. Patch before rewrite. New/substantial work lives in AppData draft first. Static validation is not enough: changed Lisp must load successfully in AutoCAD before permanent promotion or handoff.

## Storage model

Permanent source:

```text
lisp/**
```

Draft/work-in-progress source:

```text
appdata/lisp-draft/**
```

Run/output data:

```text
appdata/data/**
```

AI-derived/session-only Lisp artifacts:

```text
appdata/runtime/dynamic-lisp/**
```

Read-only skill knowledge:

```text
skills/write-lisp/**
```

Rules:

- `lisp/**` is the permanent reusable library, not a scratch directory.
- every user-facing permanent Lisp must have semantic metadata in `registry/lisp-registry.json`;
- drafts are not permanent capabilities and do not enter the permanent registry;
- promotion from draft to permanent must use `lisp_promote_draft`, which updates permanent source and semantic registry together;
- all source files remain ordinary AutoLISP/Visual LISP; `ai_mode=dynamic` only describes whether AI may derive bounded runtime variants from that source;
- runtime variants are not promoted merely because they were generated dynamically.

Do not request generic shell, package-manager, Git, arbitrary filesystem, or application-development tooling. AutoLISP source/data is edited only through CadGPT's sandboxed file/workspace tools.

## Runtime tools

Core file tools:

```text
file_roots
file_list
file_search
file_read
file_create
file_edit
```

Registry/discovery:

```text
registry_list
registry_get
```

Skill/harness/workspace tools:

```text
skill_list
skill_get
lisp_scaffold
lisp_validate
lisp_draft_validate
lisp_promote_draft
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

Baseline resources for meaningful edits:

- `coding-skills/autolisp-dialect-boundary.md` — strict AutoLISP vs Common Lisp boundary.
- `coding-skills/autolisp-language.md` — AutoLISP/Visual LISP source discipline.
- `coding-skills/debugging-and-testing.md` — approved test drawing, verified load, runtime/user-test handoff.

New file or substantial rewrite:

- `coding-skills/library-style-and-scaffold.md` — canonical TBH presentation/file structure.

Task-specific:

- `coding-skills/discovery-and-planning.md`
- `coding-skills/autocad-api-and-dxf.md`
- `coding-skills/selection-and-batch.md`
- `coding-skills/blocks-xrefs-attributes.md`

Do not add generic refactoring, dependency-management, release-engineering, Git-review or application-performance skills. Those abstractions do not match CadGPT's AutoLISP role.

## Required workflow

### 1. Discover capability before reading source

Use `registry_list` / `registry_get` first when looking for an existing Lisp capability. Lisp filenames and command names are not reliable semantic descriptions.

Only read source when reuse/patch/debug/audit actually requires implementation detail.

### 2. Inspect the real CAD requirement

When drawing state matters, inspect structured CAD state before deciding what Lisp must do. Do not infer target geometry visually when AutoCAD can return deterministic layer/entity/block data.

### 3. Prefer reuse, then patch

Preference order:

1. use an existing registered command unchanged;
2. when `ai_mode=dynamic`, derive a temporary parameterized runtime variant by changing only the registry-declared `dynamic_parameters`;
3. patch the smallest relevant implementation surface;
4. add a narrow helper;
5. create a new command only when no suitable implementation exists.

A source with `ai_mode=dynamic` is still ordinary AutoLISP. Dynamic behavior exists in the **AI + runtime adaptation workflow**, not in the Lisp language/file itself.

### 4. Use draft workspace for new/substantial work

For new commands or substantial rewrites:

1. call `lisp_scaffold`;
2. create the working file under `appdata/lisp-draft/**`;
3. edit/test the draft there;
4. do **not** create a permanent `lisp/**` file before the code has passed its applicable test gates.

Small fixes to an already-permanent Lisp may be patched in place when appropriate, but the normal path for risky/substantial changes is to copy/work as a draft and promote after validation.

For an existing file, preserve public command names and working behavior unless the requested contract explicitly changes them. Do not rewrite an entire working file for cosmetic consistency.

For large/destructive batch operations prefer:

```text
collect/classify → validate → mutate → verify/report
```

### 5. Static AutoLISP gate — mandatory

Draft:

```text
lisp_draft_validate
```

Permanent legacy/narrow patch:

```text
lisp_validate
```

The harness rejects recognizable Common Lisp syntax such as Common-Lisp-only binding/control forms, lambda-list keywords like `&optional`/`&rest`, and `#'` reader shorthand. Dialect errors are always errors.

With normal TBH-style enforcement it also checks canonical metadata/header structure, command/header agreement, comments/strings-aware parentheses, duplicate public commands, COM initialization patterns, and relevant cleanup warnings.

A failed static gate blocks AutoCAD load.

### 6. Ask where to test — mandatory

After static validation passes and the Lisp is ready for AutoCAD testing, do not silently choose a drawing.

If the user already explicitly named a test drawing in the current request, use it. Otherwise ask whether to:

1. create a new drawing for testing; or
2. test on the currently bound drawing.

#### New drawing

Call `drawing_create_test`.

If blank-drawing creation is unavailable/fails, do **not** fall back to a project drawing. Ask the user to manually open/create a test drawing, then use `drawing_list` + `drawing_bind`.

#### Current drawing

Use `drawing_status` to confirm the exact bound drawing. The user's explicit choice authorizes the agreed test there.

A project drawing is never implicitly approved merely because it is active/bound.

### 7. Verified load gate — mandatory

Load the exact tested Lisp through the approved Lisp-load path.

The load result must report:

```text
loaded: true
```

A queued command is not proof of load success. When load fails, read concrete error/log evidence, patch the same draft/source, rerun static validation, and repeat load on the same approved test drawing.

Many AutoLISP defects fail at load time before command invocation; these must be fixed before delivery.

### 8. Automated execution vs user interaction

If the command can run deterministically without manual point picking, selection, keyword prompts, dialogs or similar interaction, invoke it and verify structured CAD postconditions.

If manual interaction is required, do not invent prompt input. Once static validation and verified load both pass, ask the user to run the command manually in the approved test drawing.

Valid interactive handoff state:

```text
static validation PASS
verified load PASS
manual command test REQUIRED
```

If the user reports a runtime error, resume the debug loop from that concrete evidence.

### 9. CAD postcondition gate for automated commands

Verify actual drawing state where automation is safe.

Examples:

- expected layer/type counts changed;
- target handles/properties are correct;
- unwanted source/review/detail entities are gone;
- nested block entity layers were changed, not only INSERT layer;
- attributes have expected values;
- expected target layers exist;
- unresolved/unmapped objects are reported.

Edit/static/load/dispatch success alone is not completion.

### 10. Promote only after acceptance

When a draft has passed the applicable gates and is intended to become reusable permanent library code, call:

```text
lisp_promote_draft
```

Promotion requires curated semantic metadata describing what the implementation **actually does**, including class/subclass, `ai_mode`, interaction, load behavior, mutation/destructive risk, inputs, effects and bounded dynamic parameters when AI adaptation is allowed.

`lisp_promote_draft`:

1. re-validates the draft as AutoLISP/TBH source;
2. writes the permanent file under `lisp/**`;
3. derives public commands from the source;
4. upserts the semantic entry in `registry/lisp-registry.json`;
5. blocks command/path collisions with other registered capabilities.

Do not manually copy a draft into `lisp/**` and postpone registry work.

The draft may remain in AppData after promotion for traceability until it is explicitly cleaned.

## AI dynamic usage

`ai_mode` describes **how CadGPT/AI may use a normal AutoLISP capability**:

```text
ai_mode=static
```

CadGPT normally loads/runs the permanent source as stored. `dynamic_parameters` is empty.

```text
ai_mode=dynamic
```

CadGPT may derive a temporary runtime source variant by changing only fields declared in `dynamic_parameters`. The permanent `.lsp` remains ordinary AutoLISP and is not overwritten.

Runtime variants belong under:

```text
appdata/runtime/dynamic-lisp/**
```

They should carry provenance such as source registry ID/path, applied parameters, content hash and run/session identity. They are runtime artifacts rather than a separate Lisp type.

## Run data

Generated reports, mappings, inventories, manifests or other outputs that should survive the individual tool call belong under:

```text
appdata/data/runs/**
```

Do not scatter generated run outputs through repo source folders.

## Debugging loop

```text
classify syntax/dialect/load/DXF/COM/CAD-state failure
→ collect source/CAD evidence
→ patch draft/source narrowly
→ static validate
→ same user-approved test drawing
→ verified load
→ read error/log evidence
→ patch and repeat
→ run when safely automatable
→ inspect postcondition
→ promote only if intended permanent
```

If the failure is caused by Common-Lisp-like syntax, fix the dialect instead of trying to emulate Common Lisp inside AutoLISP.

## Completion / handoff states

### Draft automated test complete

All applicable conditions hold:

- source is AutoLISP/Visual LISP;
- draft static validation passes;
- user approved the actual test drawing;
- verified load passes;
- automated execution is safe;
- structured CAD postcondition confirms the requested result.

The draft is still **not** a permanent library capability until promoted.

### Permanent capability complete

In addition to applicable test gates:

- source exists under `lisp/**`;
- semantic registry metadata describes actual implementation behavior;
- `lisp_promote_draft` (or an equivalent controlled update for a narrow legacy patch) has kept permanent source and registry synchronized.

### User interaction required

- static validation passed;
- approved test drawing confirmed;
- verified load passed;
- command requires manual interaction;
- user is told exactly which command to run and that runtime behavior still requires their manual test.

### Blocked

- concrete load/runtime evidence identifies a blocker that cannot be resolved automatically;
- blocker and untested portion are stated explicitly.

Never hand off changed Lisp with an unverified load state.

## Relationship to Jobs

A Job may call `write-lisp` when required automation is missing or insufficient. `write-lisp` owns the AutoLISP engineering loop only. Once the applicable completion/handoff gate passes, control returns to the exact Job step that invoked it.
