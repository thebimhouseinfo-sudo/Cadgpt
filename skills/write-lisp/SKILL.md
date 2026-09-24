# Skill: write-lisp

Status: **active**

`write-lisp` is CadGPT's specialized **AutoLISP/Visual LISP for AutoCAD** engineering capability. It is not a generic Lisp or application-development agent.

## Core rules

> AutoLISP is not Common Lisp. Registry first. Patch before rewrite. External user folders are import sources only. Imported source is never modified during registration. Every source mutation uses an explicit absolute canonical path inside its approved root. Editing starts from a managed AppData copy and must pass static validation + verified AutoCAD load before promotion.

CadGPT owns the authoring workflow, not the user's original library folder.

## Storage

```text
appdata/libraries/lisp/**              managed reusable Lisp Libraries
appdata/workspace/lisp-draft/**        write-lisp working copies
appdata/runtime/dynamic-lisp/**        temporary AI-derived variants
appdata/data/runs/**                    generated evidence/reports
skills/write-lisp/**                   internal read-only skill knowledge
```

User-selected external folders are accessible only through `library_import`, which copies them into `appdata/libraries/lisp/<library-id>/**`. CadGPT never writes back to the external source.

## Registry/discovery

Use `registry_list` / `registry_get` before reading source. User Registry Lisp entries identify managed code with:

```text
library_id + relative_path
```

Import/index must not rewrite source, headers or descriptions. Registry metadata may describe actual implementation more accurately than a legacy header.

## Authoring profiles

CadGPT does **not** analyze user libraries to invent a style template.

- default new/edited Lisp profile: `cadgpt`
- explicit exception: `library_id=tbh-toolkit` → `tbh`
- imported/unmodified validation: `syntax`

Canonical authored headers keep clear metadata fields: File, Module, Command, Description, Inputs, Effects, Interaction, Risk, Dependencies, Notes, Revision.

Existing Lisp remains untouched merely because it was imported. When the user explicitly activates `write-lisp` to modify it, `lisp_checkout` creates a workspace draft and normalizes the header/description **in the draft only**. TBH Toolkit keeps the TBH header; other libraries use the CadGPT header.

## Main tools

```text
library_list
library_import
registry_list
registry_get
file_list
file_read
file_search
file_create
file_edit
lisp_scaffold
lisp_checkout
lisp_validate
lisp_draft_validate
lisp_promote_draft
drawing_list
drawing_create_test
drawing_bind
drawing_status
cad__cad_load_lisp_file
cad__cad_run_lisp_command
```

Use structured CAD inspection tools where they express the requirement/postcondition directly.

## Required workflow

### 1. Discover and inspect

Search User Registry first. Read implementation only when reuse, modification, debugging or audit needs source detail. Inspect structured CAD state before designing drawing-dependent automation.

### 2. Prefer reuse

Order of preference:

1. existing registered command unchanged;
2. if `ai_mode=dynamic`, derive a temporary runtime variant changing only declared `dynamic_parameters`;
3. narrow patch;
4. narrow helper;
5. new command only when necessary.

`ai_mode=dynamic` is an AI usage mode, not a Lisp type.

### 3. Existing Lisp: checkout before editing

For a registered capability that must change, first resolve the absolute workspace root with `file_roots`, choose the exact absolute draft target under `appdata/workspace/lisp-draft/**`, then call:

```text
lisp_checkout(
  registry_id=...,
  draft_path=<absolute .lsp path>
)
```

A relative/CWD-derived draft path is invalid. If that draft already exists, checkout requires `overwrite_existing=true` plus the current `expected_sha256`; never silently reset another execution's draft.

Checkout copies the managed library source to the explicit absolute draft and applies the appropriate CadGPT/TBH authoring header in the working draft. The managed library source is unchanged until explicit promotion.

Preserve public commands and working behavior unless the requested contract changes them. Do not rewrite whole files for cosmetic consistency.

### 4. New Lisp: scaffold into workspace

Call `lisp_scaffold`. It uses CadGPT header by default; pass `target_library_id="tbh-toolkit"` only when the intended target is TBH Toolkit.

Create/edit the result using absolute paths under `appdata/workspace/lisp-draft/**`. Use `file_create` / `file_edit` only with the absolute path returned/resolved for that draft; `file_edit` also requires the latest SHA-256 from `file_read`.

### 5. Static validation — mandatory

Managed imported source may be inspected with:

```text
lisp_validate(profile="syntax")
```

A write-lisp draft must use its authoring profile:

```text
lisp_draft_validate(profile="cadgpt")
```

or for TBH Toolkit:

```text
lisp_draft_validate(profile="tbh")
```

The harness checks AutoLISP/Visual LISP syntax/dialect, balanced strings/parentheses, public commands, Common-Lisp-only constructs, COM initialization and relevant safety warnings. CadGPT/TBH profiles additionally enforce the canonical authored header.

A failed static gate blocks CAD load.

### 6. Test drawing approval — mandatory

After static validation passes, use an already-explicit user choice if one exists. Otherwise ask whether to create a new test drawing or use the currently bound drawing.

Never silently test on a project drawing. If `drawing_create_test` fails, do not fall back to a project drawing.

### 7. Verified same-window load — mandatory

Use `cad__cad_load_lisp_file` on the exact already-bound drawing/AutoCAD host. The load path may be a CadGPT Lisp virtual path or a canonical absolute path that resolves inside one of these approved roots:

```text
resources/cad/**
appdata/libraries/lisp/**
appdata/workspace/lisp-draft/**
appdata/runtime/dynamic-lisp/**
```

A result with `loaded: true` is required. Queued `SendCommand` is not proof of load success. Do not open a second AutoCAD instance just to test the file.

If load returns `loaded: false`, preserve the AutoCAD error evidence, patch the draft narrowly, rerun static validation, and load again in the same bound drawing until PASS or a real environment/dependency blocker is identified.

### 8. Functional execution — only when required

Static PASS + verified same-window LOAD PASS is the normal source/load reliability gate. Do **not** turn every Lisp edit into a full functional QA cycle.

Run the command and verify CAD postconditions only when the requested task, a concrete Job, or the changed behavior requires functional proof. For commands requiring manual selection/point/keyword/dialog interaction, do not invent input; after static + verified load PASS, hand the named command to the user for manual interaction.

### 9. Promote only after acceptance

Use `lisp_promote_draft` with:

```text
draft_path      = absolute tested workspace draft
target_path     = absolute managed-library target
library_id
relative_path
curated semantic metadata
```

`target_path` must exactly equal the managed target implied by `library_id + relative_path`. If replacing an existing managed target, supply `overwrite=true` and its current `expected_target_sha256`.

Promotion re-validates with the target library's authoring profile, writes the managed AppData library copy, derives commands and synchronizes User Registry rollback-safely.

Do not write to the original external import source.

## Dynamic runtime variants

For `ai_mode=dynamic`, temporary variants live under `appdata/runtime/dynamic-lisp/**` and should retain source registry id, applied parameters, hash and run/session provenance. The permanent managed source remains ordinary AutoLISP.

## Debug loop

```text
classify failure
→ collect source/CAD evidence
→ patch workspace draft narrowly
→ static validate
→ same approved test drawing
→ verified load
→ if load fails: patch → static validate → reload same drawing
→ functional execution only when required
→ promote only if intended reusable
```

## Completion

A reusable modified/new capability is complete only when the applicable CAD test gates pass and the managed library source + User Registry are synchronized. An interactive command may be handed to the user only after static validation and verified load both pass, with manual runtime test clearly outstanding.

## Relationship to Jobs

Concrete Jobs are User Registry assets under managed Job Libraries. Job rules/specification are CadGPT internal knowledge. A Job may call `write-lisp`; once the Lisp gate completes, execution returns to the interrupted Job step.
