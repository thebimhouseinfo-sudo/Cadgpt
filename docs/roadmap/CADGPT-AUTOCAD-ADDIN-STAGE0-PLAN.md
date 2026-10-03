# CadGPT AutoCAD Add-in — Stage 0 Feasibility Plan

**Status:** REVISED SPEC / READY FOR IMPLEMENTATION PLANNING; real-host feasibility UNVERIFIED
**Updated:** 2026-10-03
**Project:** CadGPT
**Repository:** `thebimhouseinfo-sudo/Cadgpt`
**Implementation plan:** [Stage 0 detailed implementation plan](CADGPT-AUTOCAD-ADDIN-STAGE0-IMPLEMENTATION-PLAN.md)
**Purpose:** This repository artifact defines the Stage 0 experiment. GSA Memory and Job metadata may reference it but do not replace it.

## Goal and approved automation boundary

Determine whether an embedded AutoCAD add-in can **automatically create a NEW ChatGPT conversation B and automatically invoke/connect `@cg` in B**, obtaining independently admitted CadGPT logical sessions while conversation A remains separately resumable.

The user confirmed on 2026-10-03 that **both creation of B and invocation of `@cg` must be automatic**. Manual `@cg` invocation in B does not count as PASS.

Manual initial login, one-time connector configuration/authorization, opening the test palette, selecting the starting conversation A, and pressing Start Experiment are allowed setup actions. After Start B, no manual New Chat, composer interaction, connector selection, send, or confirmation may rescue that attempt. An unexpected authorization prompt or challenge pauses the attempt as an environment prerequisite issue; after setup is corrected, a fresh attempt must complete automatically. Do not automate credentials or bypass challenges.

Returning to A and sending its continuation probe are also automated after its non-secret navigation reference has been recorded. Automation concerns the ChatGPT UI only; it grants no CAD authority.

No production drawing-binding or multi-conversation architecture is implemented in Stage 0.

## Current source facts and experiment consequences

- `src/cadgpt/lib/logical-conversation.ts` derives a logical key from connector-provided subject/session headers using a process-local random secret. It is stable only within that CadGPT runtime.
- A missing connector identity falls back to a transport key. Different MCP transport IDs alone cannot prove distinct logical conversations.
- `continuity-diagnostics.ts` normally persists its fingerprint key, but logical fingerprints still change when the process-local logical-key secret changes. Storage failure can also yield a runtime-only fingerprint key.
- `scripts/session-continuity-test.mjs` captures the latest matching request. It does not correlate a specific experiment step or prove successful admission, so its current output is insufficient for this gate.
- A bare `@cg` already auto-binds when exactly one drawing is open. The experiment must record that existing behavior, not add a binding path or mistake CAD startup failure for failed conversation creation.

These are planning inputs verified against local source, not evidence that the embedded workflow succeeds.

## Decision gate

### Prerequisites before a verdict

T1 shell/login and T2 evidence collection must pass. Conversation A must reach successful connector-bound admission. The same account/connector must function in the normal browser control. Logs must be writable and complete enough for correlation.

If a prerequisite fails, record **PREREQUISITE_BLOCKED** and its reason. This is an execution status, not a fourth architecture outcome. Repair/retest or hand off as AMBIGUOUS. Never choose the single-conversation architecture solely because login, network, SDK, WebView runtime, evidence collection, or initial connector setup failed.

### PASS

PASS only when every required case in the detailed plan passes three consecutive complete rounds with no unresolved capability failure:

1. A successfully admits under a connector-bound logical identity.
2. The add-in automatically creates B and automatically invokes `@cg` in B.
3. B successfully admits; its logical fingerprint differs from A's **within the same CadGPT runtime**.
4. Automatic return to A and a successful session-authorized read-only probe demonstrate A's original logical fingerprint and retained admission; then return to B and verify B again.
5. WebView reload, palette recreation, and AutoCAD reopen preserve separate resumability under the runtime rules below.
6. A separate CadGPT-restart case proves fresh admission of both existing chats and their independence in the new runtime; it does not compare old/new logical fingerprints.
7. Every conclusion has uniquely correlated backend success evidence. There is no manual rescue in a counted attempt.

A second page, typed `@cg`, an initialized MCP transport, or different fingerprints on failed requests is insufficient.

If PASS, Stage 0 stops. Planner creates a separate architecture plan for multi-conversation/multi-drawing support using **capacity/capability lending**, not tool lending:

- a workspace borrows a capacity/capability handle bound to drawing/host context;
- concrete CAD tool instances are not lent between workspaces;
- operations resolve through borrowed capacity;
- multi-drawing remains within one AutoCAD process unless separately approved.

### FAIL

With prerequisites satisfied and evidence valid, FAIL if a specific capability failure reproduces in three consecutive controlled attempts:

- B can only be created or connected through manual action;
- distinct chats A/B map to the same connector-bound logical session in one runtime;
- automatic return cannot resume A independently;
- a required reload/reopen case reproducibly breaks the capability.

A failed adapter implementation is first debugged against its local tests and UI observations. One timeout, changing UI, or mixed results does not prove the product capability unavailable.

For confirmed FAIL, Planner creates this simplified architecture:

```text
1 continued ChatGPT conversation
        ↕
1 CadGPT logical session
        ↕
1 primary bound drawing
        ↕
1 acad.exe process
```

Do not retain dormant multi-drawing or capacity-lending machinery in that version.

### AMBIGUOUS

Use AMBIGUOUS for incomplete evidence, uncorrected prerequisites, mixed results, unknown identity semantics, or failures that cannot be attributed confidently. Stop for Human review; do not guess the architecture branch. Never weaken the automatic B/`@cg` requirement to obtain PASS.

## Identity and restart rules

| Condition | Required evidence | Invalid inference |
| --- | --- | --- |
| A → B → A → B; same runtime | Successful admission/probes; A != B; each unchanged on return | Different transport IDs mean different chats |
| WebView reload or palette recreation; same runtime | Same logical fingerprints and retained admission on read-only probes | A new transport implies lost conversation |
| AutoCAD reopen | Record CadGPT runtime ID before/after; apply same-runtime or new-runtime rules accordingly | Assume reopening AutoCAD always restarts or never restarts CadGPT |
| CadGPT runtime restart | Open existing A/B references, automatically re-admit, then A != B and stable returns within the new runtime | Compare old/new logical fingerprints or reuse old work authority |

Raw headers, cookies, tokens, work handles, and chat content never become evidence artifacts. UI references help navigate only and cannot establish logical identity or CAD authority.

## Stage 0 scope

Allowed:

- minimal Managed .NET add-in with `IExtensionApplication`, dockable `PaletteSet`, WPF and WebView2;
- one dedicated persistent writable WebView2 profile;
- replaceable test-only UI navigation/invocation adapter;
- local test-only navigation references for A/B;
- backend success diagnostics, bounded experiment capture/report scripts, and real-host evidence;
- existing browser CadGPT and Python/COM execution paths.

Not allowed:

- production add-in↔conversation pairing or durable drawing association;
- `Bind Current` / `Rebind Current`, transactional workspace replacement, or multi-drawing binding;
- capacity lending implementation, multi-`acad.exe` support, or replacement of Python/COM;
- scraping authentication/session secrets or inventing connector conversation identity;
- changing admission/authorization/sizing of existing work to make the experiment pass.

## T1 — Minimum real-host shell

Probe exact installed AutoCAD release/build and available SDK/API assemblies before choosing the .NET target. Record SDK/WebView2 package/runtime versions. Use a narrowly scoped development loading path and bundle skeleton.

Create one reusable palette with async WebView initialization on the UI thread. Preserve its dedicated profile across reopen. Hide/show and destruction/recreation are distinct test cases. Initialization failure must leave AutoCAD usable.

Completion: real AutoCAD loads the add-in; palette opens, hides, recreates and terminates safely; ChatGPT login and existing conversation access work. A successful build alone is insufficient.

## T2 — Adapter and correlated evidence

Implement automatic New Chat, connector invocation/send, saved-chat return, and read-only continuation probe. Verify the actual resulting page and actual backend invocation; UI selectors/actions are replaceable test logic.

Collect successful `cadgpt_admission` completion and successful session-authorized `job_list` completion, correlated to HTTP request context and logical session. Test logs must distinguish success, failure, and missing connector identity.

Each step has a bounded capture window and exactly one expected matching backend success. Other CadGPT clients are quiet during collection. Zero, duplicate, stale, unbound, or competing candidates invalidate the sample. The capture tool must not silently select the newest candidate.

Completion: deterministic negative tests reject false evidence; UI auto-creation/invocation works locally where supported; raw connector secrets and content are absent from artifacts.

## T3 — Real-host experiment

Follow the detailed plan's matrix and timing rules. First establish working A and browser controls. Then run automatic A/B/return cycles, WebView reload, palette recreation, AutoCAD reopen, and a separate runtime-restart recovery case.

Use one supported `acad.exe`. Baseline testing uses two blank unsaved fixture drawings and no drawing selection, so existing admission can remain READY without auto-binding. Add a one-drawing smoke case to record normal auto-binding; do not modify a user drawing.

Every attempted round is retained, including failures, retries, manual interventions and runtime changes. Three consecutive successful rounds are required per matrix case, with a maximum of five attempts per case after the pilot. Mixed valid capability outcomes remain AMBIGUOUS. A documented adapter/environment correction starts a fresh evaluation sequence; it never deletes earlier evidence. Stop at a reproduced capability failure or unresolved ambiguity rather than retrying indefinitely.

## T4 — Evidence-bound handoff

Produce a repository report with environment/build versions, sanitized evidence, case results, exact automation method, manual interventions, runtime boundaries, and the decision reasons.

- PASS: hand off to a new capacity/capability-lending architecture plan.
- FAIL: hand off to a single-conversation/single-drawing plan.
- AMBIGUOUS: specify what evidence or prerequisite is missing for Human review.

Coder/Tester produce Stage 0 evidence and the verdict. They do not author or execute the next durable implementation Job.

## Preserved invariants

- Browser-based CadGPT remains supported.
- Existing Python/COM CAD MCP remains the execution transport.
- UI/DOM automation is never an authority primitive.
- Active AutoCAD tab alone is never drawing authority.
- No ChatGPT authentication/session secrets are scraped.
- Diagnostic failures cannot block normal work; unavailable evidence prevents a Stage 0 verdict.
- Project implementation artifacts belong in this repository.
- Existing local TBH and diagnostics edits are preserved and kept out of unrelated commits.

## GSA orchestration reference

Current Stage 0 orchestration handle: `J-3B81`.

The GSA Job is orchestration/control-plane metadata. This spec and its linked implementation plan are the project-facing source of truth; editing them does not start or update that Job.
