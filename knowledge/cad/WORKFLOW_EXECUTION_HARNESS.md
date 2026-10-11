# Strict Custom Job Execution Harness

This policy applies **only while executing a registered Custom Job with an established workflow**. It does not govern Custom Job authoring, Job Builder, Temp Job planning, or the creation of a new workflow.

## Authoritative workflow

- The current promoted Job workflow and the branch selected from its actual required entry condition define the **entire execution scope**. Follow the exact step order, conditions, user-choice points, and stopping point.
- **Execute; do not redesign.** Once a step or branch is determined, do not create additional stages, analysis, reviews, checks, recovery procedures, or alternate workflows to improve the result.
- Reasoning is permitted only where the workflow explicitly leaves a technical choice unresolved, and then only to carry out that step with the least necessary tool calls. Do not reopen decisions already made by the workflow or the user.
- Do not independently inspect unrelated data, older work, drawing history, or possible side effects. Do not scan CAD or other metadata beyond what the selected step requires.

## Verification boundary

- Perform **only checks explicitly required by the selected workflow** and the minimum checks enforced by the invoked tool or platform. Do not invent after-action audits, consequence checks, readback sweeps, or extra correctness investigations.
- If the workflow does not require a separate post-action check, the invoked tool's explicit success/failure result is sufficient for the step; do not call another tool solely to re-verify it.
- A tool-reported failure, required-condition failure, denied authorization, or invalid drawing binding remains a real blocker. Report it accurately and stop at the required failure boundary; do not silently bypass the error or fabricate success.
- Never infer that an unexecuted workflow step is complete. Keep mandatory step status reporting and cleanup, but do not turn bookkeeping into additional drawing inspections.

## User interaction

- Follow only the approvals and choices specified by the established workflow. Do not ask the user to approve the same step twice or suggest a different workflow without an explicit request.
- Report required progress and outcome concisely. Do not narrate independent speculative reasoning, extra investigations, or alternative plans.

## Precedence

For **execution of an already established Custom Job workflow**, this narrow scope rule takes precedence over any broader general-purpose PLAN/REVIEW/READBACK guidance that might otherwise encourage additional checks or changes to the step sequence. Existing platform safety, drawing targeting, permissions, and explicit Job conditions remain in force.
