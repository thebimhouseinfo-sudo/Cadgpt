# Reasoning Job Harness

Markdown Jobs are sequential reasoning workflows. The Job file defines the workflow order; the current drawing state determines the concrete action at each step.

Before a normal User Reasoning Job starts, call `job_local_compat_status`. If it returns `update_required=true`, do not start the normal Job yet: route through `jobcreate` **CONTRACT UPDATE** mode, complete/report the local scan, then mark the compatibility epoch checked. When the status is already current, this check is only the small state comparison; do not inspect all Job packages.

At the start of the actual Reasoning Job run, call `job_runtime_prepare(id=<registered-job-id>)`. Use the returned `runtime_root` for all raw/intermediate working data. A new run resets that runtime; it is not a history store.

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
- Call `job_runtime_finish` when the Reasoning Job run/test is complete so execution-scoped Job write authority is released and empty result namespaces can be cleaned.
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
