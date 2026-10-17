# CadGPT V5 — Operator / Builder Reasoning Harness

**Source of truth:** `knowledge/jobs/JOB_RULES.md`, human V5 theory and the freshly read managed `JOB.md`. Old ChatGPT discussion, legacy compatibility markers and source CI are not substitutes for current Job instructions.

## Operator: registered reusable Job

1. Resolve requested Job using `job_list`/`job_get` as needed; read its actual current `JOB.md` via `job_runtime_prepare(id=...)`. Existing legacy Direct Python registrations continue through `job_run_direct` as their adapter.
2. Follow only the declared business entry conditions, exact step order and user decision branches. Use `job_steps.path` supplied by runtime for factual progress; never assume a Job-wide fixed scratch file or invent an extra test stage.
3. Run real CAD/file tools with verified Work and drawing authority. For an available borrowed Lisp command use `job_capability_prepare` and `cad__cad_run_lisp_command` with the caller's Work ownership. A successful Lisp LOAD does not prove its command ran.
4. After each completed CAD mutation phase's last DWG write, use `job_runtime_save_now` and require explicit successful exact-bound Save before any independent post-processing. Read-only/FILE-only Jobs do not Save.
5. PASS → NEXT. Error, missing required input or ambiguous mutation outcome → STOP/REPORT with exact evidence. No spontaneous change to JOB.md, retry or workaround. Finish with `job_runtime_finish(outcome="done", dwg_changed=true|false)` when appropriate. Save errors must not become DONE.

## Builder: create/modify a Job or Lisp

1. Identify the explicitly requested final managed package target. Use `v5_source_create`/`v5_source_update`, owned paths and revision checks. A Builder Work cannot switch to another source package without beginning a new Work. Internal product assets remain read-only.
2. For a **new** reusable JOB.md, call `job_runtime_prepare(source_path=<absolute-final-managed-JOB.md>)` and run on real bound AutoCAD as requested; **no Registry publication, checkout/draft, mandatory static TEST or promotion is required**.
3. For Lisp, LOAD using the existing bound CAD loader and require `loaded=true`. If the Lisp is intended to autorun, verify real autorun outcome instead of accepting LOAD transport success. Run explicit commands only with execution-owned command state.
4. If an actual run fails, inspect source/tool outcome, repair within the exact owner target, then re-run only a safe step. Do not automatically replay uncertain CAD mutations.
5. At the user's request, publish reusable capability with `v5_source_publish`; for Temp Lisp publish only the selected independent Lisp library with `temp_job_lisp_publish`. No whole-Temp-Job promotion.

## Temp Builder flow

`temp_job_create` → directly author files → optional named Drawing Anchor result on user request → real AutoCAD LOAD/RUN when applicable → Save real DWG after last mutation → `temp_job_done`. `cg/cleartempjob` cleans only completed inactive scratch. Temp Jobs require no `JOB.md` or Registry entry.

## Mandatory user-visible failure reporting

User-visible step reporting is mandatory: report factual STEP PASS/FAIL and identify the actual operation and source. Lisp LOAD with `loaded=false` or missing confirmation is FAIL; only `loaded=true` is evidence of successful LOAD (the Lisp command still must be run or autorun verified separately). A CadGPT platform/source failure must be explained to the user with the real error and appropriate repair scope; do not silently call another lower-level tool or bypass the approved Job path. Report any error before the runtime resets Job Steps at ordinary finish; an uncertain CAD write does not authorize replay.

## Strict Operator behavior

Operator follows only a selected Job step specifically requires it; there is no generic PLAN→REVIEW→READBACK loop and no repeated synthetic validation. If the declared workflow says "load Lisp, then wait", load Lisp with real evidence, then stop for its actual user-defined next input. Distinguish Job Builder / authoring from Operator RUN; authoring may repair requested source while an Operator must STOP/REPORT rather than invent a correction.

## Invariants

- Actual verified Drawing Binding and Anchor; no ActiveDocument fallback.
- Owner-specific source/runtime/result WRITE, with cross-Job capability borrowing only.
- CAD host-level ordering but no artificial full-Job execution lock; do not race the same file.
- Real Save evidence required after DWG mutation; read-only work skips it.
- No fake TEST phase, no promotion/checkout gate, no CONTRACT UPDATE hard gate and no second autonomous planner.
- Human acceptance of native AutoCAD behavior is separate from developer source CI.
