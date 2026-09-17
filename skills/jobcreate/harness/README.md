# JobCreate Harness

This harness constrains `jobcreate` reasoning and defines the gates a Job must pass before permanent promotion.

## Gate J0 — Intent boundary

PASS when:

- the Job goal is explicit;
- the authoring mode is known: goal-only, user skeleton, or refine existing;
- missing business semantics are not silently invented.

FAIL/BLOCKED when the requested behavior depends on an unresolved business rule that is being guessed.

## Gate J1 — Skeleton agreement

PASS when:

- the ordered workflow stages are understandable;
- the user has agreed to the skeleton or supplied it;
- important scope/exclusions are recorded.

No Job draft is written yet.

## Gate J2 — Detailed step map

Each step must have:

```text
id
instruction
inputs
output
success_criteria
failure_handling
preferred_tools
viable_tools
mutation_scope
validation/evidence
```

Tool references must resolve to real registered/current capabilities or be explicitly marked as implementation requirements.

## Gate J3 — Planning approval

Present the complete workflow/tool/test plan to the user.

PASS only after explicit user approval to implement.

**Draft creation is blocked before J3 PASS.**

## Gate J4 — Draft contract

For existing Jobs, use `job_checkout`; do not mutate the managed library directly. New drafts are created only under `appdata/workspace/job-draft/**`.

The workspace Job draft must conform to `knowledge/jobs/JOB_RULES.md`, then pass `job_draft_validate`.

Check:

- identity and goal;
- preconditions;
- ordered steps;
- per-step tool/executor scope;
- outputs/postconditions;
- success/failure semantics;
- final validation;
- unresolved items.

A refinement must preserve unaffected accepted semantics.

## Gate J5 — Capability readiness

Every required executor must be available and sufficiently validated for the test path.

If AutoLISP must be created or changed, `write-lisp` must complete its applicable gates before returning to the Job step.

Missing required primitives are blockers, not invitations to invent behavior.

## Gate J6 — Real execution

Run the draft Job against an explicitly approved test context.

PASS requires evidence from actual execution. Merely loading the Job definition or successfully dispatching a command is not enough.

For each required step verify its success criteria from actual output/state. Preserve concise test evidence suitable for `job_promote_draft`.

## Gate J7 — Final validation

Verify the end result defined by the approved plan.

PASS only when the final drawing/file/result state is correct, not merely when every call returned without error. Preserve final-validation evidence suitable for `job_promote_draft`.

## Gate J8 — Promotion

Permanent promotion is allowed only after:

```text
J0 PASS
J1 PASS
J2 PASS
J3 PASS
J4 PASS (including job_draft_validate)
J5 PASS
J6 PASS
J7 PASS
user accepts tested Job
```

Then call `job_promote_draft` with `user_accepted=true`, test evidence and final-validation evidence. The promotion tool performs the permanent managed-library write and User Registry synchronization as one rollback-safe operation.

Generic file tools must never be used to edit `appdata/libraries/jobs/**` directly.

## Mandatory stop conditions

Stop and ask/resolve instead of guessing when:

- business/domain semantics are ambiguous;
- two tools produce materially different business behavior;
- destructive scope is not approved;
- test target is not approved;
- actual test result contradicts the planned success criteria.

## Refinement harness

Existing Jobs use the same gates, but J0/J1 start from the current managed workflow:

```text
load existing Job
→ job_checkout
→ identify requested delta
→ preserve unaffected behavior
→ re-plan affected steps
→ approval
→ draft patch
→ job_draft_validate
→ real test
→ final validation
→ job_promote_draft
```
