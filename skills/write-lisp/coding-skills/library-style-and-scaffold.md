# Coding Skill: CadGPT AutoLISP Authoring Style and Scaffold

Purpose: keep Lisp created or actively maintained by CadGPT structurally predictable without deriving a template from arbitrary user libraries.

## Profiles

CadGPT uses explicit authoring profiles:

- `cadgpt` — default for new or edited Lisp;
- `tbh` — deliberate exception only for `library_id=tbh-toolkit`;
- `syntax` — imported/unmodified source validation; no header/style requirement.

Import and registry indexing never rewrite source. Header changes belong only to an explicitly requested edit through V5 source tools.

## Canonical metadata

CadGPT-authored/TBH-authored working files use the same semantic sections:

```text
File
Module
Command
Description
Inputs
Effects
Interaction
Risk
Dependencies
Notes
Revision
```

Marker brand depends on profile:

```text
CADGPT-HEADER-START / CADGPT-HEADER-END
TBH-HEADER-START    / TBH-HEADER-END
```

The TBH profile preserves the user's company convention; it is not CadGPT's default product convention.

## New and existing files

`lisp_scaffold` returns content and an optional final owned `source_target`, without filesystem mutation. Use `v5_source_create` for explicitly requested reusable source, or Temp source tools for one-off helpers. The reserved bundled `tbh-toolkit` is not a user authoring target.

For existing managed source, read the exact file and latest SHA, obtain exact `cg/update <target>` authorization for saved source, then use `v5_source_update`. Preserve public commands, behavior and implementation style unless the requested change requires otherwise. Do not cosmetically rewrite the full file. The original external import location is never modified. Publish only when requested, through `v5_source_publish`; no checkout/draft/promote stage is required.

## Canonical order

A newly authored substantial command normally follows:

```text
1. canonical metadata header
2. (vl-load-com) when required
3. constants / narrow module globals only when necessary
4. module-prefixed helper functions
5. main c:COMMAND function
6. load banner
7. final quiet (princ)
```

## Main command and helpers

Use AutoLISP locals after `/` and module/command-prefixed helper names to avoid global symbol collisions. When sysvars or undo state change, restore them on normal and error/cancel paths.

Prefer meaningful section comments for substantial commands, not prose on every expression.

## Harness expectation

`profile="syntax"` checks AutoLISP correctness/safety without requiring any CadGPT/TBH header and is therefore appropriate for untouched imported source.

`profile="cadgpt"` or `profile="tbh"` additionally checks the canonical authored metadata block and command/header agreement. Style checks prevent drift only after CadGPT has entered the explicit authoring workflow; they are never a reason to mutate an imported library during registration.
