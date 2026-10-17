# CadGPT V5 — Canonical Job Rules

**Status:** V5 runtime guidance. **Authority:** `docs/roadmap/CADGPT_CORE_FUNCTION_V5_BRANCH_PLAN.md`, `docs/roadmap/CADGPT_V5_DETAILED_IMPLEMENTATION_PLAN.md`, and human-approved V5 theory. This document replaces the legacy mandatory draft/validate/test/promote lifecycle **on V5 only**. Tool aliases retained for existing Jobs do not reinstate the old lifecycle.

## Core model and roles

ChatGPT is the reasoning/controller. CadGPT is a narrow bridge for file operations, registry/discovery, verified bound AutoCAD commands and owned runtime. A **Job** is an ordered workflow, not a separate autonomous agent.

- **Operator:** load a registered Job's current `JOB.md`, follow its exact business steps and declared user choices. Real step PASS → NEXT. Failure → STOP and REPORT actual tool error. Do **not** autonomously rewrite a registered workflow, silently retry uncertain DWG writes or create missing steps.
- **Builder:** on explicit user request create/update the *owned final* Job/Lisp source, then run the actual authorized Job/CAD operation. An error permits inspecting, repairing the source and re-running only when safe. Build → real RUN → FIX if needed → safe RE-RUN → NEXT/DONE. No separate mock TEST stage, checkout, draft or promotion gate.
- **Legacy aliases** (`job_draft_new`, `job_checkout`, `job_draft_validate`, `job_promote_draft`, manual SYSTEM lease) exist only for older package compatibility. Never direct normal V5 work through them.

## Job types and source ownership

A reusable Job is a managed package containing a canonical `JOB.md` with explicitly declared ordered steps, and optional `lisp/`, `tools/`, `runtime/`, data. Existing registered `.py` Jobs remain runnable as legacy adapters, **not** a second mandatory public authoring taxonomy. Official Internal Jobs remain read-only and cannot be overridden by a User Registry identifier.

Builder source mutations use `v5_source_create`/`v5_source_update` with an exact managed library/package target and compare-and-set hash where updating. Only that source owner may WRITE there. An independent Job may READ or borrow a published capability of another Job, **never** write the lender's source, runtime or results. Generic `file_*` does not grant blanket library writes. A single Builder execution stays scoped to its selected source package; a separate requested source package requires a distinct Work.

A reusable capability is indexed only when explicitly requested: `v5_source_publish` for an already-authored managed Job/Lisp package, or `temp_job_lisp_publish` for selected independent reusable Lisp. Publication is **not** a prerequisite for authoring or running a Job directly through `job_runtime_prepare(source_path=<absolute-final-managed-JOB.md>)`. For registered Operator invocations use `job_runtime_prepare(id=<registered-id>)`. Existing library registration refreshes after in-place source edits without a new promotion step.

## Temp Job

- Allocate `%LOCALAPPDATA%/CadGPT/temp-jobs/<UUID>/` using `temp_job_create`. UUID belongs to temporary scratch **only**.
- A Temp Job needs no `JOB.md`, Job Registry entry, draft or whole-Job promotion.
- Builder uses `temp_job_source_create`, `temp_job_source_update`, optional `temp_job_lisp_load`, then the normal bound CAD execution tools. Loaded Lisp success requires `loaded=true`; run command success is separate.
- Only if user wants **persisted results**, request a meaningful *user-chosen* folder name and use `temp_job_result_create` followed by `temp_job_result_write`. Locate under that exact verified Drawing Anchor, never use the Temp UUID as result name. Reject collisions instead of inventing a rename.
- `temp_job_done` marks an inactive completed Temp Job. `cg/cleartempjob` or `temp_job_clear` deletes only recognized completed inactive Temp source folders. Keep named persistent results and independently published Lisp.

## Drawing authority and result integrity

- Every live AutoCAD operation is attached to exactly the verified execution-bound drawing and its document identity. Never silently switch to ActiveDocument, infer a drawing from filename or substitute an unrelated tab.
- Drawing Anchor is the canonical result-owner identity. Stored results are created only inside the authorized bound drawing folder and Job-owned result namespace. Existing business result names and file conventions remain binding.
- Multiple chats/Jobs may process independent files. CAD-facing calls use the existing per-host ordering, not an artificial whole-Job queue. If two runs edit the same file, use exact canonical file locking/revision checks; never overwrite a neighboring Job's output.
- Cross-Job borrowing is a capability invocation in the caller's execution; it does not transfer source or result WRITE ownership. Use `job_capability_prepare` for an available verified reusable Lisp helper and `cad__cad_run_lisp_command` on the bound drawing.
- `job_system_run_helper` executes only hash-pinned Job-owned Python assets from `tools/**` using an execution-prepared runtime, input JSON and controlled Python process. Manual acquire/release of a detached SYSTEM lease is legacy only.

## Ordered execution and real evidence

Read current `JOB.md` fresh on each registered invocation. Honor its preconditions, branches, drawing metadata, raw/result ownership and exact output format. Maintain progress in the **returned** `job_steps.path` if needed; never assume a fixed global Job Steps pathname. These progress marks are observations, not permission to replay CAD mutations or independent verification gates.

A tool dispatch alone is not proof of AutoCAD mutation. Verify actual tool success according to its supported contract; AutoLISP LOAD requires `loaded=true` and command success requires the command outcome. On uncertainty of a non-idempotent mutation, STOP/REPORT rather than automatic replay.

### DWG Save rule

Immediately after the **last DWG mutation of each completed CAD phase**, and before subsequent independent FILE/SYSTEM post-processing, call `job_runtime_save_now` when an active Job runtime is prepared. It saves the exact verified bound document and records evidence. Later CAD-facing operations conservatively invalidate the Save evidence; save again after the later phase if needed.

`job_runtime_finish(outcome="done", dwg_changed=true)` must either reuse a valid matching Save witness or perform/verify bound Save before returning DONE. Save failure returns a real error and preserves the runtime for repair; no false successful Job DONE. For a genuinely read-only/FILE-only Job use `dwg_changed=false`; do not invent a DWG Save. The existing public bound Save capability can serve Temp/non-Job CAD execution when appropriate. Never guess or save an unrelated drawing.

## Safety, cleanup and completion

- Do not create mock/synthetic AutoCAD tests, extra user confirmations, approval stages, manual update/promote gates, compatibility hard blockers, secondary planners or whole-Job leases.
- Static source checks and CI may help a developer identify errors; they are not Job execution stages and do not prove native AutoCAD success.
- Keep actual user-provided Job business logic. Repair platform defects without rewriting accepted business steps. User-requested changes to Job behavior are authored in the original managed package, not as parallel competing JOB.md copies.
- STOP/REPORT failures truthfully, leave necessary raw/result data intact, and do not automatically repeat an operation when mutation success is uncertain.
- Report DONE only when the declared work and required bound Save genuinely succeeded. Publication of reusable assets is a separate user-requested operation.
