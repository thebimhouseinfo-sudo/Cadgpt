# Reasoning Job Harness

Markdown Jobs are sequential reasoning workflows. The Job file defines the workflow order; the current drawing state determines the concrete action at each step.

Before a normal User Reasoning Job starts, call `job_local_compat_status`. If it returns `update_required=true`, do not start the normal Job yet: route through `jobcreate` **CONTRACT UPDATE** mode, complete/report the local scan, then mark the compatibility epoch checked. When the status is already current, this check is only the small state comparison; do not inspect all Job packages.

At the start of every actual Reasoning Job run, call `job_runtime_prepare(id=<registered-job-id>)` before any file mutation. Starting a Job automatically releases stale foreground/SYSTEM Job authority from the same logical chat, but it does not delete prior runtime bytes. Use the returned `runtime_root` for all raw/intermediate working data. If `recovery_pending=true`, drain/verify/delete the preserved pending work before or as part of the new run according to the Job contract.

## Run-start source and routing discipline

The permanent managed `JOB.md` is the **only current workflow definition**.
Each invocation starts with `job_runtime_prepare`, which returns the
`workflow.source_sha256` and freshly read `workflow.content`.
Follow those returned bytes, not a prior assistant summary, the chat history,
a remembered stage number, or instructions that were only discussed but were
never promoted to the managed Job package. The Work being HYBRID grants tool
availability, not permission to skip Job branching.

Before executing a conditional branch, inspect the **actual input condition**
named by this Job's entry step, using managed file/CAD read tools. A Job may
check raw files, final result files, or both; do not substitute one for another.
A `recovery_pending` flag is only a hint that scratch exists, never proof
that the Job's own raw-data condition is true. If the check fails, STOP rather
than assume empty/nonempty. Follow the exact branch in current `JOB.md`.

When a Job step requires a choice, ask only those choices valid for that
observed condition; wait for an explicit answer. Never reuse a choice from a
previous invocation. After a choice, execute its specified action and stopping
point. A load-only choice loads the declared Lisp and **stops** even if the
general Job definition contains additional stages. A failed tool must not be
reported as successful or bypassed by switching branches.

On a new invocation, repeat entry checks. Only carry unfinished raw/results
forward under the Job's explicit recovery instructions; neither old choices
nor model-inferred routes are persistent workflow state. If the returned
`workflow.content` conflicts with the user's latest requested change, report
the unpromoted Job definition and route that requested change to `jobcreate`;
do not silently treat the chat instruction as a permanent edit.

## Job Steps (per-Job runtime checklist)

Custom Reasoning Jobs stay plain Markdown. The promoted `JOB.md` remains
the immutable workflow contract. Each Job has one ephemeral checklist at
`<job-root>/runtime/JOB_STEPS.md`, returned as `job_steps.path` by
`job_runtime_prepare`. Use existing managed file tools; no new Job tool,
parser, checkpoint engine, or global controller.

On each new run, freshly read `workflow.content`, inspect the actual entry
condition, and create/reconcile `JOB_STEPS.md` to that workflow and the
currently selected branch. The file contains a short header with Job ID,
`workflow.source_sha256`, drawing identity if applicable, and the actual
observed entry condition. Use an ordered checklist with only:
`- [ ]` pending, `- [✓]` verified successful, `- [✗]` failed.
Ask explicit user choices only when the current Job step requires them.
Do not invent a choice from old chat history or auto-expand unselected branches.

Work on one required step at a time. After a tool completes, verify its
readback/postcondition, then use `file_edit` with the current hash to mark
that step `[✓]`. On failure, mark `[✗]`, report the real error and stop
instead of advancing. A `[ ]` or `[✗]` required step blocks the next
step; neither sending a tool call nor a model assertion counts as PASS.

On Job success, error/stop, or replacement by a new Job, the CadGPT runtime
restores ✓/✗ markers to `[ ]` in that Job's `runtime/JOB_STEPS.md`.
After a terminal failure, first record the failed step and its actual error in the
user-facing report, then invoke `job_runtime_finish` (foreground) so the list
is restored; for detached SYSTEM work invoke `job_system_release` instead.
Do not finish during an ordinary user-choice pause; keep that run available
until user replies. An intentional "load Lisp then wait for new raw" stop point
may finish the current invocation after load verification, without completing
any unexecuted Job stages.
It never deletes the checklist, actual raw data, results, or metadata.
Driver-crash recovery also resets progress marks at the next run's prepare,
then rechecks evidence before repeating any potentially mutating step.
Repeated prepare for the SAME active Job preserves its current marks.
Always reconcile an older checklist against the fresh JOB.md SHA, real raw/
result content, and current branch before using it. A load-Lisp-then-wait
choice is an intentional stop for that invocation, not a declaration that
other Job stages have completed.

## Runtime loop

For each Job step:

```text
READ
→ PLAN
→ REVIEW
→ REVISE if needed
→ EXEC
→ READBACK
→ NEXT
```

Rules:

- Execute read-only observations first when the Job calls for them.
- Do not assume a plan for later steps is still valid before those steps are reached.
- A step may change the drawing and therefore change the input for the next step.
- Build and review only the concrete plan needed for the current reasoning/mutation stage.
- Review is internal quality control, not a user confirmation prompt.
- The review may add, remove, defer, or narrow actions when evidence is uncertain.
- If an item is uncertain but the Job can safely continue without it, defer/skip that item and keep running the workflow.
- Re-read the drawing after mutation whenever the next step depends on the resulting state.
- After every filesystem/CAD mutation, re-read the actual target/postcondition before advancing; do not treat the intended path/action as proof of success.
- When the Job needs a final persistent drawing result, call `drawing_job_result_location` and write only the final result under the returned `jobs/<job-name>-result` path. Never construct or guess the drawing root. Keep raw/intermediate files under the Job runtime.
- Call `job_runtime_finish` when the Reasoning Job run/test is complete so execution-scoped Job write authority is released and empty result namespaces can be cleaned. It never deletes non-empty runtime data; processed raw/intermediate files must be removed explicitly with `file_delete`.
- Exception for an independent post-CAD data-processing tail: after every CAD-dependent input is already collected and any required `drawing_job_result_location` has already been resolved, call `job_system_acquire(id=<registered-job-id>)`. From that point the detached tail uses `tool_id=<job-id>` for `file_*` calls instead of the foreground work handle. The Job source owns this decision; CadGPT does not infer or register a backend flag.
- A Job that acquired SYSTEM authority must always call `job_system_release(tool_id=<job-id>)` when that independent tail ends, including its failure/finally path. Do not call `job_runtime_finish` for the detached runtime; SYSTEM release owns that cleanup.
- For Job-owned raw/intermediate files under the authorized runtime root, cleanup is transactional: persist the durable result, verify/read back that result, read the raw file hash, then call `file_delete(path=<raw>, expected_sha256=<verified-hash>)`. Delete one processed raw at a time; never delete a raw item before its corresponding durable result is verified. `file_delete` does not remove directories or CadGPT source files.
- When a step uses dynamic Lisp derived from an already-working command, call `job_dynamic_lisp_prepare` first. If it returns `reused=true`, continue from that persisted Job copy; do not recopy the base source. Patch only the declared changing data/section with `job_dynamic_lisp_patch`, then verified-load that Job-owned Lisp and run the original command. Do not invent an adapter/wrapper around the source command.
- Repeat PLAN/REVIEW as many times as the workflow needs.
- Ask the user only when the Job cannot make a safe domain decision from its rules/evidence, or when the requested action requires an explicit user choice.
- Finish the whole Job when possible, then report completed actions, deferred/unresolved items, and final verification.

## Direct Jobs

A `.py` Job is not processed by this harness. It is a direct Job: resolve the registered script and dispatch it through the direct Job runner without model planning between its internal operations.

The Direct Job runner performs the same ownership setup automatically: it resets `<job-root>/runtime`, runs the child with that directory as CWD, supplies `CADGPT_JOB_RUNTIME_ROOT`, and when a drawing is bound supplies `CADGPT_JOB_RESULT_ROOT` for `<drawing-root>/jobs/<job-name>-result`. Empty Job result namespaces are cleaned when the Job runtime finishes.


## Human Power

Human Power is not part of the Job workflow and is not a Job PASS condition.

If the Job is blocked by a defect or inappropriate CadGPT platform gate, the human may explicitly activate `human_power_start` for the **current work execution only**. CadGPT may then repair the platform/runtime and continue the same task without turning the Job into a permanent bypass variant.

When the task is finished, call `human_power_stop` when practical. Work stop/release/expiry/replacement also removes the grant automatically.

If Human Power changes CadGPT source, the mutation must include a fix summary and is written to the Human Power error log together with the error/expected behavior recorded at activation.
