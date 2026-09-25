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
- Repeat PLAN/REVIEW as many times as the workflow needs.
- Ask the user only when the Job cannot make a safe domain decision from its rules/evidence, or when the requested action requires an explicit user choice.
- Finish the whole Job when possible, then report completed actions, deferred/unresolved items, and final verification.

## Direct Jobs

A `.py` Job is not processed by this harness. It is a direct Job: resolve the registered script and dispatch it through the direct Job runner without model planning between its internal operations.
