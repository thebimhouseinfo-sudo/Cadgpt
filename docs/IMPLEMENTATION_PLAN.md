> Current Human-requested Criteria repair: [2026-10-23 plan](plans/CADGPT_CRITERIA_REPAIR_2026-10-23.md). The imported R3 below is retained as historical planning context; it is not a new execution grant or current verification result.

# CadGPT V5 — Implementation Plan R3 (2026-10-21)
**Status:** PLANNER R3 / CRL R2 FAIL; awaiting GSA replacement Job and current Reviewer. **Criteria:** APPROVED unchanged (`CRITERIA.md`, SHA d43f32b179a46007efb663591d260925f3cbbe06). **CadGPT target:** `thebimhouseinfo-sudo/Cadgpt` branch `feature/core-function-v5`; baseline `eadc45b5f0c993c0977c9047c84c49732688d9b2`. **Job:** J-0E2C. No main/merge/deploy or production-DWG edits. Predecessor plan is preserved in Git history. P0 source investigation COMPLETE, native still UNVERIFIED.

## 1. Binding UX contract and precise domain
- Direct Job: a straightforward CAD action with one to a few Tool/Macro calls, **no reasoning about a multistep procedure**. Do not create Temp source/Job source for it.
- Temp/Disposal Job: a relatively complex one-off task that calls for Human workflow explanation, data and/or iterative correction. Owns random AppData `temp-jobs/<UUID>/` and only explicitly named persistent Drawing Anchor result if necessary. No mandatory JOB.md, Registry or promotion.
- Custom Job: explicit permanent Job-authoring request; Operator runs existing JOB.md; Builder authors/fixes permanent source. Registered Lisp and Temp Job Lisp are not “reusable” permission categories. Temp Lisp may be selectively registered, or Temp workflow adapted into Custom Job, **only on Human request**.
- Job owns source in its final creation folder and the results assigned to it; cannot edit any other Job's source/runtime/result. Operator follows JOB.md, can write its permitted per-run Data in its runtime but cannot rewrite the fixed Engine. Builder can continue correcting source **not yet saved** across legitimate Work changes, within exact owner scope. Existing **saved** Job/Lisp source requires exact Human-issued `cg/update` scoped to one named target and one logical multi-file operation. Registry writes replace only that capability's own entry. Source Save, Registry publication and DWG Save are distinct. Publication/discovery is never a RUN prerequisite; do not infer saved status merely from file existence or absence from Registry list.
- Minimize UI/tool round trips. All Work/lease/owner/hash housekeeping internal, never ask Human to type a SHA or perform Draft/Checkout/Promote-for-test; protect real host and owner invariants only. Do not invent a second planner, mandatory approval, artificial timeout, retry of uncertain CAD writes, or new formal taxonomy.

## Independent CR R2 findings resolved for R3
- The authoritative evidence that a Job/Lisp source became **saved/established** must be persisted and attributable to that exact owned asset. It is not inferred from directory existence, the current Work ID, or the absence of a Registry listing. Existing already-saved assets remain protected across migration, stale/disconnected Registry views and restarts. This is an internal implementation invariant, **not** a new Human dialog, publish-before-run step, or separate certification. Identify the existing persisted lifecycle/Registry source of truth first; add only the smallest necessary stable marker if demonstrably absent.
- The selected capability's Registry transaction may atomically replace/upsert **its own logical entry**; no changes to unrelated entries except necessary enclosing manifest serialization. Include regression with two saved Jobs + two Lisp entries, interrupted publish/restart, readback, and foreign asset byte equality.
- GSA planning lifecycle finding: current J-0E2C READY revision 1 cannot be revised via `job_revise_plan`. Its old Reviewer PASS is *not* evidence of R3. Official replacement planning Job and a current attributed Reviewer PASS must precede a valid final CR PASS. Do not manually edit Job JSON or forge verification. This is GSA's planning bookkeeping, not a CadGPT runtime gate.

## 2. Repair work packages (same branch; smallest code patches + focused tests)
### WP0 — Baseline and tool-surface audit
Check git HEAD, existing public tools/skills and callers, source of truth, Windows/Ubuntu CI and available native runner. Snapshot public tool names and classify canonical vs compatibility vs obsolete before pruning; preserve user data. Label earlier V5 source roadmaps historical rather than active conflicting commands. Oracle: one authoritative rule set and a removed-tool caller migration/negative-test map.

### WP1 — Intent-first routing and public surface
Correct quickstart/skills/prompt and public MCP tool descriptors: short direct CAD operations invoke direct Tool/Macro; complex user-guided/data-intensive requests invoke Temp; named Custom Job invokes Operator; only explicit Create Job or Write Lisp enters Builder source authoring. Retire publicly competing `file_temp_lisp_create`, legacy Lisp checkout/draft, Job draft/validate/promote-draft after exact caller assessment. Preserve internal compatibility where strictly necessary and Registry list/get + explicit metadata Publish. Tests: direct list-layer/block edit never permanent-writes; fan from image goes Temp; existing Job never starts Create; explicit Writer creates final package; exposed tool list has one canonical route each.

### WP2 — Temp Job complete owned workflow
`temp_job_create` → exact `temp_job_source_create/read/update` → `temp_job_lisp_load` and actual autorun when authored that way → bounded result/Save → done/cleanup. Source read returns current hash for correction; no cross-owner; retain source continuity across legitimate Work transitions without exposing one owner's source to another independent chat; no broad generic FILE rights. Dispose only verified inactive owned Temp folders; durable results persist; preserve old shared files pending explicit exact ownership cleanup. Test wrong tool/path, mismatched owner, Work continuation, conflict/failed run/retry, read/update/load, Save-before-done.

### WP3 — Builder saved-source ownership and Registry
Replace execution-scoped new-package shortcut and Job-only `cg/jobupdate` with stable authoritative own-source state and exact `cg/update` for a **saved** Custom Job or Registered Lisp. Preserve un-saved source authoring across Builder Work and safe hash concurrency handling silently; Writer target precise, no other Job write. Do not conflate registry publication with file existence or DWG Save. Publication updates **only target** Registry entry, handles partial failures and preserves saved protection where needed; allow direct pre-registration execution. Tests: create JOB.md + nested lisp then new Work edit; unsaved Lisp edit; saved Job/Lisp denies ordinary mutation; `cg/update` one target multi-file then expires; Registry foreign entry unmodified; operator writes runtime Data but not Engine; no re-promote to run.

### WP4 — Actual CAD execution, Direct completion and persistence
Inspect source/host boundaries including Python Lisp 8s and Direct Python 5min deadlines; remove unsupported execution timeouts (leave connection health checks as appropriate). A LOAD/queued SendCommand is not geometry completion. Host serialized command FIFO, exact bound DWG/Anchor, Save verified *after last actual mutation* for Direct, Temp and Custom; failed Save prevents DONE, with no blind retry of uncertain writes. Test source integration and controlled native long autorun/queue/Save/reopened drawing.

### WP5 — Binding, multi-chat and Job lifecycle
Validate direct Connect to explicit DWG, no silent tab rebind, stable Drawing Anchor across rename/SaveAs/copy, quick multi-chat, independent Jobs' file work concurrent and CAD commands serialized on host only; narrow same-Job mutable-root exclusion; `cg/jobstop` only selected Job. Avoid global locks and forced reconnect. Test chat A/B different bind, 0/1/2 DWG, active tab, host restart, simultaneous distinct Jobs, same-Job contention and stop/resume.

### WP6 — Native UX integration and regression closure
Run full E2E intent→role/Work→tool→source/DWG owner→CAD completion→result→Save→cleanup. Build Node/TS, Python and .NET tests where actual runners exist; cross-platform GitHub CI; copied DWG human gate. Never claim source simulation or CI as native PASS. Reject regressions in established Custom Jobs/Lisp; capture precisely which user flow fails and remediate root cause in same feature branch. Human acceptance controls merge/release.

## 3. Test matrix and measurable acceptance
| ID | User workflow | Pass condition |
|---|---|---|
| D1 | list layers / simple edit | No Temp/Writer path, correct drawing, mutation saved |
| T1 | fan image + extra instructions/data + correction | Own Temp source read/edit/LOAD/autorun; no shared Lisp; Save and safe cleanup |
| J1 | create Custom Job with JOB.md and bundled Lisp | Continues across Work, direct RUN without Registry, no false cg/update |
| J2 | run existing Custom Job | Operator adheres JOB.md; runtime Data mutable; Engine stable; own results |
| J3 | edit saved Custom Job | One exact Human cg/update; selected Job only, multi-file logical edit |
| L1 | create/edit unsaved Lisp then save | No checkout/draft/registration RUN gate |
| L2 | edit saved Registered Lisp | Exact cg/update, foreign Lisp unchanged |
| P1 | publish selected Temp Lisp / adapt Temp Job on request | Independent registered capability; unrelated Temp/source untouched |
| B1 | two chats and two DWGs/Jobs | No wrong DWG or global lock; serialized CAD commands |
| S1 | long LOAD and queued commands | Actual completion determined before save, reopened DWG contains changes |
| X1 | negative/host error paths | Correct denial for foreign writes; safe error/cleanup; no fake DONE |
| U1 | public tool discovery | No obsolete ambiguous drafting/shared-temp writers exposed |

Evidence labels: FIELD_OBSERVED / SOURCE_PREDICTED / EXECUTED_PASS / EXECUTED_FAIL / NATIVE_UNVERIFIED. Each result states exact owner, tool, error and persisted effect. No mandatory fake CAD TEST.

## 4. Dependency topology, review and limits
WP0 → WP1/WP2/WP3; WP1+WP2+WP3 → WP4; WP4 → WP5 → WP6. Within each bounded patch: Coder→Reviewer RL until PASS; CR checks after Reviewer PASS; CR FAIL → Planner/Coder correction → new Reviewer RL until PASS → CR again (CRL contains RL). Do not mark CR PASS before attributable verification. Native copied-DWG evidence is a release/implementation acceptance checkpoint, **not a gate to authorize correcting the code**. If real AutoCAD tool not available, mark NATIVE_UNVERIFIED.

**Branch fence:** only `feature/core-function-v5`. No main merge/rebase, production deployment, forced push, COM→native DLL migration, or CAI/provider expansion. Preserve rollback options and baseline tests.

**Evidence sources:** `CRITERIA.md`, `HANDOFF_20261021_P0_REOPENED.md`, `PHASE0_FLOW_EXECUTION_SIMULATION_R4.md`, `FIELD_BUG_CREATE_EQM_UNPUBLISHED_SOURCE.md`, `PHASE0_CLOSURE.md` and CadGPT source at pinned HEAD.
