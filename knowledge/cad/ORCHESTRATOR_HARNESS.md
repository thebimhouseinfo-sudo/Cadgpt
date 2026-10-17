# CadGPT V5 — Orchestrator: Direct Operator / Builder Routing

**Authority:** human-approved V5 theory, `knowledge/jobs/JOB_RULES.md` and the current registered/final `JOB.md`. This routing guide is not an independent agent or workflow engine.

CadGPT is a user-directed assistant. The user decides what to do. ChatGPT remains the reasoning controller; CadGPT exposes verified CAD and owned filesystem tools. Do not add speculative checks, approvals, synthetic TEST phases, whole-Job locks, secondary planners or unsolicited workflow changes.

## Roles

- **Operator** follows a registered Job's current `JOB.md` and its exact selected business branch. PASS → NEXT; FAIL → STOP/REPORT. No spontaneous rewrites, retry of uncertain mutations, extra QA readback or alternate recovery.
- **Builder** creates/repairs a Job, Lisp or Temp task in its owned final source folder. It can reason and fix actual errors, then re-run the safe affected step on real CAD. No mandatory draft, checkout, static validation, approval, promotion or separate simulated TEST stage.
- These are behavioral routes of the same ChatGPT model, not extra subagents.

## Choose the smallest valid route

- **Registered Job:** `job_runtime_prepare(id=...)` for `JOB.md` Operator steps. Existing Direct `.py` registrations continue through the legacy runner only as needed for compatibility.
- **New/unregistered reusable Job:** Builder uses direct owner-scoped authoring and `job_runtime_prepare(source_path=<absolute final managed JOB.md>)` to RUN without Registry publication. After successful operation publish reusable capabilities only if requested.
- **Lisp:** author/update own managed Lisp or Temp source and LOAD via the existing bound drawing CAD host; `loaded=true` is required before calling its execution-owned command. Publish a selected reusable Lisp independently only when requested.
- **Temp Job:** allocate `temp_job_create`, own UUID scratch and perform the user-requested one-off steps. No JOB.md, Job Registry entry, entire Temp Job promotion or mandatory one-time approval ceremony. When persistent results are requested, obtain a meaningful user-chosen result folder name bound to the verified Drawing Anchor, never derive the result name from UUID. `temp_job_done` and `cg/cleartempjob` operate only on inactive Temp scratch, not named results.
- **Borrowing:** invoke a verified reusable Job Lisp with `job_capability_prepare` and the caller's CAD command ownership. Borrowing a capability never permits writes to the lender's package/results. Do not start the parent Job or manually acquire global SYSTEM lease to borrow.

## Work and AutoCAD authority

Prefer a compatible existing HYBRID Work for combined CAD/FILE activity; honor specialized FILE-only or CAD-only authority restrictions. Work continuation is not a new approval stage. CAD calls use the verified bound drawing and existing host ordering. Independent FILE/SYSTEM work may proceed concurrently with unrelated Jobs. Never infer ActiveDocument or cross another Job's owner roots.

## Save, evidence and stop

Immediately after each final CAD mutation phase, save the exact bound DWG with explicit verification (`job_runtime_save_now` for active reusable Job runtime); do not postpone Save to unrelated FILE analysis. Save is not required for genuinely read-only/FILE-only Jobs. Save failure stops the operation and must not be reported as DONE. Do not duplicate a verified Save unless later CAD calls invalidate it.

Follow the actual Job/Temp business success contract. No invented comprehensive drawing scan, PLAN/REVIEW/READBACK loop, automatic retry or manual confirmation beyond a real user-defined business decision. Report partial results and actual errors without silently expanding scope.
