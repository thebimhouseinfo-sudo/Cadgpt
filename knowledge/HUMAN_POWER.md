# CadGPT Human Power

Human Power is an explicit human-authorized, one-task execution privilege.

## Purpose

Human Power exists so a small CadGPT/runtime defect does not force the user to abandon the current CAD/Job task, close AutoCAD, pull code, restart CadGPT and reconstruct context merely to fix a minor platform issue.

It is **not** normal Job behavior and should not be activated when the normal path already works.

## Lifecycle

```text
active WorkRegistration
→ human explicitly approves Human Power for the current task
→ human_power_start
→ grant is attached to exactly that execution_id
→ CadGPT policy gates may be bypassed inside that execution
→ optional platform/source repair
→ continue the original task
→ human_power_stop OR work stop/release/expiry/replacement
→ normal CadGPT behavior restored
```

The WorkRegistration boundary is mandatory because it is what guarantees Human Power cannot leak into another task/chat/execution.

## Authority

While active, Human Power may bypass CadGPT policy restrictions that would otherwise block the current task, including execution-family restrictions, managed-path restrictions and runtime loader scope checks.

It may authorize edits to CadGPT repository source through the generic file mutation tools.

Operating-system permissions and the current work/session identity still exist; Human Power is not a machine-wide arbitrary shell/root privilege.

## Source mutation audit

Every CadGPT repository source mutation under Human Power must include `human_power_fix`.

The managed log:

```text
%LOCALAPPDATA%\CadGPT\logs\human-power-error-log.jsonl
```

records:

- task and grant id;
- original observed error;
- expected behavior;
- reason for activating Human Power;
- exact source path;
- create/edit action;
- description of how the patch fixes the error;
- SHA-256 before/after where applicable.

If the audit cannot be written, the source mutation must roll back rather than leave an unaudited repair.

## Runtime reload

For changes under `runtimes/cad-mcp/**`, CadGPT stops only the CAD-MCP child process after the audited mutation. The next CAD call starts a fresh child from the changed Python source. AutoCAD and the current ChatGPT work execution remain open.

Changes to the outer TypeScript/Node CadGPT core can be authored and audited under Human Power, but the already-running Node process cannot truthfully hot-reload arbitrary compiled core changes. Those changes require the normal build/runtime replacement before they take effect.

## Jobs

Human Power does not mark a Job as bypassed, does not alter Job Registry metadata, and does not reduce Job validation/promotion requirements. It only permits the current execution to recover from a CadGPT platform blocker and continue.
