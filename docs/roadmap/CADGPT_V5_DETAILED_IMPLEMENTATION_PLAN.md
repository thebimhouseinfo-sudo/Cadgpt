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

## I. Implementation checkpoint — 2026-10-17 continuation

- Only `feature/core-function-v5` was modified; no branch split, no main update.
- V5 Temp Job runtime was implemented in `src/cadgpt/runtime/temp-job-v5.ts` with UUID-specific owned folders, independent persisted metadata, Builder execution ownership, source creation, SHA-guarded FIX updates, explicit DONE and completed-only cleanup.
- MCP tools `temp_job_create`, `temp_job_source_create`, `temp_job_source_update`, `temp_job_done`, `temp_job_clear` are registered via `server-factory.ts`; `cg/cleartempjob` reaches the cleanup route.
- Source-level regression coverage: `tests/v5-temp-job-lifecycle.test.mjs`, in addition to `tests/v5-owned-source.test.mjs`.
- **NOT YET COMPLETE:** This is NOT the full WP4 definition: user-named Drawing Anchor results, Temp Lisp CAD LOAD+autorun, selective Lisp publication and full cross-restart/parallel safety have not been implemented. Reusable Job/Lisp in-place authoring and removing old draft/SYSTEM paths are likewise pending.
- **NOT RUN:** no verified Windows TypeScript build, no suite results, no real bound AutoCAD. The presence of tests is an engineering safety measure; never turn them into a mandatory Job TEST stage.
- **Review finding:** A Temp Job can be marked DONE without automatically running or saving DWG; this is deliberate: Operator/Builder verifies actual operations, not the cleanup facility. Cleanup skips missing/ambiguous state.
- **Next:** integrate exact Builder reusable-source authoring and Temp Lisp bound CAD use, with no broad filesystem roots, then user-named Drawing Anchor results and independent Lisp registry publication. Preserve all V5 goals.

## J. Implementation continuation — 2026-10-17

- **Same branch only:** `feature/core-function-v5`; no main edits.
- Temp Job same-file source updates now serialize under the existing file scheduler; reject absolute/Windows-rooted/traversal source paths and symlinked metadata. Source creation rejects overwrite.
- Implemented explicit `temp_job_result_create`: an independently user-provided result folder name (never UUID), exact verified bound Drawing Anchor, existing jobs result parent, non-overwriting directory create. The user must supply a name only when persistent results are wanted.
- `tests/v5-temp-job-lifecycle.test.mjs` traversal expectation updated to reflect explicit invalid-relative-path error.
- **Unverified:** no build/test execution or actual CAD actions yet. Source reviews only. The result creator currently provisions the folder; scoped result write authorization remains future integration work. Do not imply full end-to-end Temp result workflow.
- **RL finding:** the Temp Job runtime must not use general AppData writable roots; source tool validates owning Work. Future authoring and result writes must keep that property. Another finding: returning a newly provisioned folder is not equivalent to persisting output. These are code-completion findings, not business/Job TEST gates.
- **Next priority:** connect reusable Job/Lisp in-place editing with exact Builder target scope; then integrate scoped result writes, owned Temp Lisp CAD LOAD and selective independent Lisp publication. The full system is NOT READY for pull or acceptance.

## K. Implementation continuation — 2026-10-17 (second continuation)

**All source updates on `feature/core-function-v5` only.**

Completed source slices:
- Scoped `temp_job_result_write` writes a new text result into the exact, user-named Drawing Anchor folder under a single verified bound DWG; refuses cross-anchor, overwrite, traversal and non-text workbook masquerading.
- `v5_source_create` and `v5_source_update` directly author reusable Job/Lisp source in an explicit owner folder; Builder-only active Work with file authority and same-file SHA conflict checks. These are direct authoring tools, not new draft/promote gates.
- `temp_job_lisp_load` invokes the existing verified CAD loader rather than a simulator. Lisp path policy admits only an *active, owning Builder execution*'s Temp Lisp; ordinary loads from arbitrary Temp directories remain rejected.
- Temp source same-file mutations and Windows traversal restrictions hardened, retaining the canonical resolver.

**Remaining major engineering work (not hidden):**
1. WP1: integrate Builder source grant and exact Job runtime boundaries into legacy generic FILE/Job helper routes; direct tools currently coexist with old draft surfaces.
2. WP2: replace old source/routing distinction for Direct vs Reasoning registered Jobs, preserve existing named Job flows; remove compulsory promotion/checkouts.
3. WP3: selective Temp Lisp copying + independent registry publication with dependency resolution; prove AutoCAD upstream loader accepts Temp file and real LOAD/run.
4. WP4: result ownership lifecycle and collision/concurrency recovery; explicit `cg/cleartempjob <id>` form remains absent from fake CLI.
5. WP5: capability borrowing and simplification of SYSTEM lease orchestration.
6. WP6: uniform save-after-last-CAD-mutation for all reusable Jobs, including legacy Direct Python cases.
7. WP7: retire old draft, lease and compatibility-gate paths after replacement is functional, including docs/skills and tests.
8. WP8: Windows build, regression, live CAD, installed tray/add-in independent release proof.

**RL checkpoint:** No extra user Job RUN/TEST/promotion gate was introduced. `v5_source_*` uses an explicit Builder work role; independent Job execution cannot call it. CAD loader reuse preserves bound host authority. **No claim of build PASS, no real CAD acceptance, no user pull requested.**

## L. V5 implementation checkpoint — 2026-10-17 continued

Commits through `4a803368e69fd27c4a91f86e0306a6b12e21b21a` on `feature/core-function-v5` **only**. `main` untouched.

**Implemented source (not runtime-PASS):**
- `temp_job_lisp_publish`: explicit user-triggered copy of the *selected Lisp-containing folder* and its accompanying assets into an independent managed Lisp Library via existing `importLibrary`; no promotion of the Temp Job and no forced post-copy run. Does not delete originals.
- Added registry collision rejection for existing library IDs and duplicate Lisp command names before writing new managed Lisp library; no silent overwrite.
- `tests/v5-temp-lisp-publish.test.mjs` covers independent copy, repeated library rejection and command collision (test source created; execution not verified).

**Remaining issues:** publication is folder-granular (the user should explicitly name the selected folder), and copy of dependencies outside that folder is not yet supported; the current tool description must not claim broader dependency closure. Existing `importLibrary` publish does not implement a transactional registry update across multiple JSON files—review/fix as part of registry simplification. Legacy Job runtime, capability borrowing, save normalization, abandoned draft paths, and full Windows build/live AutoCAD remain open. No human pull request yet.

**Goal review:** selective independent Lisp publication is permitted by the approved theory; mandatory Temp Job promotion, mock CAD test and new approval gates were not introduced. Engineering regression tests remain development evidence only.

## M. Implementation checkpoint — 2026-10-17

**Only feature/core-function-v5 modified.** Fixed a blocking TypeScript integration defect: `temp_job_lisp_publish` imported `importLibrary` without it being exported; `user-assets.ts` now exports the existing publisher. Hardened reusable Lisp publication: case-insensitive command/library ID collision detection, same-file registry mutation serialization, unique import staging, and no deletion of a different import's staging folder. Regression source is still present.

**RL finding retained (not marked PASS):** multi-file `libraries.json` + `capabilities.json` updates are not yet an atomic single transaction across crash; replacing an existing library also needs a backup/restore path. Existing `replaceExisting=true` remains legacy behavior and V5 Temp Lisp publisher only requests `false`. Do not claim publication entirely crash-safe or V5 complete until fixed and built.

**Remaining:** full legacy Job/runtime authority conversion, namespace stabilization, multi-Job/capability borrowing, Save standardization, draft/SYSTEM gate removal, Windows compilation/regression, and live AutoCAD acceptance. No human pull requested.

## N. Continuous implementation and RL checkpoint — 2026-10-17

**Branch:** `feature/core-function-v5` only. No child branch, main unchanged. This section records source evidence; **no Windows build or AutoCAD test has occurred**.

### Implemented and reviewed in this continuation

1. **Critical build blocker fixed:** `src/cadgpt/tools/user-assets.ts` erroneously contained `export export async function importLibrary`. It now exports precisely once. This was an actual source syntax error.
2. **Stricter owner-root resolution:** `owned-source.ts` now checks canonical identity of the entire owned root before any Builder source write, rejecting junctions/symlinks pointing to sibling Jobs even within a shared library. `v5-builder-source.ts` validates owner root before creating directories and excludes internal TBH Toolkit writes. Regression source tests added.
3. **Temp Job resilience:** Result creation removes a *still-empty* newly created folder when metadata commit fails; cleanup remains explicit. `cadgpt_control` now accepts an optional UUID for `cg/cleartempjob <id>`, as well as all completed Temp Jobs.
4. **SYSTEM helper migration:** `job_system_run_helper` now accepts execution-owned prepared Job runtime without manual `job_system_acquire`. It keeps legacy SYSTEM leases and the existing hash-pinned helper snapshot, input JSON validation, explicit owned paths, `python -I`, and owned result roots. Tool authority is `work-or-system`, with no broad write grant. Regression authority assertions added. Legacy acquire/release APIs remain until callers migrated.
5. **Legacy tool guidance:** `job_draft_new`, `job_checkout`, `job_promote_draft` now explicitly describe themselves as legacy compatibility paths, not V5 required stages. `cg/cj` and `cg/cl` instruct direct owned Builder authoring and real CAD LOAD/RUN.
6. **Publication consistency:** Unique staging/registry temp filenames, serialized in-process publication and rollback compensation on a normal manifest/capability write failure. This does not claim power-loss atomicity.

### RL: PASS for design direction; NOT ready for human CAD gate

- Source owner isolation and bound CAD pathways remain mandatory.
- No new Job TEST stage, draft/promote requirement, second planner, whole-Job lock or simulated CAD PASS was introduced.
- One existing capability path, `job_capability_prepare`, already borrows a registered Lisp capability into the *calling* execution without starting its parent Job, then uses `cad__cad_run_lisp_command` with per-execution/drawing ownership. Preserve rather than duplicating it.
- **Open implementation:** migrate old Job/FILE helper and Direct/Reasoning routing, remove obsolete runtime/user-facing lifecycle gates after compatibility preserved, validate actual Save positioning, guard simultaneous same-Job runtime roots, complete regression and Windows native AutoCAD verification.
- **Engineering verification blocked:** GitHub reports no CI status attached to current feature commits; no Windows build runner or local AutoCAD available to this chat. Do not infer PASS from source commits.

**Stop condition remains unchanged:** do not ask human to pull until software is actually ready for native CAD acceptance. A source-only checkpoint is not a human acceptance gate.

## O. Continuous implementation checkpoint — 2026-10-17 (GitHub Actions verified)

**Branch discipline:** ALL CadGPT source changes in this checkpoint were committed to `feature/core-function-v5`; no child branch and no main edits. **GitHub Actions V5 Source CI** now runs on Windows and Linux; current source passed both runners at `https://github.com/thebimhouseinfo-sudo/Cadgpt/actions/runs/39042944682` (commit `2f28e290ecf92458134906de2bfec1f8baed9ffc`).

**Major corrections made during automatic review cycle:**
- Fixed real TypeScript parse error `export export async`, verified by CI compilation.
- Updated 3 stale compatibility/UI tests using the already-approved maintenance expectations from main **by selectively copying only those test contracts**, not merging branches. Corrected a fourth outdated autosave expectation for the V5 failure contract.
- On Windows, resolved test assertions that incorrectly compared DOS 8.3 temporary path aliases against canonical long paths, without weakening canonical path protection. 244 tests then passed on both Windows and Linux (before subsequent source publication work).
- Source-specific ownership resolver rejects cross-Job junction aliases and protected internal TBH Toolkit library; Temp result creation protects user-named persisted data.
- Python helper accepts an active prepared, owned Job runtime without requiring manual SYSTEM acquire/release (legacy route remains available).
- `job_runtime_finish` now returns tool failure and preserves Job runtime when exact bound-DWG Save fails; no false `JOB_DONE_AUTOSAVE_FAILED` represented as success.
- `v5_source_publish` indexes source already authored in the final Job/Lisp library folder, **only on explicit reusable registration request**. `v5_source_create/update` refresh previously-published managed library registry on edits, without publishing as-yet-unregistered source. CI Windows+Linux PASS at `https://github.com/thebimhouseinfo-sudo/Cadgpt/actions/runs/39042944682`.

**WP state (strict, no inflated completion):**
- WP0 dependency map: DONE.
- WP1 owner-scoped Builder + Temp source tools: IMPLEMENTED BASIC PATH; complete audit of legacy FILE and authoring paths remains.
- WP2 reusable in-place Job authoring + opt-in publication: IMPLEMENTED BASIC PATH; legacy Direct/Reasoning adaptations remain.
- WP3 Temp Lisp LOAD + selective publication: IMPLEMENTED BASIC PATH; native CAD LOAD and dependency closure beyond selected folder remain to verify.
- WP4 Temp allocator, user-named persistent result writes, explicit cleanup and id-specific cleanup: IMPLEMENTED BASIC PATH; concurrency/crash rollback and native run verification remain.
- WP5 capability borrowing: reused existing `job_capability_prepare`; execution-owned Python helper path added. Removal of remaining obsolete SYSTEM Job-level ceremonies and same-Job locking design remains.
- WP6 Save: fixed fail-open behavior. **Position of Save exactly after final CAD mutation vs finish cleanup still needs integration review.**
- WP7 old draft/checkouts/promote: marked legacy and default CG Builder guidance points to direct authoring, but physical legacy routes/tests still exist.
- WP8 source CI: PASS Windows/Linux. **Native installed Windows tray + real bound AutoCAD end-to-end: NOT RUN.**

**RL conclusion:** Source CI PASS does not permit asserting V5 implementation complete, native AutoCAD tested, or Ready for Main. Remaining WP5–WP7 are material. Do not ask human to pull until those are genuinely resolved. Preserve V5 theory, do not add back Job TEST or approval/promotion gates.

## P. Implementation + RL checkpoint — verified cross-platform V5 default flow

**Only branch:** `feature/core-function-v5`. Latest audited source CI at `https://github.com/thebimhouseinfo-sudo/Cadgpt/actions/runs/39043577635` **PASS Ubuntu and Windows** (after `job_runtime_save_now`, Save ledger and demoted legacy SYSTEM APIs).

### Newly implemented
- Added `runtime/bound-save-ledger.ts`: exact Work execution + DWG-runtime-identity witness of confirmed Save, invalidated by subsequent CAD proxy calls, loaded/autorunning Lisp and destructive execution; cleared on Work cleanup.
- Added `job_runtime_save_now`: Operator can invoke right after last DWG mutation. Saves exact bound runtime document and verifies returned `saved: true` AND matching `runtime_document_id`, then records witness. Actual error fails tool.
- `job_runtime_finish` reuses that verified witness and doesn't Save again if there has been no subsequent CAD operation; if no witness exists it falls back to a verified bound Save. Save failure returns an ERROR and preserves runtime, no false DONE.
- `job_runtime_prepare` now tells Operator to Save immediately after last DWG change and STOP/REPORT if save fails; no additional TEST/promotion gate.
- `job_system_acquire/release` are explicitly described as legacy-only, not default V5 Builder/Operator workflow.
- Regression `tests/v5-bound-save-ledger.test.mjs` and `tests/v5-bound-save-contract.test.mjs` check execution/DWG isolation and early Save integration.
- Direct managed Job/Lisp in-place publication and indexed registry refresh have passed Windows/Linux CI at `https://github.com/thebimhouseinfo-sudo/Cadgpt/actions/runs/39042944682`.

### Review and remaining human-gate criteria
- PASS (source): TypeScript build and repository tests on real Windows and Linux cloud runners.
- NOT YET PROVED: Live AutoCAD bound DWG, commands/autorun, real Job sequence and Save on host. Those are native human acceptance only when code implementation is ready.
- **Still not fully retired**: legacy Direct-vs-Reasoning presentation, explicit SYSTEM acquire/release and draft/checkout/promote API compatibility surfaces. They remain non-mandatory but present; do not remove until migrated consumers validated.
- **Concurrency limitation to review**: `JOB_RUNTIME_BUSY` still protects **the same Job runtime root** from two concurrent writers. It does not lock unrelated Jobs. To eliminate it safely requires per-execution scratch layout without breaking legacy raw paths; do not remove blindly.
- **CI is a development check, not a user Job TEST stage**, and no claim of overall V5 approval or main replacement is made.

## P. Implementation continuation — 2026-10-18, code + source CI

**Same V5 branch exclusively.** The following was implemented in source, not approved by a live AutoCAD test:

- `job_runtime_finish` now accepts `dwg_changed=false` for genuinely read-only/file-only Jobs; it returns `JOB_DONE_READ_ONLY` without an unnecessary DWG Save. Mutating Jobs retain fail-closed verified Save and cannot use that shortcut legitimately.
- `job_runtime_prepare` now accepts `source_path` pointing to an **actual final managed JOB.md**, in addition to registered `id` and legacy draft path. Builder work authorization and canonical source containment are checked; the Job can RUN before any Registry publication. This removes an actual draft/promote prerequisite for new reusable Job authoring.
- Regression source tests added for direct unregistered JOB.md path and read-only Save finish semantics.

**Verification:** GitHub Actions V5 Source CI `https://github.com/thebimhouseinfo-sudo/Cadgpt/actions/runs/39055663368` completed SUCCESS on both Windows and Linux (commit `9fff2e046a7dd71a18a57175d283cd5333c3b280`). This proves TypeScript build and automated source test suite, NOT native CAD RUN correctness.

**RL residuals:** `source_path` currently accepts managed library path in explicit Builder execution, but complete target-level authorization of Builder edits and legacy FILE tool migration remain. Registered Direct Python Jobs still use their existing historical runner, and old draft/SYSTEM aliases still exist as compatibility. Same-Job runtime ownership, true save timing of legacy Direct scripts, Temp publication dependency closure, and AutoCAD acceptance remain to be completed. No user pull/human acceptance gate until source migration is complete.

## Q. Implementation checkpoint — 2026-10-18

**Same branch only:** `feature/core-function-v5`, no child branch or main modifications.

- Reviewed legacy generic FILE tools: they remain purposely read-only for permanent managed libraries; updated their descriptions to direct users to exact-owner `v5_source_create/update` rather than obsolete draft promotion.
- Added `runtime/builder-target.ts` to bind each Builder execution to the first **exact final source package** it writes. Subsequent attempts to write a neighboring Job/Lisp folder in that same execution fail with `V5_BUILDER_TARGET_OWNERSHIP_MISMATCH`; cleanup clears this binding. This is no global Job lock, approval gate, checkout, or extra RUN TEST stage.
- `tests/v5-builder-target.test.mjs` proves same-source repeat, cross-source rejection and cleanup.
- V5 source CI **PASS Windows + Linux** at `https://github.com/thebimhouseinfo-sudo/Cadgpt/actions/runs/39079075233` (commit `6f30c992b6a94ece14502e55b280e91e248965e5`). Confirms build/tests only, not AutoCAD host behavior.

**Outstanding:** legacy Job runtime's exclusive `executionByJobRoot` still prevents simultaneous use of the same Job; source result isolation architecture and compatibility of full Job runtime/Direct Python flows must be addressed without cross-execution writes. Temp Lisp external dependency closure and native AutoCAD human gate are unverified. Do not claim V5 complete or request user installation.

## R. 2026-10-18 continued WP5/WP6 implementation

- Added exact-source targeting `runtime/builder-target.ts` with same-Work immutability of source package and Work cleanup (no artificial Job-level lock); V5 source CI Windows + Linux PASS `https://github.com/thebimhouseinfo-sudo/Cadgpt/actions/runs/39079075233`.
- **V5-only same-Job parallel Builder RUN**: `prepareJobRuntimeForExecution` now stores scratch/Job Steps at `<Job>/runtime/runs/<hash-of-execution>` for Job IDs starting `v5:`, preventing cross-execution overwritten scratch and removing the legacy `JOB_RUNTIME_BUSY` gate for this route. Legacy registered Job/direct Python contracts remain unchanged pending separate adapter migration. Regression `tests/v5-parallel-runtime.test.mjs`.
- **Opaque legacy Direct Python Save safety:** Python Direct Jobs can write AutoCAD through COM outside the wrapped CAD tools. Invalidate any prior verified Save witness before a non-file-only Direct Python invocation to prevent false DONE after a subsequent CAD mutation.
- **Verification:** GitHub Actions `https://github.com/thebimhouseinfo-sudo/Cadgpt/actions/runs/39079332297` Windows + Ubuntu build/tests **PASS** on commit `039f7ae3a2843dfe5694b24ee01e5bbe310029a1`.

**Review caution:** `v5:` Builder Job runs now have isolated scratch but still share the named Job result folder (file mutation locks and overwrite protection apply at mutation sites); business logic that hardcodes shared result filenames must handle collisions, not silently overwrite. Existing registered legacy Job runtime retains its lock and scratch layout for compatibility. V5 is still NOT fully completed, not installed on local Windows and not eligible for native AutoCAD human acceptance until legacy runtime migration and integration checks are done.
