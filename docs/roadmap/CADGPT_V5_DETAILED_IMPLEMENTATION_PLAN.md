# CadGPT Core Function V5 — Authoritative Implementation Plan

## GOAL
Deliver the human-approved CadGPT V5: ChatGPT is the only reasoning engine; CadGPT is an AutoCAD/file/capability bridge. Builder authors Job/Lisp directly in their final owned folders. Operator follows actual Job steps. Registry is a small capability directory. Jobs may borrow tools without borrowing other Jobs' write permissions. All CAD work uses the bound Drawing Anchor. Implement only the listed open work; retain already working code unless it conflicts with these requirements.

**Branch:** `feature/core-function-v5` ONLY. **Do not modify `main` or production AppData.** No release or native CAD PASS claim without observed evidence. The approved theory is `CADGPT_CORE_FUNCTION_V5_BRANCH_PLAN.md`; in any ambiguous detail use the explicit human decisions written below, not obsolete code/checkpoints.

**Sole executable roadmap:** this file, WP0–WP8. Prior implementation history and old reviewed appendices are retained as **non-normative evidence** in [CADGPT_V5_IMPLEMENTATION_HISTORY_ARCHIVE.md](./CADGPT_V5_IMPLEMENTATION_HISTORY_ARCHIVE.md). They do not authorize tasks, gates or features. No parallel J-B04B task roadmap; that GSA Job is an evidence record for migration.

## Non-negotiable behavior
1. **Drawing identity = Drawing Anchor alone.** Matching Anchor means the same drawing, even after rename, move, copy or Save As. Filename, `FullName`, path and historical aliases are *not identity checks*. A path may be used only to access the file when necessary; do not build path/alias synchronization or matching logic. Binding remains explicit and must not jump to another Anchor.
2. **One human, multiple different Jobs, one active execution per Job ID.** A running CLG Peno cannot be started again until DONE or STOP; Grille Tag and other different Jobs can run independently. No same-Job parallel runtime architecture, execution-hash scratch collection, race-framework or unnecessary per-file CAS introduced as a product requirement. Keep minimal safety checks actually needed to prevent unintended writes.
3. **Job Stop is not Work Stop or CAD MCP Disconnect.** `cg/jobstop` stops only the selected Job *between completed tool calls*, releases its runtime/borrowed capability ownership and lets it start again. It does not interrupt running Lisp/Python, close the session, disconnect CAD MCP, unbind the drawing, or stop other Jobs. Existing `cg/stop` work-level behavior is separate.
4. **Builder writes final source directly.** New Job: final Job folder, `JOB.md`, `lisp/`, `tools/`. New standalone Lisp: final Lisp Library. No Job/Lisp draft, checkout, copy-to-final or mandatory preflight/test stage. Updating an existing Job source requires exact user command `cg/jobupdate`; ordinary natural-language edit instructions cannot grant this authority. Bound server-side edit scope to the specified Job; Operator never inherits it.
5. **Retain existing explicit Promote operation.** Do not delete/rename it, add watcher/diff heuristics, infer when it is required, or create new promotion policies. Promote publishes/updates Registry from final source; does not copy already final source or impose a historical revision gate. Ordinary source edit/save is usable on the next run even if not re-promoted.
6. **Registry is discovery only:** ID, kind, description, owned location, invocation/commands and required minimal mapping. Strip historical bundle/source SHA, test evidence, promotion histories, accidental Python `__pycache__` and scratch inventories from Registry *authority*. Actual existing Job/Lisp/Python bytes are source truth. Do not require revalidation, compat update or SHA equality to a prior registry record to run. Keep real source ownership/path and command collision checks.
7. **Job context remains with Job.** CAD ↔ SYSTEM ↔ CAD repeats without consuming the Job or losing foreground context. A SYSTEM lease, where legacy support still exists, is temporary borrowed access: release does not finish/cleanup Job. Finish/Stop alone clears Job state. Remove manual lease ceremony from default V5 workflow; preserve functioning compatibility paths without inventing a new coordinator.
8. **Job scratch is disposable, results persist.** Each Job has one working runtime set, overwritten on rerun or cleaned after success. Preserve failure diagnostics until safely superseded. Never clean another Job's files. Results under `drawings/<anchor>/jobs/<job>-result` follow the Job's timestamp/version contract and survive cleanup. Runtime scratch and `__pycache__` are not published as source.
9. **CAD safety:** CAD-facing commands for the same AutoCAD host are serialized at the tool-call boundary; each Job uses the bound Anchor. Do not replay uncertain non-idempotent CAD writes. Mutating jobs save the actual bound drawing after the final modification; read-only jobs do not require Save. Save failure means not DONE. Do not add geometry rescans or separate Job TEST workflow.
10. **Temp Jobs:** use unique AppData `temp-jobs/<id>/`; no obligatory Job.md/registration. `cg/cleartempjob` removes inactive Temp Jobs and never deletes their persistent Drawing Anchor results. Publication of reusable Temp Lisp can copy it into an independent standalone final Lisp Library, as distinct from rewriting an already-final Job.
11. **No silent extensions.** Do not add password, multiuser RBAC, expiry watchers, autonomous retries, automatic promotion, parallel same-Job execution, per-Job background agents or new approval gates. Technical integrity mechanisms already required to avoid actual corruption may remain, but must not become independent workflow gates.

## Current implementation work packages

### WP0 — Exact-source audit and anti-drift
### GOAL
Identify only the remaining behavior gaps without repeating completed work.
- Read current V5 branch code and actual consumer paths before editing. Map: Registry entries → discovery/consumer, Builder authorization and command dispatcher, Job runtime + SYSTEM acquire/release, Stop vs Work stop, scratch cleanup, drawing identity and tests.
- Classify current mechanisms KEEP / FIX / REMOVE. Do not mechanically remove proven safety checks or repeat already-implemented V5 features.
**Acceptance:** bounded source-to-feature map and no undocumented extra subsystem.

### WP1 — Builder authorization and owned source writes
### GOAL
Existing Job updates can be saved directly and only after explicit user activation.
- Bind `cg/jobupdate` to actual server-validated user command; authorize exact existing Job + current session/work; revoke after update/stop. Reject forged Work owner IDs, natural-language messages, cross-Job and Operator writes.
- New Job/Lisp creation writes directly in final owned folder using existing narrow path controls. No draft/checkout/copy workflow.
**Acceptance:** allowed exact-job edit, denied unrequested/cross-Job edit, no whole library write permission, valid existing source still usable.

### WP2 — Reusable Job and Operator execution
### GOAL
Current on-disk Job source runs without unnecessary re-publication or compatibility gates.
- `JOB.md` is the workflow; existing Direct Python compatibility remains if needed. Operator executes actual declared steps and does not edit source.
- Preserve Job ID and source paths; do not demand Contract Update, checkout, re-registration, version fingerprint or simulated test after ordinary edits.
**Acceptance:** existing CLG Peno/Grille Tag/MTO/Create System discovery unaffected; revised Job source read on next legitimate run.

### WP3 — Lisp/Registry/Promote
### GOAL
Keep manual Promote, but make Registry lightweight and non-blocking.
- Retain current Promote entrypoint and intended explicit action. It reads final Job/Lisp source and updates discovery entries; it must not re-copy existing final source, run compulsory validation or lock by hash.
- Remove unnecessary stored Registry history metadata after mapping all consumers. Prevent runtime or Python cache indexing. Keep canonical owned paths and command collision protection.
- Lisp LOAD/autorun from owned final or Temp Lisp folder keeps actual binding and command behavior.
**Acceptance:** source-only edit runs without SHA/promote gate; manual Promote still works; new/removed published capabilities discoverable only according to existing explicit Promote contract.

### WP4 — Temp Job lifecycle
### GOAL
Reusable Temp workflow works without a second Job registration system.
- Keep Temp root allocation, owned Lisp/tools/runtime and optional *user-named* persistent Drawing Anchor result. Keep cleanup explicit, avoid unsupported timeouts and auto-cleanup scheduling.
- Preserve independently published Temp Lisp assets when Temp folder is removed.
**Acceptance:** create/use/cleanup and result survival, without writes outside ownership.

### WP5 — Job lifecycle, borrowed capabilities and Stop
### GOAL
Different Jobs can run independently and a single Job can cleanly STOP, DONE or restart without disrupting CAD MCP.
- Keep a minimal active-Job state per Job ID. A second start of same active Job is refused; after DONE/STOP it is allowed.
- Repair `job_system_acquire/release` compatibility so released temporary SYSTEM access restores/retains parent execution context. No `JOB_RUNTIME_NOT_PREPARED` or `JOB_RUNTIME_NOT_ACTIVE` on valid CAD→SYSTEM→CAD cycle.
- Implement `cg/jobstop` as Job-only cleanup after tool call completion, without cancelling AutoCAD actions or ending Work/CAD MCP/session/binding. `cg/stop` remains distinct.
- Serialize only actual CAD-facing operations, not all Jobs or file reasoning.
**Acceptance:** Job A→B; CAD→SYSTEM→CAD→SYSTEM; Job STOP→restart; other Job and CAD MCP still accessible immediately afterward.

### WP6 — Scratch, Save and Drawing Anchor
### GOAL
Disposable runtime and durable results behave correctly; drawing is identified only by Anchor.
- Replace accumulation of ordinary per-run scratch files with one active scratch set per Job (or compatibility adapter that presents the same behavior). Clean success; keep failure evidence until safe replacement; never affect another Job or persistent results.
- Existing Drawing Anchor survives copy/move/rename/Save As; treat same Anchor as same drawing. Do **not** match FullName, old/new filename or aliases to establish identity. File paths only for actual file I/O.
- Save the real bound drawing after final DWG mutation; report failure without claiming DONE. No extra verification framework solely for Save As naming.
**Acceptance:** same Anchor recognized under different names/paths; Job result history intact; no runtime scratch growth on repeat runs; Save works against correct bound Anchor.

### WP7 — Remove obsolete workflows, not useful capability
### GOAL
Code and tool guidance expose one simple current workflow.
- Remove obsolete draft/checkout/copy and mandatory compat/promote/re-test gates from normal routes/help/tests; keep old compatibility adapters only where necessary for existing Jobs.
- **Do not delete explicit Promote.** Do not add change watchers, revision classification or extra Builder decision gates.
- Remove leftover same-Job parallel requirements from documentation and tests; do not chase non-existent multiuser concurrency issues.
**Acceptance:** one simple Builder/Operator path, existing calls remain functional, no broad authorization leak.

### WP8 — Source regression, controlled native acceptance and release fence
### GOAL
Verify implementation against actual human criteria, not against obsolete checkpoint tests.
- Source tests: explicit `cg/jobupdate`, final-folder creation/edit, current source run, manual Promote, minimal Registry, Job owner isolation; same Job cannot execute twice concurrently, distinct Jobs can; stop keeps CAD MCP; SYSTEM context remains; scratch/result lifecycle; Anchor identity independent of name/path; bound Save.
- Windows + Ubuntu source CI; separately verify real AutoCAD on **copied test DWG**, without rerunning duplicate CLG Peno autorun on an existing peno drawing. Report actual PASS/FAIL evidence.
- No merge/deploy to `main` or production without human release approval.
**Acceptance:** source review and tests pass, native evidence truthfully reported, no product-goal drift.

## Current source implementation status (2026-10-19)

This is status only, **not a separate roadmap**. The WP0–WP8 definitions above remain the only coding instructions.

| WP | Verified source progress | Remaining behavior |
|---|---|---|
| WP5 — SYSTEM continuity | Fixed SYSTEM release to retain foreground Job runtime; repeat acquire/release regression PASS | Real CAD ↔ SYSTEM native acceptance |
| WP5 — Job Stop | Added `cg/jobstop` that cleans current Job without `cg/stop`, Work teardown or CAD MCP disconnect; control regression PASS | Live session + CAD MCP acceptance |
| WP5/WP6 — single Job execution | Same Job second execution rejected; different Jobs permitted; no new execution-hash runtime directories | Real multi-chat acceptance; old scratch directories migration only if genuinely needed |
| WP6 — scratch | `job_runtime_finish(outcome=done)` clears Job scratch; failed completion preserves diagnostics and Drawing Anchor results | Native Save/result behavior |
| WP3 — Promote | V5 Builder source create/update no longer automatically refresh Registry. Existing explicit `v5_source_publish` retained | Slim legacy Registry metadata and source SHA execution gate still to audit/fix |
| WP1 — `cg/jobupdate` | **NOT IMPLEMENTED**: existing source Builder role still accepts owner IDs without an exact command grant | Explicit user-triggered, target-scoped authorization and tests |
| WP2/WP4/WP7/WP8 | Earlier baseline implementation exists | Audit remaining legacy routes and anchored identity, native acceptance; no main deploy |

**Latest CI:** source build/test PASS Windows + Ubuntu for `68ac9066`, [run 39274088614](https://github.com/thebimhouseinfo-sudo/Cadgpt/actions/runs/39274088614). This is **source regression PASS only**, not native AutoCAD PASS. Do not claim V5 fully complete.

## Scope & review rules
- Every planned source change must name one WP goal and user-visible behavior it fixes; no autonomous new feature.
- Gate review: REMOVE historical Registry SHA / draft / checkout / repeated promote requirement / same-Job concurrency machinery; KEEP exact owner containment, real bound Anchor, safe CAD command ordering, explicit Job update authorization and Save failures.
- A previously shipped mechanism may remain as internal implementation detail if removing it is higher risk, **but it must not add a product requirement or execution gate**.
- Re-review affected WP on substantive changes. Do not repeat the whole historic Job RL for every code edit.
- This document is the only implementation instruction. Historical snapshots are not tasks, approval, or source of new architecture.

## Source history
Prior WP checkpoints, older RL findings, exact source/CI links and drafts are preserved in the non-normative archive linked above. Historical claims apply only to their original commits.
