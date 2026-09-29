# CadGPT Conversation Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one explicitly admitted CadGPT conversation and its authorized work usable when the connector replaces the MCP transport/session, without admitting an unrelated conversation.

**Architecture:** Resolve a trusted logical conversation identity at the request boundary, then key admission, work, workspace, and lazy capability state to that identity while MCP transport IDs remain transport-only. If the connector has no stable conversation identity, use a bounded continuation capability that the connector propagates reliably; without either signal, fail closed and require an explicit new launch. The first task is an evidence gate because this contract cannot be invented safely from server code alone.

**Tech Stack:** TypeScript, Node.js, Express, MCP SDK, Node test runner; Windows tray and Python CAD MCP remain downstream.

**Spec:** [`VERIFICATION/01a0eca8-4a42-79ed-8de8-c8374bcb578b.md`](../../../VERIFICATION/01a0eca8-4a42-79ed-8de8-c8374bcb578b.md), plus `IMPLEMENTATION_PLAN.md` sections 1.1, 1.2, 1.4, 1.5 and 2.1.

## Global constraints

- `Mcp-Session-Id` identifies an MCP transport/session; never treat a fresh value as proof of a new ChatGPT conversation.
- No ambient continuity from a single active CadGPT session, memory, user text, drawing path, or AutoCAD state.
- A different conversation without the trusted identity/capability must remain unclaimed and must not see or stop another conversation's work.
- Explicit launch remains necessary once per logical conversation. READY without work must survive transport rotation if the chosen continuity mechanism supports it.
- Preserve `1 work = 1 drawing`, FILE/CAD authority separation, idle expiry, explicit stop, and lazy CAD startup.
- Do not alter CAD mutation behavior, Job semantics, Lisp authoring, or unrelated release work while fixing continuity.

## Review focus

1. A new transport in the **same** conversation can run `cg/cj` and start authoring without an explicit model-inserted resume call.
2. READY with **no work handle** continues after transport rotation, while an unrelated conversation remains unclaimed.
3. A direct CAD call after Workspace Ready finds its tool family and validates the bound drawing/work without silently switching drawings.
4. `cg/list`, `cg/status`, `cg/stop`, `cg/job` → `job_get`, and register/import/export report and act on the correct logical conversation.
5. Expired, stopped, replayed, or cross-conversation credentials cannot restore authority; control/list/status do not start full CAD MCP.

---

### Task 1: Establish the connector continuity contract

**Files:** Inspect `src/index.ts`, `src/cadgpt/lib/mcp-post-routing.ts`, `src/cadgpt/lib/mcp-session-manager.ts`, and actual connector request metadata. Record the decision in this plan before changing runtime code.

**Interfaces:** Produce one verified source for `LogicalConversationKey` or one connector-propagated continuation capability. Identify its exact request field, trust boundary, lifetime, and behavior across A → B → C transport rotation.

- [ ] Capture **redacted** metadata for three events: same-chat initialize A, same-chat initialize B, and a separate chat initialize C. Compare field presence and stable values; do not log raw secrets or full user content.
- [ ] Verify the candidate identifier/capability is available on later control, discovery, and work calls, including READY-before-work. Prove C does not share it.
- [ ] Record the selected contract and its exact field names here. If neither a stable identifier nor automatic private capability propagation exists, stop implementation and report that seamless continuation is impossible with the current connector contract. Do not add a one-active-session fallback.

### Task 2: Add a failing production-choreography regression

**Files:** Modify `tests/runtime-isolation.test.mjs`; test through `createSessionManager` and `routeMcpPost` with a mock CAD-confirm callback. Do not require live AutoCAD for this boundary test.

**Interfaces:** The test uses the Task 1 trusted continuity field. It must not call `cadgpt_work_resume` or pre-inject `continuation_execution_id` / `continuation_authority_token` into the happy path.

- [ ] Add a test: admission on A → select one drawing → Workspace Ready → initialize B for the same logical conversation → `cg/cj` → `cadgpt_work_start`. Assert the old work is reused and authoring can proceed. Run it and confirm it fails on revision `f4c09116` at the observed boundary.
- [ ] Add a READY-without-work test: admission on A → B for the same logical conversation → `cg/cl` → FILE work start. Assert admission persists without relying on a work handle.
- [ ] Add an unrelated-conversation C test using a distinct/absent trusted field. Assert C cannot read, resume, mutate, or stop A/B work.
- [ ] Run the targeted test after each implementation task. Keep the existing explicit-resume tests as compatibility coverage, but do not count them as proof of automatic continuity.

### Task 3: Separate logical state from transport lifecycle

**Files:** Modify `src/cadgpt/lib/mcp-post-routing.ts`, `src/cadgpt/lib/mcp-session-manager.ts`, `src/cadgpt/server-factory.ts`, `src/cadgpt/lib/admission.ts`, and `src/cadgpt/lib/work-registration.ts`. Add one focused module for trusted logical identity/capability verification if Task 1 requires it.

**Interfaces:** `Mcp-Session-Id` remains the transport lookup key. The authenticated `LogicalConversationKey` owns admission and WorkRegistration. A transport binding to that key is explicit, bounded, and revocable; it must never be inferred by searching for a lone active work.

- [ ] Introduce the Task 1 identity resolver at the incoming request boundary. Reject malformed, missing, stale, or conflicting identity/capability before adopting logical state.
- [ ] Key claim/work lookups and `createMcpServer` callbacks to the authenticated logical key. Keep transport close/recovery separate from logical work cleanup; preserve logical state only for its documented lifetime.
- [ ] Bind a new transport to the existing logical state before `cadgpt_control`, discovery, work start, or authorized tool dispatch. Make transfer atomic with respect to active ToolLeases and concurrent transports.
- [ ] Run the Task 2 tests. Confirm unrelated C remains isolated.

### Task 4: Restore the tool surface and fix control behavior

**Files:** Modify `src/cadgpt/server-factory.ts`, `src/cadgpt/tools/control.ts`, `src/cadgpt/tools/work-control.ts`, and `src/cadgpt/lib/work-registration.ts` only where the Task 3 logical binding requires it.

**Interfaces:** A new transport exposes the discovery/FILE/CAD families required by its authenticated logical work before it receives the next call. Work credentials remain execution authority; the logical identity/capability is the conversation boundary.

- [ ] Rehydrate required lazy tool families on the new server without starting full CAD MCP for control/list/status or FILE-only work.
- [ ] Make `cg/cl`, `cg/cj`, `cg/status`, `cg/stop`, `cg/list`, and `cg/job` read the same authenticated logical state. Stop must revoke the real current work, not a transport-local empty slot.
- [ ] Permit a valid work handle on a rotated transport to reach work validation without an earlier transport-local admission rejection, while still requiring the trusted logical conversation boundary. Do not treat the bearer handle alone as permission to adopt another chat's work.
- [ ] Add tests for direct CAD, `job_get`, register/import/export, and development `cg/mcp` after rotation. Assert the correct tool family is present and a control-only call does not wake CAD MCP.

### Task 5: Lifecycle and real-connector acceptance

**Files:** Extend `tests/runtime-isolation.test.mjs` and the relevant acceptance runbook; update `README.md` / `IMPLEMENTATION_PLAN.md` only to reflect verified behavior and the chosen continuity contract.

- [ ] Test A → B → C rotations, two concurrent conversations, an active ToolLease during rotation, idle expiry, explicit stop, stale/replayed credentials, and transport close. Assert every failed authorization leaves the other conversation's state intact.
- [ ] In a writable checkout, run a fresh TypeScript build and `node --test --test-isolation=none tests/*.test.mjs` (or the normal `npm test` when child-process execution is allowed). Run `git diff --check`.
- [ ] Repeat the real connector workflow: launch → drawing selection → Workspace Ready → rotate → `cg/cj`, `cg/cl`, direct CAD, `cg/list`, `cg/status`, and `cg/stop`, plus READY-before-work → rotate → authoring. Record actual MCP session IDs in redacted form and the logical identity/capability continuity evidence.
- [ ] Report pass/fail per workflow, any connector contract limitation, and remaining AutoCAD-specific gaps. Do not mark the continuity release blocker closed from unit tests alone.

## Handoff to Sol 5.6

Start with Task 1 and the failing tests in Task 2. The central question is what trusted signal survives an MCP transport rotation for the **same ChatGPT conversation**. Do not patch `cg/cj` alone, rely on model instructions to call resume, or auto-adopt whichever work happens to be active. If Task 1 finds no such signal, stop and present the required connector change or explicit re-admission behavior as a product decision. The review file contains the reproduced failure and its limits.
