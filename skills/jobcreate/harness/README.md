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

The workspace Job draft must conform to `knowledge/jobs/JOB_RULES.md`.

Check:

- identity and goal;
- preconditions;
- ordered steps;
- per-step tool scope;
- outputs;
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

For each required step verify its success criteria from actual output/state.

## Gate J7 — Final validation

Verify the end result defined by the approved plan.

PASS only when the final drawing/file/result state is correct, not merely when every call returned without error.

## Gate J8 — Promotion

Permanent promotion is allowed only after:

```text
J0 PASS
J1 PASS
J2 PASS
J3 PASS
J4 PASS
J5 PASS
J6 PASS
J7 PASS
user accepts tested Job
```

Then promote into the managed Job Library and synchronize User Registry.

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
→ identify requested delta
→ preserve unaffected behavior
→ re-plan affected steps
→ approval
→ draft patch
→ real test
→ final validation
→ promotion
```
