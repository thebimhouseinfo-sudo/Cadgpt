# CadGPT Core Function V5 — Detailed Implementation Plan and Self-Review

**Date:** 2026-10-16  
**Status:** PLANNING REVIEWED (RL-02 PASS — theory alignment and architecture feasibility only) · not implemented · no claim of live CAD success  
**Implementation branch:** `feature/core-function-v5` **only**  
**Human theory authority:** `docs/roadmap/CADGPT_CORE_FUNCTION_V5_BRANCH_PLAN.md` on this branch; informed by RevitGPT `docs/roadmap/P3_CORE_FUNCTION_THEORY_V5.md`.  
**GSA binding:** `GSA-Projects/projects/01a0d70c-9683-7324-9d3d-a8231a93c63b/PROJECT.md` (Goal Drift fence).  

> All engineering decisions below are subordinate to the approved theory. Review may identify bugs and propose smaller fixes; it may **not** introduce mandatory gates or revive deprecated architecture. Where theory has not decided a detail, choose the smallest implementation that preserves safety and practical AutoCAD execution. A coding review is **not** authorization to change the business workflow.

## A. Definition of done and invariant boundaries

**Goal:** ChatGPT plans and authors; CadGPT executes tools against the specifically bound AutoCAD DWG, manages canonical owned files, and advertises reusable capabilities. One Job definition, two execution roles, two lifecycles; no distinct TEST stage.

1. **Operator:** run registered `JOB.md`/`JOB_STEPS` exactly: STEP PASS → NEXT; error → STOP/REPORT. No spontaneous fix, retry, step insertion or hidden fallback. A Job MAY contain reasoning steps explicitly specified by the user.
2. **Builder:** create/edit Job and Lisp **in their owned final folder**; execute on real DWG immediately when requested; if an operation fails, inspect, fix and **re-run only if safe**. No draft/checkout/stage/promote requirement for live execution.
3. **Reusable Job:** owns folder and optional `JOB.md`, `JOB_STEPS`, `lisp/`, `tools/`, `runtime/`, data. Canonical format is `JOB.md` with its declared steps. Registered `JOB.md` from current AppData remains valid; direct `.py` entries are adapted instead of abruptly broken.
4. **Temp Job:** `%LOCALAPPDATA%/CadGPT/temp-jobs/<random-UUID>/`, one own folder, no mandatory `JOB.md`, no Job registration, no whole-Job promotion; Builder performs an explicit conversational step sequence.
5. **Temp result:** **Only when output must persist outside temp folder**, ask the human to name the Drawing Anchor result folder. Enforce bound drawing, unique non-colliding name, canonical location, exact ownership. Don't ask for a name when only scratch files are needed; NEVER use the temp UUID as a default result folder name.
6. **Source ownership:** Job may write its own package/runtime/result; may read or borrow capability of others but must never write their package/runtime/result. Builder explicitly editing an existing Job gains narrowly scoped ownership for that requested Job only, not wildcard access.
7. **Capability borrowing:** borrow a capability identity, not an exclusive tool instance/global lock. Track use by caller execution; invoke underlying capability in its proper owner-authorized execution context. Borrowing does not convey file-write rights.
8. **CAD authority:** one work targets one verified bound DWG, no silent ActiveDocument switch, same-host AutoCAD-facing calls ordered safely; no duplicate ambiguous mutation replay. CAD LOAD success and CAD command success are distinct, and the requested real run is decisive.
9. **Save:** Jobs that mutate DWG explicitly save immediately after the last DWG-changing step, before later file-only work. Fail Save → no Job DONE. No post-draw extra geometry scan required unless a business step asks.
10. **No extra gates:** static parsing, Python compilation, format checks can aid diagnosis; they MUST NOT block real AutoCAD RUN except actual inability to safely execute (missing file, ownership/binding failure, invalid command). No approval loops, synthetic simulation requirements, whole-Job leases/timeouts, compatibility locks, automatic recovery engines or second planner.

**Acceptance is behavior-based**, not a paperwork/CI acceptance gate. Implementation code must compile to be runnable; this engineering necessity is not a separate Job `TEST` step.

## B. Observed source baseline (2026-10-16 V5 branch)

| Location | Existing behavior/dependency | V5 action |
|---|---|---|
| `lib/appdata.ts` | `getJobDraftRoot`, `getLispDraftRoot`, AppData layout; branch predates main Temp Job maintenance | Add dedicated `getTempJobsRoot`. Do **not** import main wholesale |
| `lib/path-security.ts` | realpath/canonical lexical mutation resolver and managed roots | Reuse; add owner-scoped root resolver, reject symlink/junction escapes |
| `tools/filesystem.ts` | generic mutable workspace/data; separate SYSTEM and reasoning runtime roots; draft authoring exception | Centralize effective roots by *current execution + owned package/result*, never globally make libraries writable |
| `tools/jobs.ts` | ~80KB: registry discovery, Direct Python Job, draft new/checkout/validate/promote, runtime tools and compatibility warnings | Separate logical source authoring, publication, execution paths without breaking existing Job IDs |
| `tools/lisp-workspace.ts` | draft-only path assertions, checkout/promote | Replace with owned final-library file authoring and optional publication; keep adapters while migrating |
| `runtime/job-runtime.ts` | bound reasoning Job runtime, Job Steps, system-detachment bookkeeping | Preserve per-run state, bound-result identity; remove unnecessary manual transfers only after equivalent independent file execution |
| `runtime/system-lease.ts` / `tools/job-system-helper.ts` | explicit acquire/release + hash-pinned Python helper under runtime | Decouple file/helper authority from a global named SYSTEM lease while retaining process/file isolation and single-path write correctness |
| `lib/work-registration.ts` / `tools/work-control.ts` | work generations, tool leases, expiry, owner types, CAD binding continuity | Keep real transport/binding identity; align Operator/Builder owner context; do not confuse tool-call lease with whole-Job lock |
| `tools/cad-proxy.ts` | bound-host lock, Lisp LOAD and command handling, execution ownership | Permit **owned Temp Lisp** load; retain verify loaded=true and bound drawing command ownership |
| `tools/job-result-access.ts` / `job-result-patch.ts` | anchored result reads/patches, bound context | Extend to user-named Temp results via exact per-run ownership; do not remove existing Job patch contract early |
| `tools/registry.ts` / `tools/user-assets.ts` | registered capability discovery and user library import/export | Make registration publication only; explicit Lisp promotion from Temp via independent library folder and collision checks |
| `tools/control.ts` / `lib/quickstart.ts` / `server-factory.ts` | cg/* dispatcher and advertised tools | expose `cg/cleartempjob`, creation/discovery with no new workflow controller |
| `lib/job-local-compat.ts` | epoch/contract warnings; current main hotfix warning-only | Retain warnings as diagnostics; remove any remaining user-visible mandatory update/promote wording or blocker |
| Existing `tests/*.test.mjs` | some tests encode deprecated draft/promote and lease semantics | Rewrite only expectations contradicted by approved V5, retain regression tests for real ownership/binding/Save |

**Main maintenance boundary:** current main has minimal Temp Job patches and warning-only test changes not present at V5 branch point. Treat them as reference only. Re-implement any needed behavior according to V5 theory; do not merge/rebase main as a shortcut.

## C. Work packages and exact implementation order

### WP0 — Branch fence and dependency map (no runtime mutation)

**Work:** assert current Git branch and commit baseline; inventory all callers, tool schemas, registry entries, tests, command docs, and upstream path checks for Job draft/Lisp draft, explicit SYSTEM lease, Job compatibility, Lisp LOAD, model binding, Save and runtime result. Record graph `tool → authority → root → executor → result`. Keep separate list of main maintenance fixes eligible for selective backport, *not automatic inclusion*.

**Outputs:** `docs/roadmap/CADGPT_V5_DEPENDENCY_MAP.md` with path/owner/callers/affected test mappings. Do not create feature flags, new staging directories or a parallel planner. **Exit:** all touched interfaces accounted for; no runtime change.

### WP1 — One owner-scoped file authority (first functional slice)

**Work:** implement a tiny canonical ownership resolver using work execution identity, Builder-requested explicit edit target, Job root and bound Drawing Anchor result, Temp ID when applicable. Source edits inside final managed Job/Lisp package are permitted **only by Builder owning that target**, while active Job writes remain restricted to its own runtime and Job result and cannot gain Builder rights through shared work. Check both lexical path and realpath/parent, including Windows junctions. Integrate `file_read/create/edit/delete` and helper input/output. Require atomic or compare-and-set replacement for concurrent edits of the **same file**; no exclusive unrelated Job lock.

**Concrete scenarios:** Builder edits Job A's `tools/foo.py` in place; Job A reads/runs it without re-registering; Job A tries editing Job B source/result → denied; Job B reading A metadata → allowed when drawing identity verified; writes outside owned roots → denied. Avoid granting full `AppData/libraries` writes.

**Exit:** above behavior works with real tools, and DWG write authorization/binding is unchanged. Any failure is fixed directly, not bypassed via Human Power or broad roots.

### WP2 — Direct Job authoring and canonical Job representation

**Work:** keep `JOB.md` plus explicit declared steps as the reusable Job form; author in its final unique library-owned folder; register a newly reusable Job only on user instruction after successful run. Existing registered Jobs remain runnable while editing; preserve aliases, current `JOB_STEPS`, Job ID and file paths. Adapt legacy Direct `.py` to an entry declaration or compatibility wrapper **without forcing a destructive migration**; don't build a second Direct/Reasoning Job taxonomy.

**Run semantics:** Operator follows source steps exactly, records only real step progress, STOP/REPORT on failure; Builder can repair when asked. Single `JOB.md` read on invocation; no automatic Contract Update/Promote requirements after editing an existing Job. Keep scripts and Lisp in own bundle; neither `JOB.md` nor a fake Job steps file is required for Temp Jobs.

**Exit:** current Grille Tag, MTO, CLG Peno and Create System packages still discover/run; source in-place edit is effective on next explicit run; no duplicate registry record or forced extra step.

### WP3 — AutoLISP write, LOAD and reusable publication

**Work:** Builder creates/edits Lisp in owned final Lisp Library or within its Job's `lisp/` directory; `cad__cad_load_lisp_file` can LOAD those and owned Temp Job `lisp/` from real bound drawing with verified path and execution-scoped registered commands. Preserve AutoLISP-only coding rules, no Common Lisp invented forms, correct load/autorun contract, old command ownership and no silent unbound host action.

**Temp Lisp publication:** on explicit human \"register this Lisp\": check name/command ID conflict, copy source and needed data/dependencies into new independent Lisp Library folder (not move), adjust references only where necessary, atomically register and read back. If equivalent to already completed real run, no mandatory extra test; if copy materially changes resolution semantics, only report genuine change and have user run in context if needed. Cleanup Temp won't remove published assets.

**Exit:** working Temp Lisp is loadable and runs on real DWG; after publication its registered copy is independently readable/loadable; conflict is reported without overwrite.

### WP4 — Temp Job allocator and cleanup

**Work:** `%LOCALAPPDATA%/CadGPT/temp-jobs/<random UUID>/` created atomically with collision rejection. Builder retains an owner-to-temp mapping and minimal persistent metadata for cleanup across process restart (not Job Registry): ID, canonical root, owner execution, lifecycle `active/completed`, created/completed timestamps. Temp Job can create `lisp/`, `tools/`, `runtime/` as needed; no required document or step manifest. Never enforce a separate RUN TEST. Running Temp Job has same safe CAD host access as other authorized bound work.

**Results:** if persistent Drawing Anchor result needed, Builder asks user for its meaningful folder name; sanitize/validate user input without changing it silently, make unique exclusive directory under bound drawing's authorized Job results, record per-temp ownership, never overwrite another folder. If user requested simple scratch, store in Temp Job and don't ask.

**Cleanup:** `cg/cleartempjob` removes only completed/inactive recognized owned temp folders (with symlink checks and no outside traversal), `cg/cleartempjob <id>` targets exactly one. Active/ambiguous/unknown ID → skipped with reason. Preserve external named result folders and independently registered Lisp; return count and errors. Retention: **no time duration specified by human**, therefore do not invent TTL or background deletion. Cleanup remains explicit until authorized retention is decided.

**Exit:** concurrent Temp A/B isolated; create/write/run/done/cleanup works without touching other Job; cleanup still recognizes safe completed folders after restart.

### WP5 — Shared capability borrowing, independent Job progress and host operation ordering

**Work:** a caller borrows capability ID but not exclusive global tool; track by execution, release use on completion. Continue file/analysis for Job B while unrelated Job A is active. Preserve same-DWG host serialization at the actual AutoCAD-facing call boundary (including read, selection, LOAD, run, Save). Confirm whether *all* CAD-facing operations already pass through a unified host scheduler; fix only uncovered paths, do not add Job-wide queue. Never replay unknown writes after transport failure or host crash.

**System helper transition:** while migrating `job_system_run_helper`, keep Python execution sandbox `-I`, input paths and source integrity checks where they ensure actual safe execution. Replace manual `job_system_acquire/release` ceremony with execution-authorized, owner-scoped helper calls; do not bypass OS path/process security. Finish/stop releases borrowed capability metadata without deleting pending user results or other Job's runtime.

**Exit:** two independent Jobs use JSON/helper without blocking one another; CAD-facing commands remain correctly serialized and bound; no `JOB_RUNTIME_BUSY` on unrelated work due solely to stale ownership.

### WP6 — Minimal Save, reporting and runtime cleanup

**Work:** require a real `cad__acad_save_bound_document` (or verified equivalent exact-bound Save) immediately following each Job's final DWG-mutating step, before later non-CAD work. No Save on read-only Job. Save failure → report and stop; no DONE claim. **Do not** add redundant geometry rescan or manual acceptance step. For Builder/Temp operation, Save follows authorized mutation workflow where persistence requested, never silently save unrelated drawings. Runtime cleanup only after confirmed inactive ownership; preserve named results, raw inputs still needed and registered assets.

**Exit:** one final bound-DWG Save appears in the correct step position, failures are reported verbatim; no saves against wrong tab/DWG.

### WP7 — Remove obsolete surfaces without breaking existing consumers

**Only after WPs 1–6 produce successful working behavior:** remove/retire obsolete mandatory checkout and promotion routes, draft directories, compatibility blockers, duplicate Direct/Reasoning type gates, old manual SYSTEM lease handoffs and language that demands simulated test/CI before live RUN. Compatibility tool aliases may remain but resolve to supported direct operations or clear migration guidance, not fake successful promotion. Update user-facing `cg/` help, Knowledge/skills/registry descriptions and existing tests. Do not change user-defined Job steps without human instruction.

**Exit:** supported paths don't mention mandatory draft gates; old Jobs and valid registered Lisp still work without source migration; no code path can silently broaden file permissions.

### WP8 — Integration and release, human-controlled

**Build source only from this branch:** maintain a separate Windows worktree and point the V5 tray/test config/build explicitly to its own repo root; verify add-in/runtime/ports/startup and installed DLL cannot accidentally run main code as V5. Avoid running both runtimes against the same production ports or blindly replacing installed AutoCAD add-in. Establish explicit V5 test instance configuration; real CAD operations only on user-authorized bound drawing.

**Regression matrix:** in-place Job source update/run; Lisp LOAD+autorun; manual collector; named Temp results; `cg/cleartempjob`; Temp Lisp register; multiple chats/jobs; bound DWG tab/lifetime safety; Save gate; system/helper file ownership; interrupted writes; restart cleanup; stable tray/binding/recovery. Record actual evidence. Not every one is a mandatory gate to run a Job: these are engineering checks while replacing Core.

**Release remains pending human approval:** snapshot/tag the current `main` before replacement, compare main-only maintenance changes selectively, preserve rollback, and choose a reviewed no-force-push integration method. No V5→main merge until user accepts final behavior.

## D. Execution slices and rollback notes

| Slice | Scope | Rollback |
|---|---|---|
| S0 | Map dependencies, review authority | Docs only |
| S1 | Ownership resolver + direct builder file writes | Revert V5 code to prior commit; no data migration |
| S2 | Reusable Job/Lisp direct authoring | Preserve existing registry/layout; revert adapters only |
| S3 | Temp Jobs and named results + cleanup | Leave user result dirs untouched; disable unfinished Temp control while keeping data |
| S4 | Borrowing + helper/host changes | Preserve old tool names/compatible execution until replacement works |
| S5 | Cleanup old code + V5 deployment | Revert V5 branch runtime; **do not roll back or modify main** |

Don't treat rollback notes as an automatic background recovery engine. Do not auto-delete real user CAD content.

## E. Review loop (RL): required questions for each code slice, not additional Job gates

Before declaring any implementation slice ready, Reviewer checks:
1. Does this change directly implement a human-approved invariant, or does it introduce a **GOAL_DRIFT** feature?
2. Does it introduce draft/checkouts, mandatory promotion/static-test gates, extra approval loops, a second planner, artificial full-Job locks/TTL, simulated AutoCAD correctness or redundant CAD QA?
3. Does it preserve explicit bound drawing and canonical owner-only writes, even across concurrent chats and symlinks?
4. Are existing Job/Lisp IDs, import/export, helpers, data/results, exact Save and read-only workflows still meaningful?
5. Can a failure stop and report without unrequested retry or a forced troubleshooting detour?
6. If user names a Temp result, do we use **exact user intent** and avoid UUID-derived folder names?
7. Is a claimed PASS supported by an actual tool outcome versus only source review?
8. Are all V5 source changes on V5 branch, and is main only maintained independently?

**RL handling:** Reviewer flags `PASS`, `CHANGES_REQUIRED` or `GOAL_DRIFT_REJECT`; Planner repairs the *specific* plan/code and repeats review until no material design contradiction remains. Reviews do **not** add gates to Operator or Builder's RUN lifecycle. Any unresolved human theory ambiguity is documented as a decision point, not filled with novel infrastructure.

## F. Explicit non-goals / deliberate omissions

- No Job-level test environment, separate Test step, fake Revit/AutoCAD simulator, automatic run+test pipeline.
- No Job approval/promote/checkout life cycle, no registry acting as a live-run prerequisite.
- No second autonomous local agent/planner; no code-created business step modifications.
- No wholesale cherry-pick/merge/rebase from main; no local dev runtime silently replacing production tray/startup/add-in.
- No background cleanup TTL until human specifies one; explicit cleanup is sufficient.
- No blanket managed-library writable path; no forced cross-Job serialization or auto-replay.
- No promise of perfect runtime success from static tests alone.

## G. Current plan review state

### RL-01 — CR findings and Planner corrections

| Finding | Severity | Resolution |
|---|---|---|
| "BUILD -> RUN -> FIX" could be misread as a mandatory preliminary QA gate | GOAL_DRIFT risk | Section A explicitly states RUN is the real AutoCAD action; compiler/syntax checks are optional developer aids, not Job TEST stages |
| Temp Job cleanup after restart could silently delete unknown directories | High | WP4 demands persistent minimal owner metadata, explicit completed/inactive evidence, and skip unknown/ambiguous IDs; never delete Drawing Anchor results |
| Editing a registered Job in-place could accidentally give a running Job cross-library source WRITE | High | WP1 separates Builder authoring scope from Operator runtime ownership by execution identity and explicit target |
| Replacing SYSTEM lease by direct helpers could weaken Python/file isolation | High | WP5 retains actual Python process/path/source safeguards, removes only user-visible acquire/release ceremony |
| Broad V5 migration could import changes from main and violate branch independence | Medium | WP0/WP8 maintain separate worktree, no wholesale main merges, reviewed selective maintenance transfers |
| "real run" could encourage retry after uncertain write | High | Sections A/WP5 prohibit implicit replay after ambiguous mutation outcomes |
| User-named result may clash with an existing result | Medium | WP4 requires exact name validation + non-colliding exclusive creation; ask user to resolve conflicts rather than auto-rename |
| WPs labelled "exit" might be implemented as gates blocking Job execution | GOAL_DRIFT risk | Exit criteria are engineering completion checks for V5 delivery, **never a runtime requirement for running a Job or Lisp** |

**RL-01 conclusion:** corrections incorporated in the approved design description above. No new mandatory Operator/Builder run gates created.

### RL-02 — Independent adversarial review, theory vs implementation map

- **PASS:** two roles are ChatGPT execution modes, not competing autonomous agents.
- **PASS:** one canonical reusable Job format; legacy Direct Python is a compatibility adapter, not a second public Job taxonomy.
- **PASS:** Temp Job uses random *workspace* ID and human-named *persistent result* only when needed.
- **PASS:** edit/run in owned folder without draft/checkout/promote, and separately register a reusable Temp Lisp on user command.
- **PASS:** owner-scoped files, bound DWG, actual CAD host ordering, actual Save outcome retained.
- **PASS:** no separate test stage, artificial approval, compatibility lock or whole-Job queue.
- **PASS:** V5 branch is the only development/build branch; main remains independent maintenance.
- **LIMITATION:** static code survey supports the dependency map but does **not** prove each runtime adapter works; implementation still requires real tool outcomes.
- **FOLLOW-UP:** WP0 must enumerate import/export and tool endpoint callers before deleting any legacy surface. This is preventing regression, not adding a runtime gate.

**RL-02 verdict: PLAN PASS for alignment with human V5 theory. Implementation NOT STARTED.**

No source implementation authorized by this document itself.

## H. Implementation checkpoint — 2026-10-17

**Only branch:** `feature/core-function-v5`; no additional feature branch created; `main` unchanged in this implementation turn.

- **WP0 SOURCE MAP WRITTEN:** `docs/roadmap/CADGPT_V5_DEPENDENCY_MAP.md` records real modules and migration order.
- **WP1 PARTIAL SOURCE WRITTEN:** `src/cadgpt/lib/owned-source.ts` implements explicitly scoped reusable Job/Lisp/Temp owner roots, canonical target resolution, per-Temp random UUID generator; `tests/v5-owned-source.test.mjs` exercises own-folder, cross-owner, traversal and symlink rejection.
- **Temp AppData root added:** `lib/appdata.ts` provisions `temp-jobs` in the V5 branch.
- **NOT DONE:** Work/Builder caller authorization integration, file tool routing, Temp Job tool allocator and cleanup, result naming, Lisp direct load/promotion, SYSTEM helper simplification, legacy compatibility conversion, full regression and real CAD. No such outcome is claimed.
- **RUN EVIDENCE:** Source commits verified through GitHub, but Windows TypeScript/test execution remains **UNVERIFIED**. This is engineering work in progress, not Job TEST/PROMOTE machinery.
- **NEXT:** integrate WP1 into Builder-authorized file calls after verifying identity/ownership entrypoint, without granting managed `libraries/**` wildcard write access; keep every change on this same branch.

**Review note:** No V5 gate, extra planner, independent test phase or new branch was introduced. Do not describe partial WP1 as complete WP1.
