# CadGPT — Core Function V5: Architecture and Branch Plan

**Status:** DESIGN BASELINE · development-only branch `feature/core-function-v5` · 2026-10-16.
**Reference:** RevitGPT `docs/roadmap/P3_CORE_FUNCTION_THEORY_V5.md`.
**Authority:** Human decisions in this conversation. No automatic change to `main`.

## Branch contract

- This branch is the **sole source for V5 development, builds, simulations and live AutoCAD verification** until human acceptance. No routine merges/rebases from `main`; selective backports/cherry-picks only if explicitly approved.
- `main` is **maintenance-only** until V5 is finished: temporary Job directory restoration and narrowly scoped operational bug fixes. No V5 feature backport during development.
- Release is an explicit human-controlled replacement of `main` after acceptance, with a recoverable pre-replacement tag/backup and comparison of changes. **Never force-push `main` automatically.** GitHub branch protection must be configured separately; this document is not a technical branch lock.
- Keep existing registered Jobs/Lisp usable throughout development. Preserve compatibility or provide an explicit audited transition, not hidden migration gates.

## Product model

- ChatGPT is the sole reasoning/planning engine. CadGPT is execution bridge and capability/ownership authority; do not build another planner.
- **Operator** executes approved registered `JOB.md` and `JOB_STEPS` in order. PASS → NEXT, ERROR → STOP and report. Do not add/reorder/repair steps without user direction.
- **Builder** authors/fixes Job/Lisp, executes Temp Jobs, and diagnoses errors upon request; same Core tools, not another autonomous agent.
- Prefer **one reusable Job workflow definition**, `JOB.md`, with Job-owned optional `lisp/`, `tools/`, `runtime/`, source/data as needed. Existing Direct .py compatibility remains during conversion; do not delete functioning entrypoints prematurely.
- Reusable Job/Lisp source is created and edited **in-place** in the owned managed library; no job-draft or lisp-draft checkout/promote intermediate. Registry is discovery/publication, not a prerequisite to live execution. New reusable capabilities are registered when human requests after demonstrated successful real run; editing an existing registered file does not unregister/block it.
- **No separate TEST stage**: BUILD → RUN on real, bound DWG → on error FIX and RE-RUN only the failed step if safe → NEXT or DONE. Never repeat uncertain/non-idempotent writes blindly; no synthetic simulator, static preflight or promotion gate blocking real CAD work. Optional syntax checks are debugging conveniences.
- Runtime Job Steps reflect real steps, not bureaucracy. CadGPT save follows the **last DWG-mutating step** of a phase before later file/system work, with a real Save outcome; read-only phases do not save.

## File ownership and cross-Job use

- An active Job can read/write **its own** Job package including runtime and **its own result directory** under the verified bound Drawing Anchor. All writes use canonical paths and maintain DWG identity.
- It can read another Job's package and result; may borrow a registered capability ID. Borrowing never grants authority to edit the other Job's files or result. An independently invoked owning capability executes under its own explicit ownership, not the caller's arbitrary writable roots.
- No Job may directly modify the source, runtime, or result of another Job. No writes to arbitrary user, workspace or Drawing Anchor parent folders.
- Keep real file conflict protection, bound Drawing Authority and host operation ordering. Do not create artificial approval/compatibility locks, exclusive whole-Job leases or mandatory migrations.
- Distinct runs/results must not silently overwrite each other.

## Temp Jobs

- Root: `%LOCALAPPDATA%/CadGPT/temp-jobs/<random-id>/`, one random collision-resistant directory per Temp Job, with optional `lisp/`, `tools/`, `runtime/` and data. **No required `JOB.md`, no Temp Job registry, no Job promotion**.
- Temp workflow is explicit but conversational. BUILD → RUN → FIX/RE-RUN on error → NEXT/DONE. Real AutoCAD operation is the run, not a distinct test stage.
- **Optional Drawing Anchor result:** Ask the user for a meaningful result folder name *only if persistent result output is needed*. Never default the result folder name to the random Temp Job ID. Resolve under this bound drawing's authorized result root; ensure distinct ownership and collision-safe handling. No question if no persistent output is needed.
- `cg/cleartempjob` cleans inactive/completed Temp Jobs; `cg/cleartempjob <id>` cleans a selected inactive Temp Job. Report skipped active executions, never delete Drawing Anchor result or registered Lisp. Do not add per-file confirmation gates.
- On explicit user request, copy reusable Lisp plus dependencies from a Temp Job into the appropriate independent Lisp Library and register the capability. Check real conflicts and integrity, no mandatory extra test/promote ritual when source and working environment match the successful run.

## Implementation workstreams — V5 branch only

1. Map current tool calls, path policy, registry, old draft/checkout/promote routes, helper runner, host binding, Job lifecycle and tests. Record contracts and real dependency edges. Keep known-working local Job assets, including CLG Peno.
2. Authorize in-place Builder source writes, with ownership derived by canonical Job/Library owner, not by untrusted path strings. Enable new Jobs and Lisp to run before registration.
3. Simplify Operator/Builder access and Job execution; remove unnecessary manual SYSTEM hand-offs while preserving precise source/result ownership and safe host sequencing. Preserve old public tool names with adapters during transition.
4. Add Temp Job allocation, scoped file/CAD execution, optional **user-named** result location, cleanup command, and selective Lisp registration.
5. Remove obsolete draft staging and redundant compatibility/promotion barriers only after references and tests confirm no regressions.
6. Test with actual local tool operations and real AutoCAD as needed; compare behavior, including saved drawing identity, multi-Job capability borrowing and unregistered Lisp. Document actual results, not assumed PASS.

## Invariants and regression checks

- A Job may write its own root/result; may read/borrow but **not write** another Job's root/result.
- The same bound DWG is used for CAD operations; no implicit ActiveDocument fallback.
- Source edit/run needs no redundant draft or artificial registration gate.
- No run/test distinction; real outcomes decide advancement. Ambiguous CAD writes are not replayed.
- A successful Job does not require a redundant post-write scan; save occurs as specified.
- Temp cleanup cannot delete active Temp Jobs, promoted Lisp, user-named result, or another Job's files.
- Branch builds/releases run from `feature/core-function-v5` only; `main` stays maintenance-only until acceptance.

## Main maintenance track (separate from V5)

- Restore a minimal Temp Job working directory mechanism without importing the V5 refactor.
- Address a small number of independently verified operational defects. Example: CLG Peno `metadata_route.py` is AppData Custom Job code, not a tracked CadGPT Core source; schema mismatch against `grilles.json` (`source`, `total_grilles`, `owner_id`) and manifest-style `index.json` requires targeted isolated repair, not a Core rewrite. Preserve its live CAD testing status.
- Explicitly review each maintenance commit; never merge main maintenance commits wholesale into V5.

## Release procedure (future, not authorization now)

- Human acceptance based on working V5 branch and live CAD evidence.
- Freeze V5 and compare against `main`; separately assess maintenance fixes on `main`.
- Preserve current `main` with tag/backup; integrate any necessary selected maintenance patches.
- Replace `main` using a reviewed repository-safe method, with rollback retained. No silent force push.
