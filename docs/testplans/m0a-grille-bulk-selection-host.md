# M0a AutoCAD R22.0 host gate — Grille / Grille Tag bulk selection

Status: **PENDING_REAL_CAD**. This checklist is not test evidence. Use a **disposable copy** of the affected DWG, never the client's live drawing. Capture actual failure details before claiming a root cause.

## Purpose

Investigate the reported error during selecting/manipulating multiple blocks containing Grilles and Grille Tags. The source-risk hypothesis is that `ATTSYNC` updates block attributes while a bulk command still uses the prior `ssget` ENAME selection. The candidate implementation snapshots handles before definition mutations and calls `handent` afterward. **This is a hypothesis, not a reproduced AutoCAD exception.**

## Environment and evidence baseline

- AutoCAD 2018 / R22.0, exact acad.exe build, current DWG filename/anchor, active model/layout, and candidate git commit.
- Work on a new disposable DWG copy with a separately backed-up metadata directory. Confirm normal binding and record current header state.
- Capture baseline number of blocks by relevant layers: Hvac-SAGrille, Hvac-RAGrille, Hvac-OAGrille, Hvac-EAGrille, Hvac-TAGrille and Hvac-GrilleTag.
- Before each mutation take per-entity handle + block effective name + exact existing ATT snapshot, plus all RegApp XData payloads by app (including MEP_TAG_LINK and unrelated apps where present). Record forward and reverse tag ownership.

## Bounded test matrix

| Case | Fixture | Action | Evidence/acceptance |
| --- | --- | --- | --- |
| A | 1 grille + 1 tag | `MEP_Properties_Create`, `GRILLE_ATTR_UPGRADE` | No exception, correct counts, stable handle/ATT/XData |
| B | 10 grilles with mixed tag ownership | Same commands after clean reload | No stale ENAME or COM-busy error; no silent skips |
| C | 100 grilles, at least 30 tags and mixed types | Re-run both commands twice | No duplicate ATT definitions, original non-target ATT unchanged |
| D | 500 grilles and multiple tags on different layers | Both commands, then `GRILLE_UPDATE` smoke | No truncation, observe time/COM errors, counters reconcile |
| E | Copied grille + linked original + orphan tag | `GT`/link and `CG` quick regression on copy | Original link unchanged; copied grille starts unlinked; unrelated RegApp XData preserved |
| F | Cancellation, invalid handle, erased tag, locked layer | Cancel/ERASE and rerun on disposable copy | Explicit failures or skips, no reactor recursion, no permanent lock |
| G | Undo/Redo after bulk run | Inspect data and reload same disposable DWG | No unexpected ATT loss or new tag ownership |

For each run record selected/processed/skipped counts, exact AutoCAD command-line error text, current LISP load path, the runtime state and elapsed time. **A syntax-only or source-pattern test cannot satisfy this gate.**

## Root-cause decision

- If the reported exception reproduces with baseline `main` and disappears with candidate patch on the same disposable fixture, and invariants pass, mark **ROOT_CAUSE_CONFIRMED / HOST_PASS** with before/after evidence.
- If a different failure remains, record the exact failing command and stack/error. Mark **ROOT_CAUSE_UNVERIFIED / CHANGES_REQUIRED**, do not broaden the patch by speculation.
- If host cannot be run, mark **BLOCKED_REAL_CAD_VALIDATION**. Do not merge or advertise the patch as production-fixed.

## Source boundaries

- Candidate only: `Annotation/MEP Properties.lsp` bulk selection/attribute workflows and dedicated regression tests.
- No changes to `TabSortV2-2.lsp`. No change to `CG`/tag-link XData policy without separate J01X evidence.
- This M0a gate is independent of the later CAD MCP expansion milestones.
