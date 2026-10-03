# CadGPT AutoCAD Add-in — Stage 0 Feasibility Plan

**Status:** READY FOR IMPLEMENTATION / REAL-HOST TEST  
**Project:** CadGPT  
**Repository:** `thebimhouseinfo-sudo/Cadgpt`  
**Purpose:** Project-facing implementation plan. GSA Memory may reference this plan for orchestration, but does not replace this repository artifact.

## Why Stage 0 exists

Before committing CadGPT to either a single-conversation/single-drawing design or a multi-conversation/multi-drawing design, test one product capability in the real AutoCAD add-in:

> Can the embedded add-in automatically create/open a NEW independent ChatGPT conversation, connect `@cg`, and obtain a distinct admitted CadGPT logical session while the original conversation remains separately resumable?

No production drawing-binding architecture is implemented before this question is answered with real evidence.

## Decision gate

### PASS

PASS only if all are true:

1. Conversation A can be opened/continued in the embedded add-in and admitted to CadGPT.
2. The add-in can automatically create/open Conversation B.
3. Conversation B can independently invoke/connect `@cg`.
4. CadGPT proves A and B have distinct logical-session fingerprints without exposing connector secrets.
5. Conversation A remains independently resumable/reconnectable.
6. The result remains reproducible after WebView reload and at least one AutoCAD/add-in reopen.

If PASS, Stage 0 stops and Planner creates a new implementation/architecture plan for multi-conversation/multi-drawing support.

That future design must first redesign MCP/CadGPT around **capacity/capability lending**, not tool lending:

- a workspace borrows a capacity/capability handle bound to its drawing/host context;
- concrete CAD tool instances are not lent between workspaces;
- tool operations resolve through the borrowed capacity;
- multi-drawing remains within one AutoCAD process unless multi-process support is separately approved and designed.

### FAIL

FAIL if any of these are true:

- the add-in can only continue the already-open conversation;
- creating a new conversation requires manual user action;
- a second WebView/chat surface resolves to the same admitted CadGPT logical session;
- Conversation B cannot independently connect `@cg`;
- Conversation A cannot remain independently resumable;
- the behavior is too unreliable to reproduce across reload/reopen.

If FAIL, the downstream add-in architecture is intentionally simplified to:

```text
1 continued ChatGPT conversation
        ↕
1 CadGPT logical session
        ↕
1 primary bound drawing
        ↕
1 acad.exe process
```

No dormant multi-drawing or capacity-lending machinery is retained in that version.

### AMBIGUOUS

If evidence cannot confidently establish PASS or FAIL, stop and require Human review. Do not guess an architecture branch.

---

## Stage 0 Scope

Stage 0 may implement only what is necessary to run the feasibility test:

- minimal Managed .NET AutoCAD add-in;
- `IExtensionApplication` entry point;
- dockable `PaletteSet`;
- WPF host;
- embedded WebView2;
- dedicated persistent WebView2 profile;
- test-only Chat navigation adapter;
- non-secret CadGPT continuity/session fingerprint diagnostics;
- real AutoCAD test harness/evidence.

Stage 0 must **not** implement:

- production add-in↔conversation pairing;
- durable drawing association;
- `Bind Current` / `Rebind Current`;
- transactional workspace replacement;
- multi-drawing binding;
- capacity/capability lending;
- multi-`acad.exe` support;
- replacement of Python/COM CAD MCP;
- scraping of ChatGPT cookies, auth tokens, `x-openai-session`, or `x-openai-subject`.

---

## T1 — Minimum AutoCAD add-in + WebView2 shell

Create the smallest real add-in needed for the test.

### Work

- Create a Managed .NET AutoCAD add-in project.
- Use `IExtensionApplication`.
- Create a dockable `PaletteSet` with WPF/WebView2.
- Probe the installed/target AutoCAD release before selecting the .NET target and AutoCAD API references.
- Add a development loading path and deployable bundle skeleton.
- Use a dedicated writable WebView2 profile.
- Load ChatGPT Web and prove an existing conversation can be continued.
- Do not add drawing/workspace mutation logic.

### Completion

- Add-in loads in the target AutoCAD.
- CadGPT palette opens and closes safely.
- WebView2 loads ChatGPT.
- Login/profile persistence works where WebView2 supports it.
- Existing conversation can be resumed.
- No production binding path exists yet.

---

## T2 — Conversation probe + safe continuity diagnostics

Add only the instrumentation needed to distinguish Conversation A from Conversation B.

### Work

- Reuse CadGPT's logical-conversation mechanism.
- Expose a non-secret continuity/logical-session fingerprint for test evidence.
- Never log or expose raw OpenAI connector subject/session headers.
- Add a replaceable test-only navigation adapter that can attempt:
  - New Chat navigation/creation;
  - optional automated `@cg` invocation.
- Record manual fallback separately; manual success does not count as PASS for auto-new-chat capability.

### Completion

- Conversation A produces a stable non-secret fingerprint/evidence record.
- Test adapter can attempt New Chat without scraping authentication/session secrets.
- Diagnostics can prove whether a later `@cg` admission is the same logical conversation or a distinct one.

---

## T3 — Real AutoCAD independent-conversation test

This is the decisive experiment.

### Procedure

1. Start AutoCAD with one supported `acad.exe` process.
2. Open the CadGPT add-in panel.
3. Open/continue Conversation A.
4. Invoke/connect `@cg`.
5. Capture Conversation A's non-secret logical-session fingerprint.
6. From the add-in, automatically create/open Conversation B.
7. Invoke/connect `@cg` in B.
8. Capture Conversation B's fingerprint.
9. Prove A and B are distinct.
10. Return to/resume A and prove it still maps to A.
11. Reload WebView and repeat the critical checks.
12. Close/reopen the add-in or AutoCAD once and repeat enough of the flow to establish reliability.

### Evidence required

- exact steps used to create/open B;
- whether DOM/UI automation was involved;
- Conversation A fingerprint;
- Conversation B fingerprint;
- proof fingerprints are different for PASS;
- proof A remains separately resumable;
- WebView reload result;
- AutoCAD/add-in reopen result;
- `@cg` connection result for each conversation;
- all failures and manual fallbacks.

### PASS threshold

A second UI page is not enough. PASS requires a second **independently admitted CadGPT logical conversation**.

Manual-only creation is FAIL for the escalation gate.

---

## T4 — Evidence-bound architecture handoff

Stage 0 does not implement either final architecture.

After T3, produce one decision:

- **PASS** — Planner may create a new capacity/capability-lending multi-conversation/multi-drawing plan.
- **FAIL** — Planner creates the single-conversation / single-drawing / single-`acad.exe` implementation plan.
- **AMBIGUOUS** — stop for Human review.

Coder/Tester only produce evidence and the branch decision. They do not author the next durable implementation Job.

---

## Preserved CadGPT invariants

Regardless of the eventual branch:

- browser-based CadGPT remains supported;
- existing Python/COM CAD MCP remains the execution transport unless a separate future decision changes it;
- no UI/DOM automation becomes an authority primitive;
- no ChatGPT auth/session secrets are scraped from WebView2;
- active AutoCAD tab alone is not drawing authority;
- project implementation artifacts belong in this repository.

## GSA orchestration reference

Current Stage 0 orchestration handle: `J-3B81`.

The GSA Job is orchestration/control-plane metadata. This file is the project-facing plan that reviewers should inspect together with the live CadGPT source.
