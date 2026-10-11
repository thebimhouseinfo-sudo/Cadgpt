# CadGPT Orchestrator — Execution Routing

This policy describes **routing between established workflows, temporary one-shot tasks, and authoring**. It is not a Custom Job workflow, a Job Registry entry, or a new runtime lifecycle.

## Choose the smallest valid route

- **Custom Job invocation:** read the current promoted workflow, choose only the branch prescribed by its entry conditions, and execute it exactly. The Strict Custom Job Execution Harness controls its scope. Never invent an additional review, after-action audit, drawing scan, or alternate branch.
- **Job Builder / Job authoring:** use normal planning, coding, source validation and review practices while building or revising a permanent Custom Job. Do not apply the strict *execution* restriction to designing a new workflow.
- **Temp Job:** for a user-requested one-off sequence without a registered Custom Job workflow, present a concise plan with intended target, data to use and operations, obtain the user's approval once, then execute the approved steps and report results. It creates no managed JOB.md, Job ID, draft, promotion, Registry entry or Temp-owned directory.
- Do not restart or retire an existing Work just because the assistant performs a Temp sequence during a Job Builder session. Continue authoring from its previous files and context afterward, unless the user explicitly changes scope.

## HYBRID is the normal execution path

- Default every Work to **HYBRID** regardless of which tool family is needed for the immediate subtask. Reuse an existing compatible HYBRID work_handle for FILE actions, CAD MCP actions, or both, without repeated Work starts, upgrades or mode changes.
- FILE-only and CAD-only are explicit specialist exceptions with their original tool-family restrictions. **Never** invoke FILE tools under CAD-only authority, or CAD tools under FILE-only authority.
- A Temp sequence does not call job_runtime_prepare, job_run_direct, Job transition or a managed Job SYSTEM lease merely to borrow one reusable capability. Use a genuinely independently callable capability or the approved base tools.

## Minimum necessary reasoning and evidence

- Once the user has approved a Temp plan, execute its defined steps in order. Technical reasoning is limited to the next required step; no speculative checking, unrelated history audit or redundant permission prompt.
- Prefer valid existing result/metadata when the task explicitly operates on stored data. Do not treat stored results as live CAD state. A user request about the drawing's current state still needs a fresh bound CAD read.
- Use the exact verified Drawing Anchor, user-approved result and fields, source version checks, and appropriately scoped tool privileges. Incomplete identity, conflict, denied rights or reported tool failure are blockers; do not fabricate success or silently expand the scope.
- Report actual partial completion accurately when stored result changes succeeded but CAD synchronization did not. Do not automatically start a wider recovery or re-scan unless the approved workflow requires it.
- Existing callable batch tools and data-driven Lisp are preferred over rewriting a Custom Job or issuing numerous single-object CAD calls. Temporary Lisp may be produced only within the approved scope and via the approved shared runtime, then cleaned up after use.

## Stop and return

- Perform only the explicit acceptance checks in the established workflow or Temp plan and the mandatory checks enforced by the platform/tool. Do not add a comprehensive readback or consequence audit merely because a mutation occurred.
- Finish the Temp task and resume the existing conversation/Builder work without creating a new workflow lifecycle. If a required condition fails, report the original error and unexecuted steps; ask the user only for a material scope decision.
