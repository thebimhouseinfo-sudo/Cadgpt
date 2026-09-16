# Coding Skill: TBH Library Style and Scaffold

Purpose: keep new and substantially rewritten AutoLISP files visually and structurally consistent with the existing TBH Toolkit rather than producing one-off styles.

## Style corpus

The canonical style is derived from the existing TBH AutoLISP library, especially production files that consistently use:

- `TBH-HEADER-START` / `TBH-HEADER-END` metadata blocks;
- `File`, `Module`, `Command`, and `Description` fields;
- public command functions named `c:COMMAND`;
- locals declared after `/` in `defun`;
- `(vl-load-com)` when Visual LISP / ActiveX is used;
- local `*error*` cleanup when commands mutate system/undo state;
- visible section comments for substantial commands;
- a quiet final `(princ)` and a TBH load message for command files.

Representative library patterns include the Setup Xref utilities, `Join Polyline.lsp`, takeoff commands, and the TBH AutoLISP guidelines. Existing files are evidence for API and presentation patterns, but do not copy known defects or obsolete implementation choices blindly.

## New-file rule

Do not compose a brand-new production `.lsp` from an empty page when `lisp_scaffold` is available.

For a new command:

1. call `lisp_scaffold` with file/module/command/description;
2. create the file from that scaffold;
3. fill helpers and command logic inside the existing sections;
4. preserve the scaffold header and closing load banner;
5. run `lisp_validate` before loading.

This keeps files consistent even when different ChatGPT sessions create them.

## Canonical order

Production command files should normally follow this order:

```text
1. TBH metadata header
2. (vl-load-com) when required
3. constants / narrow module globals only when necessary
4. module-prefixed helper functions
5. main c:COMMAND function
6. load banner
7. final (princ)
```

Do not shuffle these sections without a concrete reason.

## Header contract

A production command file must contain:

```text
;;; TBH-HEADER-START
;;; File        : ...
;;; Module      : ...
;;; Command     : ...
;;; Description : ...
;;; TBH-HEADER-END
```

`Command` must match the public `c:` command(s) in the file. Update metadata whenever behavior or public commands materially change.

## Main-command presentation

Use a predictable command shape:

```lisp
(defun c:COMMAND (/ *error* local1 local2)
  ...
  (princ)
)
```

When sysvars or undo state are changed, save state before mutation and restore it on both normal and error/cancel paths.

## Helpers

Helper names should use a module/command prefix, for example:

```lisp
xrefmap:read-row
rvt2cad:entity-system
gr:collect-attributes
```

Avoid generic global helper names such as `get-data`, `process`, or `helper` that can collide when many `.lsp` files are loaded together.

## Comments and section dividers

Use comments to separate meaningful stages in a long CAD command, but do not turn every expression into a prose annotation. Prefer stable section labels such as:

```text
;; =============================================================================
;; Selection / classification
;; =============================================================================
```

or short `;;` comments that explain CAD-specific reasons.

## Existing-file rule

For a narrow patch, preserve the local style of a working legacy file unless style inconsistency directly causes a defect. Do not rewrite the whole file merely to match the newest scaffold.

For a substantial rewrite or new file, use the canonical scaffold so the library gradually converges instead of becoming more fragmented.

## Harness expectation

`lisp_validate` checks the production header contract, command/header agreement, AutoLISP dialect boundary, source structure, and selected library conventions. Style diagnostics are there to prevent drift, not to force cosmetic rewrites of untouched legacy code.