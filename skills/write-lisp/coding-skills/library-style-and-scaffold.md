# Coding Skill: CadGPT AutoLISP Authoring Style and Scaffold

Purpose: keep Lisp created or actively maintained by CadGPT structurally predictable without deriving a template from arbitrary user libraries.

## Profiles

CadGPT uses explicit authoring profiles:

- `cadgpt` — default for new or edited Lisp;
- `tbh` — deliberate exception only for `library_id=tbh-toolkit`;
- `syntax` — imported/unmodified source validation; no header/style requirement.

Import and registry indexing never rewrite source. Header normalization occurs only after the user explicitly activates `write-lisp` for an edit and `lisp_checkout` creates a workspace draft.

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

## New-file rule

Use `lisp_scaffold` rather than inventing an ad-hoc file structure. For a TBH Toolkit target, pass `target_library_id="tbh-toolkit"`; otherwise omit it and receive the CadGPT profile.

Create the result under `appdata/workspace/lisp-draft/**`, implement the smallest required logic, validate using the matching profile, then test through the approved CAD workflow before promotion.

## Existing-file rule

For existing managed Lisp:

1. discover it through User Registry;
2. call `lisp_checkout` before editing;
3. checkout copies source into workspace and normalizes only the working header/description;
4. preserve implementation style, public commands and behavior unless the requested change requires otherwise;
5. do not cosmetically rewrite the full file;
6. promote only after validation/testing succeeds.

The managed library copy remains unchanged until promotion. The external source folder used during import is never modified.

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
