# Skill: write-lisp

Status: **active** — AutoLISP/Visual LISP for AutoCAD, V5.

AutoLISP is not Common Lisp. Preserve working public commands and patch the concrete fault narrowly. Do not generate permanent Lisp merely because the user requests a CAD task: reuse a tool/command or use Temp unless reusable authoring is explicitly requested.

## TBH HVAC numeric system shortcuts (internal Lisp authoring rule)

When a TBH Toolkit Lisp prompts for an HVAC **system type**, the ONLY numeric
mapping is `1=SA, 2=RA, 3=OA, 4=EA, 5=TA`. Keep all three surfaces in sync:
the printed prompt, `initget` accepted keywords, and the branch/normalizer
that resolves the selected number. Never reuse the legacy round-duct
`0=SA, 1=RA, 2=EA, 3=OA, 4=TA` mapping, or label `3` as EA in CD.
The digit `0` may still mean Exit in unrelated menus; insulation, shape,
and geometric type menus are NOT HVAC-system selectors and keep their own
numbering. Preserve existing correct geometry logic while fixing shortcuts.

The regression gate is `tests/tbh-system-shortcuts.test.mjs`, which scans every
bundled TBH `.lsp` and asserts numeric mappings for major commands.
This is **internal Lisp authoring guidance**, not KUG/KUD HVAC domain knowledge.

## Ownership and authoring

Bundled `resources/cad/internal-lisp/**` (including TBH Tool Kit) is read-only Internal Registry content. User reusable source lives in `appdata/libraries/lisp/<library-id>/<folder>/**`. External user folders are import sources only; import/index must not rewrite their source or headers. Custom variants use a distinct User Library id.

Discover existing capabilities through Registry when reuse is relevant. For explicit new authoring, `lisp_scaffold` returns content and an optional final `source_target`; it does not write a file or require an existing library. Create/update final owned source with `v5_source_create` / `v5_source_update` in Builder Work, using the latest SHA for updates. Same-session new unpublished source can continue across Work cleanup. Existing saved/imported source needs exact user `cg/update <target>` authorization. Do not infer newness from missing Registry entries.

Use `temp_job_create`, `temp_job_source_create`, `temp_job_source_read` and `temp_job_source_update` for one-off source; updates use the read SHA. Temp ownership follows the logical session across Work changes. Never create reusable libraries as an implicit side effect of one-off execution.

## Validation and execution

`lisp_validate` accepts exactly one of raw `source` or managed `path`. Default new/edited source profile is `cadgpt`; untouched imported source may use `syntax`. The `tbh` profile is internal company guidance, not permission to write the reserved bundled library. Canonical authored metadata includes File, Module, Command, Description, Inputs, Effects, Interaction, Risk, Dependencies, Notes and Revision.

When a development shell is available, use the shared checker:

```text
npm run test:lisp-syntax -- <file.lsp> --profile=cadgpt --expect=COMMAND
```

Static validation detects source problems but does not prove AutoCAD behavior. Execute the exact source with `cad__cad_load_lisp_file`, require real `loaded:true`, then use `cad__cad_run_lisp_command` and check the relevant postcondition. Use the task's authorized bound drawing; ask about the drawing only if the intended target or test mutation is unresolved. Never silently switch to another drawing on failure. Do not claim native success when the CAD host is unavailable.

Source-path execution does not require Registry publication. When publication is requested, use `v5_source_publish`; edits do not publish automatically. Retired draft/checkout/promote APIs are internal compatibility implementations and are not exposed over MCP. There is no mandatory draft/test/promote lifecycle or global compatibility scan before RUN.

See `harness/README.md` and `coding-skills/` for AutoLISP engineering details. Follow `knowledge/jobs/JOB_RULES.md` for runtime ownership, verified Save and STOP/REPORT.
