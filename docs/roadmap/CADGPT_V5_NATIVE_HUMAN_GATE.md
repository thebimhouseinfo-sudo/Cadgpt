# CadGPT V5 — Native AutoCAD Human Gate

Status: **READY FOR HUMAN VALIDATION ONLY after the matching Windows/Linux Source CI PASS**. This is an acceptance test gate, **not** a legacy Job test/promotion stage. Never promote feature code to main automatically.

## Preconditions

- Git branch must be `feature/core-function-v5`; commit SHA must match the linked CI build being accepted.
- Source build and regression suite must pass on both Windows and Ubuntu.
- Use a disposable copy of a DWG, never a production drawing.
- Back up existing CadGPT AppData registry files and DWG before any test. Use a temporary V5 AppData directory where possible.
- The installed stable CadGPT tray cannot be allowed to compete for the same AutoCAD connection. Run one CadGPT instance at a time; do not install or alter Windows autostart while testing.
- No new mandatory draft, checkout, promote, SYSTEM lease or Human Power override is allowed to make an individual Job work.

## Human acceptance cases

1. **Binding continuity.** Start V5 locally, bind one copied DWG, record its drawing ID/anchor. Confirm identity remains stable through consecutive commands, Job A→B transitions and a reconnect.
2. **Reusable Builder.** Under a Builder Work, directly create or update a new managed Job's final `JOB.md`, execute using `job_runtime_prepare(source_path)`, edit after an error and rerun. Confirm no draft/promote is required and that an unrelated Library/Job cannot be modified.
3. **Direct Python Builder.** Create an innocuous final `.py` Job; run with `job_run_direct(source_path)` without publishing. Verify file-only processing does not unnecessarily occupy CAD Host queue. A script that mutates CAD must prove exact bound-DWG Save; no DONE after a failed Save.
4. **Temp Job.** Create one Temp Job, write/edit an owner-scoped Lisp, real `temp_job_lisp_load`, run a harmless command, observe actual drawing changes. Create a user-named persistent result under the verified Drawing Anchor; finish and clear Temp. Result survives, Temp scratch is removed.
5. **Lisp publication.** Explicitly publish a selected Temp Lisp as a standalone reusable Lisp library. Check Registry discoverability and that the original Temp Job remains independent. Reject collisions.
6. **Borrowing.** Use one registered Job's read-only reusable Lisp capability from Job B without acquiring a whole-Job/SYSTEM-wide lock. Verify no cross-Job FILE writes.
7. **Final Save.** After the final actual CAD mutation call `job_runtime_save_now`; the finish step must reuse verified Save rather than saving twice. After another CAD call, Save proof must be invalidated. Failed save must report failure and retain runtime.
8. **Parallel and cleanup.** Execute two source-isolated V5 Jobs using the same reusable package; their `runtime/runs/<execution>` directories and result roots must not overlap. Clean one without affecting the other.
9. **Shutdown/recovery.** Interrupt one controlled *Registry publication simulation* only in a disposable AppData copy; restart to verify paired Registry files recover together. Do not intentionally crash production CAD.
10. **Regression.** Run a known established User Job and internal TBH toolkit in the copied DWG, ensuring compatibility and command LOAD still work.

## PASS criteria

- All ten scenarios have actual command/result evidence (including at least one DWG state before/after Save).
- No unexpected `JOB_RUNTIME_BUSY`, cross-owner write, unverified Save reported as DONE, lost bound identity or mandatory legacy authoring gate.
- Report each failure with the exact tool error, console log and current branch SHA. Failures stop acceptance; fix on V5 feature branch and rerun CI, then repeat affected native cases.

## Rollback

Keep the original checkout and `main` untouched. Stop V5's tray, restart the prior stable CadGPT instance, and reopen the original production drawing only after V5 runtime is stopped. Restore test AppData only inside its disposable test environment. Never delete real Drawing Anchor results while clearing Temp Jobs.

## Evidence template

| Case | PASS/FAIL | Drawing | Execution | Evidence (tool output/log) |
| --- | --- | --- | --- | --- |
| Binding continuity | | | | |
| Reusable Builder | | | | |
| Direct Python | | | | |
| Temp LOAD/RUN/result | | | | |
| Independent Lisp publication | | | | |
| Capability borrowing | | | | |
| Save witness/invalidated | | | | |
| Parallel execution cleanup | | | | |
| Restart recovery | | | | |
| Existing Job regression | | | | |
