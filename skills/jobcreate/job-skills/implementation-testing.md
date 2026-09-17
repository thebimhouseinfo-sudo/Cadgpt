# JobCreate — Implementation and Testing

Purpose: ensure a Job is proven by actual execution before permanent promotion.

## Principle

A Job definition is not complete because its Markdown looks correct. If the Job has not been exercised against a real approved test context, it remains a draft.

## Test preparation

Use an explicitly approved context:

- dedicated test drawing; or
- explicitly approved bound drawing when appropriate.

Never silently choose a project drawing for destructive testing.

## Test execution

Run the Job step by step using the mapped executors.

For each step capture:

```text
actual input
executor used
actual output
postcondition/evidence
PASS / FAIL / BLOCKED
```

Do not treat successful command dispatch as proof of success.

## Interactive steps

When a step requires user selection, points, keywords or dialogs:

- allow the user to perform the interaction;
- resume from the resulting CAD state;
- verify the step's success criteria afterward.

## Failure loop

```text
failure evidence
→ identify failing step
→ decide whether failure is implementation or semantics
→ if semantics change, discuss with user
→ patch draft narrowly
→ rerun affected path
→ rerun final validation
```

Do not silently change business logic to make a test pass.

## Promotion readiness

Promotion is allowed only when:

- all required steps have passed or explicitly accepted non-applicable paths;
- the final Job result matches the approved plan;
- known failures are not hidden in notes;
- the user accepts the tested workflow for permanent reuse.

A Job with a known untested required path remains draft status.
