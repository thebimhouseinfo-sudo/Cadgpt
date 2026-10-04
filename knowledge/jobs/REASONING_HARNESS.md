# Reasoning Job Harness

Markdown Jobs are sequential reasoning workflows. The Job file defines the workflow order; the current drawing state determines the concrete action at each step.

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
- When a step uses dynamic Lisp derived from an already-working command, call `job_dynamic_lisp_prepare` first. If it returns `reused=true`, continue from that persisted Job copy; do not recopy the base source. Patch only the declared changing data/section with `job_dynamic_lisp_patch`, then verified-load that Job-owned Lisp and run the original command. Do not invent an adapter/wrapper around the source command.
- Repeat PLAN/REVIEW as many times as the workflow needs.
- Ask the user only when the Job cannot make a safe domain decision from its rules/evidence, or when the requested action requires an explicit user choice.
- Finish the whole Job when possible, then report completed actions, deferred/unresolved items, and final verification.

## Direct Jobs

A `.py` Job is not processed by this harness. It is a direct Job: resolve the registered script and dispatch it through the direct Job runner without model planning between its internal operations.


## Human Power

Human Power is not part of the Job workflow and is not a Job PASS condition.

If the Job is blocked by a defect or inappropriate CadGPT platform gate, the human may explicitly activate `human_power_start` for the **current work execution only**. CadGPT may then repair the platform/runtime and continue the same task without turning the Job into a permanent bypass variant.

When the task is finished, call `human_power_stop` when practical. Work stop/release/expiry/replacement also removes the grant automatically.

If Human Power changes CadGPT source, the mutation must include a fix summary and is written to the Human Power error log together with the error/expected behavior recorded at activation.
