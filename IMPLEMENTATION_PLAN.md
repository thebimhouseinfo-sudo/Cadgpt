# CadGPT — Current Implementation Plan

Status: **Stage 1 complete; Runtime Isolation / Admission Refactor planned before Stage 2**  
Repository: `thebimhouseinfo-sudo/Cadgpt`  
Real-AutoCAD validation: **Stage 2, not yet claimed**  
Revision focus: **explicit @cadgpt admission, execution/tool leases, FILE vs CAD isolation, multi-drawing concurrency, lazy runtime, Windows tray startup**

This file is the current implementation authority. Historical migration details belong in `MIGRATION_PLAN.md` / `MIGRATION_MATRIX.md`; old CAD-Agent layout assumptions are not architectural requirements.

---

## 0. Refactor objective

CadGPT must remain a thin ChatGPT-controlled local execution layer, but the current Beta runtime needs one architectural tightening before Stage 2:

1. ChatGPT may decide to call CadGPT even when the user did not intend to use it. CadGPT must therefore enforce its own **server-side admission gate**.
2. CadGPT and GPTWorker may be loaded at the same time and may use the same underlying Windows/file capabilities. Execution context must never drift between providers, chats, Jobs, Skills, files, or drawings.
3. Multiple ChatGPT sessions must be able to work on different AutoCAD drawings without sharing a global drawing target.
4. File work and CAD work are different execution paths and must stay separated.
5. Windows idle state must stay lightweight: tray + slim control plane + Secure MCP Tunnel only.

The refactor deliberately learns from GPTWorker's current architecture:

- lightweight admission handshake;
- `ACTIVE / CONTROL / INACTIVE` control signal;
- admission token before discovery/nomination;
- WorkRegistration;
- opaque authority token;
- generation/epoch protection;
- per-call ToolLease IDs;
- lazy family loading;
- low-frequency tray health checks.

CadGPT does **not** copy GPTWorker's Job+Workspace model as a universal CAD model.

---

## 1. Product boundary

CadGPT is a **thin local execution/orchestration layer that lets ChatGPT work with AutoCAD and CadGPT-managed files**.

CadGPT does not provide:

- a separate chat UI;
- a local AI/model runtime;
- model-provider abstraction;
- a second autonomous reasoning agent;
- a general-purpose coding shell competing with GPTWorker.

ChatGPT remains the reasoning/chat surface.

CadGPT has exactly two work execution paths:

```text
CadGPT
├── FILE work
│   └── managed file/Lisp/Job authoring capabilities
└── CAD work
    └── CAD MCP capabilities against explicit drawing contexts
```

Control/admission is not a third work path; it is the lightweight gate before work.

---

## 2. Hard ChatGPT admission gate

### 2.1 Why the gate exists

CadGPT cannot change ChatGPT's plugin/router behavior. ChatGPT may call CadGPT because the request looks CAD-related even when the user did not invoke CadGPT.

Therefore CadGPT must reject its own use unless the **current user turn** explicitly invokes it.

### 2.2 Admission contract

Reference pattern from GPTWorker:

```text
ChatGPT considers provider
→ admission_check(current user turn)
→ ACTIVE / CONTROL / INACTIVE
```

CadGPT adopts the same lightweight control-plane handshake as:

```text
cadgpt_admission(current_user_turn)
→ ACTIVE / CONTROL / INACTIVE
```

The result is an **internal control signal**, not user-facing content.

### 2.3 CadGPT is stricter than GPTWorker

The only valid invocation evidence is:

```text
literal "@cadgpt" in the exact current user turn
```

There is no exception for:

- a CAD-looking task;
- an AutoLISP file;
- an absolute local path;
- AutoCAD already running;
- an open drawing;
- previous CadGPT use in this conversation;
- another chat;
- saved state;
- memory;
- project familiarity;
- ChatGPT deciding CadGPT is probably appropriate.

Invariant:

> **CadGPT is explicit-invocation only. No literal `@cadgpt` in the current user turn means the user did not invoke CadGPT.**

### 2.4 Admission modes

`INACTIVE`

- current user turn does not contain literal `@cadgpt`;
- return internal signal telling ChatGPT to stop all CadGPT flow;
- do not load Jobs, Skills, registry, files, drawings, CAD manifest, or CAD MCP;
- do not ask the user to activate CadGPT;
- ChatGPT continues normally or uses the provider the user actually requested.

`CONTROL`

- current turn contains `@cadgpt`;
- request is explicitly a lightweight CadGPT control/status/help action;
- only control-plane allowlisted operations may run;
- no FILE/CAD execution authority is created.

`ACTIVE`

- current turn contains literal `@cadgpt`;
- CadGPT work may proceed;
- mint a short-lived opaque `admission_token`.

### 2.5 Admission token

An ACTIVE token must be:

- opaque;
- scoped to the current MCP/chat session;
- short-lived;
- non-transferable to another chat;
- invalid after expiry/restart/session teardown.

Every CadGPT discovery/work entry point after admission must require the token.

No direct-entry bypass is permitted.

Conceptual flow:

```text
ChatGPT calls cadgpt_admission
        ↓
exact current turn contains @cadgpt?
   ├─ no  → INACTIVE → STOP CadGPT
   └─ yes → ACTIVE/CONTROL
                    ↓
             admission_token
```

---

## 3. Slim control plane and Windows idle state

The current wake-agent behavior:

```text
first MCP request
→ wake full CadGPT core
```

must be retired.

A generic ChatGPT initialize/tool probe must not wake the heavy CadGPT runtime.

Target idle state:

```text
Windows sign-in
├── CadGPT tray host
├── slim CadGPT MCP control/admission plane
└── OpenAI Secure MCP Tunnel

Full FILE execution modules = unloaded
CAD manifest/business modules = unloaded
CAD MCP = off
AutoCAD polling = off
```

The externally connected MCP endpoint must be able to perform admission without activating heavy execution code.

Implementation direction:

- move admission/control handling into the always-on slim MCP process;
- do not hand the external MCP session to a separate heavy server merely to perform admission;
- heavy CadGPT capability families are dynamic/lazy modules behind the same admitted control plane, or are delegated to internal executors that do not own external admission authority.

This avoids the MCP-session handoff problem and keeps invalid/guessed CadGPT calls cheap.

---

## 4. Execution authority model

Admission means “the user invoked CadGPT.” It does **not** itself authorize arbitrary mutation.

After ACTIVE admission, actual work gets a separate WorkRegistration.

CadGPT work owners may be:

```text
skill:write-lisp
skill:jobcreate
job:<concrete-job-id>
direct-cad
other future CadGPT-owned workflow
```

CadGPT must not force every CAD action into a concrete Job.

### 4.1 WorkRegistration

Target structure:

```text
WorkRegistration
├── execution_id
├── authority_token
├── admission_id / admission_token reference
├── mcp_session_id
├── owner_type
├── owner_id
├── job_id?              # only when owner is a concrete Job
├── driver_epoch
├── generation
├── call_sequence
├── created_at
└── last_activity_at
```

Conceptual execution ID:

```text
exec:{ownerId}@{sessionKey}:e{driverEpoch}:g{generation}
```

The `authority_token` is opaque and must be validated before execution.

### 4.2 Epoch and generation

Learn directly from GPTWorker:

- `driver_epoch` prevents stale authority surviving runtime restart;
- `generation` prevents stale authority surviving work/context replacement;
- switching owner/context invalidates the old generation.

No tool invocation may trust “last active Job”, “last drawing”, or “last workspace” global state.

---

## 5. Tool capability lease model

The important identity is not a globally unique display name for a tool. The important identity is a **runtime lease for each actual invocation**.

Shared implementation:

```text
write_file
set_layer
read_entity
...
```

Each call receives a lease owned by one exact execution.

### 5.1 ToolLease

```text
ToolLease
├── lease_id
├── provider_id = cadgpt
├── execution_id
├── owner_id
├── family
├── actual_tool
├── target_id
├── driver_epoch
├── generation
├── call_sequence
└── acquired_at
```

CadGPT lease ID follows the GPTWorker pattern but is provider-namespaced:

```text
tool:cadgpt:{family}@{ownerId}@{targetKey}:e{epoch}:g{generation}:c{sequence}
```

Examples:

```text
tool:cadgpt:filesystem@write-lisp@lisp-draft#82ac31:e7:g2:c11

tool:cadgpt:cad-layer@RVT2CAD@dwg_01:e7:g1:c18
```

GPTWorker may simultaneously have its own independent lease:

```text
tool:gptworker:filesystem@coding@repo#1a44ff:e9:g1:c37
```

The underlying Windows/filesystem capability is shared, but execution authority and scope are not.

### 5.2 Central wrapper

Do not implement lease checks separately in every tool.

Pattern:

```text
tool request
→ validate admission/work authority
→ acquireToolLease()
→ resolve target scope
→ execute handler
→ releaseToolLease()
```

The tool handler performs business work only.

### 5.3 What ToolLease solves

ToolLease prevents:

- Job A call being treated as Job B;
- one chat inheriting another chat's work context;
- CadGPT file work inheriting GPTWorker workspace state;
- CAD call inheriting a different drawing context;
- stale generation calls continuing after context replacement.

ToolLease does **not** by itself solve two processes modifying the exact same physical resource. Resource locking/version checks handle that separately.

---

## 6. FILE execution path

FILE work includes:

- generic managed reads/writes;
- `write-lisp`;
- `jobcreate`;
- Lisp/Job draft operations;
- validation;
- controlled promotion/import flows.

FILE work never needs CAD MCP unless a later workflow step explicitly enters CAD testing.

### 6.1 Lazy FILE capability families

Current static registration/import of all file/Lisp/Job modules must be replaced by lazy capability loading.

Internal families may include:

```text
filesystem
library
lisp-authoring
job-authoring
registry
```

They remain one conceptual FILE execution path.

On first use:

```text
ACTIVE admission
→ work registration
→ first FILE operation
→ dynamic import required family
→ cache family for current core lifetime
```

Unexpected families remain lazy fallback.

### 6.2 File scope

Do not rely on global process CWD as authority.

Resolved target path must be checked against the current execution scope and existing CadGPT path-safety rules.

### 6.3 Cross-provider concurrency

Acceptance scenario:

```text
Chat A → @cadgpt → write-lisp → file write
Chat B → @gptworker → coding → file write
```

Both may run at the same time because they have separate provider/work leases and scopes.

### 6.4 Same-file conflict

If two executions intentionally or accidentally target the same physical file, lease identity is not enough.

Mutation must use optimistic/resource conflict protection:

```text
read version/hash/mtime
→ prepare mutation
→ verify current version still matches
→ atomic write/replace
```

If it changed:

```text
FILE_CHANGED / RESOURCE_CONFLICT
```

Do not silently overwrite.

Existing rollback-safe permanent-library promotion behavior must remain intact.

---

## 7. File safety and managed AppData invariants

Generic readable roots remain:

```text
appdata/libraries/**
appdata/workspace/**
appdata/data/**
```

Generic writable roots remain:

```text
appdata/workspace/**
appdata/data/**
```

Permanent managed content:

```text
appdata/libraries/**
```

is still generic read-only.

Permanent changes are allowed only through controlled operations such as:

```text
library_import
lisp_promote_draft
job_promote_draft
```

A valid FILE ToolLease never bypasses these rules.

Runtime lease authority and managed-content governance are separate layers.

---

## 8. Capability Registry and system Skills

The existing ownership model stays:

```text
Internal Registry
├── MCP capabilities
└── system Skills

User Registry
├── managed Lisp capabilities
└── concrete Jobs
```

Primary user capability discovery remains registry-driven.

Do **not** add another persistent registry merely to store ToolLease IDs or execution IDs.

Lease/work registration is runtime state only.

Current critical system Skills remain:

```text
write-lisp
jobcreate
```

---

## 9. AutoLISP lifecycle

The current controlled lifecycle remains authoritative.

Existing Lisp:

```text
registry discovery
→ lisp_checkout
→ appdata/workspace/lisp-draft/**
→ edit/repair
→ lisp_draft_validate
→ explicitly approved CAD test
→ verified runtime result
→ user acceptance
→ lisp_promote_draft
```

New Lisp:

```text
lisp_scaffold
→ workspace draft
→ implement
→ validate
→ approved CAD test
→ runtime verification
→ promote
```

Source syntax errors may be checked out for repair.

Helper-only Lisp without public `c:` commands remains valid when intentional.

TBH Toolkit remains the explicit authoring-profile exception.

---

## 10. Job model

A Job remains a repeatable CAD workflow, not an autonomous local agent.

CadGPT does not adopt GPTWorker's compulsory Job+Workspace contract.

A user may perform direct CAD work after valid admission without selecting a concrete Job.

Concrete Jobs still define:

- goal;
- preconditions;
- ordered steps;
- explicit capability/executor scope;
- success criteria;
- failure handling;
- validation/evidence.

When a concrete Job is the work owner, `job_id` is recorded in the WorkRegistration and ToolLease.

When `write-lisp` or `jobcreate` is the owner, no fake Job ID is invented.

---

## 11. CAD execution path

CAD work includes:

- drawing discovery/binding;
- structured entity/layer/block/xref/property reads;
- mutation;
- command dispatch;
- AutoLISP load/run/test;
- Observator CAD capture/read operations.

CAD execution uses CAD MCP as the only AutoCAD backend.

No CAD MCP process starts merely because CadGPT was initialized or because FILE work is active.

```text
ACTIVE admission
→ CAD operation actually requested
→ detect supported AutoCAD host
→ lazy-load CAD family/manifest
→ activate/connect CAD MCP
→ acquire CAD ToolLease
→ execute against explicit drawing context
```

AutoCAD is never launched implicitly.

---

## 12. Multi-chat and multi-drawing model

The current implementation uses one `BoundDrawing` per `McpServer` through a WeakMap. This must be replaced.

Target model:

```text
CadGPT execution
├── drawing context A
├── drawing context B
└── drawing context C
```

### 12.1 DrawingContext

```text
DrawingContext
├── drawing_id
├── execution_id
├── name
├── full_name
├── host_id
├── runtime_document_identity
├── bound_at
└── availability state
```

`drawing_id` is an opaque CadGPT-generated ID. It is not just the filename.

Same filenames in different folders/hosts must remain distinct.

### 12.2 One execution may own multiple drawings

Example:

```text
Job RVT2CAD
├── dwg_01
├── dwg_02
└── dwg_03
```

Do not create one Job per drawing.

If an execution has exactly one drawing, it may use that as its default target.

If it has multiple drawing contexts, CAD business mutations must require explicit `drawing_id`.

Never guess.

### 12.3 Two chats, two Jobs, one CAD MCP tool

Required acceptance scenario:

```text
Chat 1
@cadgpt
Job A
Drawing 1
→ set_layer

Chat 2
@cadgpt
Job B
Drawing 2
→ set_layer
```

Both calls may use the same CAD MCP implementation but must have independent leases:

```text
tool:cadgpt:cad-layer@JobA@dwg_01:e5:g1:c12

tool:cadgpt:cad-layer@JobB@dwg_02:e5:g1:c4
```

No binding or Job state from one request may affect the other.

---

## 13. Eliminate ActiveDocument race

The target drawing cannot be authorized by ambient AutoCAD `ActiveDocument`.

Current pattern:

```text
set active document
→ execute business tool
```

is vulnerable if two requests interleave.

Required pattern:

```text
validated CAD ToolLease
→ resolve drawing_id
→ resolve host_id/runtime document
→ acquire host execution lock
→ activate/verify exact document
→ execute CAD MCP call
→ verify/result
→ release host lock
→ release ToolLease
```

ToolLease provides identity isolation.

The CAD scheduler/lock provides AutoCAD execution safety.

These are separate responsibilities.

---

## 14. CAD scheduler

Assume conservative safety until real AutoCAD validation proves more concurrency is safe.

Initial rule:

```text
one AutoCAD host
→ one serialized CAD execution queue for mutation-sensitive operations
```

Two drawings in the same AutoCAD host may have separate leases but physical operations serialize.

Architecture should retain `host_id` so future multiple AutoCAD hosts can have independent queues if Stage 2 proves that safe.

Multi-host parallelism is not required for the first refactor milestone.

---

## 15. CAD manifest and tool loading

Current `registerCadProxyTools()` eagerly reads the generated CAD tool manifest and registers all stable business descriptors whenever a CadGPT MCP server is created.

This is too eager for the new idle model.

Required change:

```text
idle/control plane
→ do not load CAD manifest/business modules

ACTIVE FILE work
→ do not load CAD manifest
→ CAD MCP stays off

first actual CAD capability need
→ load/cache CAD manifest
→ load CAD proxy/business family
→ connect CAD MCP only if execution needs it
```

Do not combine this phase with an unnecessary public API redesign unless measurements show the MCP descriptor surface itself is still a dominant cost.

First preserve compatibility where practical; isolate and lazy-load implementation before considering a generic `cad_execute` gateway.

---

## 16. Observator boundary

Observator remains an evidence/discovery subsystem, not a separate agent.

Existing capture design remains:

```text
capture start
→ collect ObjectAdded identities
→ finish resolves only those identities
→ remove erased/undone/nested results
→ return top-level type headers
```

Observator CAD activity must use the same admission, WorkRegistration, ToolLease, drawing context, and CAD scheduler rules as other CAD operations.

No special bypass.

---

## 17. Windows tray and startup

CadGPT should adopt GPTWorker's proven Windows desktop pattern.

### 17.1 Replace Scheduled Task startup

Current:

```text
Windows Scheduled Task
→ hidden wake-agent
```

Target:

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
→ cadgpt-tray.ps1
```

No admin elevation is required.

Setup must remove the old CadGPT Scheduled Task during migration so both mechanisms cannot run simultaneously.

### 17.2 Tray host

Use PowerShell STA + Windows Forms `NotifyIcon`, matching GPTWorker's source tray design.

Required behaviors:

- single-instance mutex, e.g. `Local\CadGPTTray`;
- custom CadGPT icon with Windows fallback;
- hidden launch;
- logs under CadGPT AppData/logs;
- ready marker for setup/doctor;
- low-frequency health update (target ~60 s);
- immediate refresh when tray menu opens;
- never kill an unknown process just because a configured port is occupied.

Minimal menu:

```text
Status: Ready | Working | CAD Connected | Degraded

Open diagnostics/logs
Restart CadGPT
----------------
Exit CadGPT
```

Do not put Job management in the tray. ChatGPT remains the main UI.

### 17.3 Tray-owned idle components

The tray owns/ensures only:

```text
slim CadGPT control/admission MCP
Secure MCP Tunnel
```

It must not bootstrap:

```text
heavy FILE families
CAD manifest/business modules
CAD MCP
```

---

## 18. Remove idle AutoCAD polling

Current wake-agent polls AutoCAD using `tasklist` at a short interval.

That is unnecessary while CadGPT is uninvoked.

Target idle behavior:

```text
no AutoCAD tasklist polling
no CAD MCP probing
no CAD manifest loading
```

When an admitted request actually enters CAD work:

```text
detect AutoCAD immediately
→ activate CAD runtime if available
```

While CAD work is active, use only the minimum monitoring needed for host-close/disconnect detection.

Tray health checks remain low-frequency and are not CAD polling.

---

## 19. Preload policy

CadGPT may use GPTWorker's “warm while waiting” idea only where CadGPT already has a real confirmation gate.

Examples:

- `write-lisp` after the user has selected/approved an authoring flow;
- `jobcreate` after its planning confirmation;
- a concrete Job with known executor families.

Rules:

- preload means module/code warmup only;
- preload never grants mutation authority;
- preload never auto-connects CAD MCP;
- changed owner/context invalidates stale preload generation;
- undeclared/unexpected family still lazy-loads on first real use.

Do not build a new universal Job nomination system for CadGPT.

---

## 20. Connection architecture

CadGPT continues to expose one ChatGPT plugin/MCP connection:

```text
ChatGPT
   ⇅
OpenAI Secure MCP Tunnel
   ⇅
CadGPT slim control/admission MCP
   ├── lazy FILE capability families
   └── lazy CAD capability family
          ↓
        CAD MCP
          ↓
       AutoCAD
```

Do not require separate ChatGPT connectors for file work, Jobs, or CAD MCP.

---

## 21. Installation contract

### setup.bat

One-time setup must eventually:

1. verify Windows + Node/Python requirements;
2. install locked dependencies;
3. initialize managed AppData;
4. generate/validate CAD manifest artifacts without forcing them into idle memory;
5. build CadGPT;
6. build isolated CAD MCP Python environment;
7. configure Secure MCP Tunnel;
8. remove legacy CadGPT Scheduled Task if present;
9. register CadGPT tray in HKCU Run;
10. start tray immediately;
11. wait for tray-ready + slim MCP + tunnel readiness;
12. run doctor/acceptance diagnostics.

### run.bat

Keep familiar control verbs:

```text
run.bat start
run.bat stop
run.bat restart
run.bat status
run.bat uninstall
```

Internally these now control the tray/slim runtime rather than a Scheduled Task.

### EXE-last rule

Do not package into an installer/EXE until this source/BAT/tray architecture passes real Windows + AutoCAD validation.

---

## 22. Implementation phases

### P0 — Baseline and invariants

- capture current startup memory and latency;
- capture current initialize/tools-list timing;
- record current CAD manifest tool count;
- add regression scaffolding before major refactor;
- freeze the explicit invariants in this plan.

### P1 — Admission handshake

Implement `cadgpt_admission` in the slim control plane.

Required result:

```text
current user turn has @cadgpt
→ ACTIVE/CONTROL

no @cadgpt
→ INACTIVE
→ stop CadGPT flow
```

Mint session-scoped admission token.

No contextual exception.

### P2 — Admission token enforcement

Require admission authority before:

- registry/Job/Skill discovery used for work;
- FILE discovery/work;
- drawing discovery/binding;
- CAD work;
- work registration.

CONTROL token may call only control allowlist.

Direct entry without admission is rejected.

### P3 — WorkRegistration and ToolLease

Port GPTWorker's proven runtime concepts:

- execution ID;
- opaque authority token;
- driver epoch;
- generation;
- call sequence;
- acquire/release ToolLease;
- stale handle rejection;
- idle cleanup.

Use general `owner_type/owner_id`, not a fake Job ID for every workflow.

### P4 — FILE path isolation

- lazy-load FILE families;
- bind each operation to its WorkRegistration;
- ensure paths come from execution scope, not global CWD authority;
- add file version/hash conflict detection;
- preserve controlled library promotion rules.

### P5 — DrawingContext registry

Replace one-binding-per-McpServer model with explicit execution-scoped drawing contexts.

- generate opaque `drawing_id`;
- support several drawings per execution;
- support separate chats/executions concurrently;
- invalidate only the closed/stale drawing context.

### P6 — CAD lease and scheduler

- acquire CAD ToolLease per invocation;
- resolve exact drawing + host from lease target;
- serialize mutation-sensitive calls per host;
- remove ambient ActiveDocument authority;
- preserve explicit drawing verification.

### P7 — Lazy CAD path

- remove eager CAD manifest/business registration from idle startup;
- load CAD family on actual CAD demand;
- connect CAD MCP only when CAD execution requires it;
- FILE work never wakes CAD MCP.

### P8 — Tray/startup migration

- add `cadgpt-tray.ps1`;
- add icon + tray-ready marker;
- add mutex;
- register HKCU Run;
- remove legacy Scheduled Task;
- adapt setup/run/doctor;
- low-frequency health checks.

### P9 — Idle optimization and telemetry

- remove idle AutoCAD `tasklist` polling;
- report loaded capability families;
- report active work/lease counts;
- measure RSS/heap/latency in idle, admitted FILE, admitted CAD states.

### P10 — Real acceptance and documentation cleanup

Run the full scenarios below before Stage 2 scope is frozen.

Update README/ROADMAP/doctor/acceptance only after behavior is implemented and tests pass.

---

## 23. Mandatory regression tests

### 23.1 Admission

```text
MCP initialize
→ heavy execution families remain unloaded

ChatGPT calls CadGPT without @cadgpt
→ cadgpt_admission = INACTIVE
→ no discovery
→ no core work
→ no CAD MCP

previous turn/chat contained @cadgpt
current user turn does not
→ INACTIVE

current exact user turn contains @cadgpt
→ ACTIVE/CONTROL as appropriate
```

Missing/forged/stale admission token must be rejected by downstream work tools.

CONTROL authority must not enter FILE/CAD execution.

### 23.2 Work/lease identity

```text
same capability + two executions
→ distinct lease IDs

same Job/Skill after generation replacement
→ old handle rejected

runtime restart
→ prior epoch rejected
```

### 23.3 CadGPT + GPTWorker FILE concurrency

```text
Chat A → @cadgpt → write-lisp → filesystem write
Chat B → @gptworker → coding → filesystem write
```

Verify:

- provider/work IDs remain distinct;
- CadGPT scope never becomes GPTWorker workspace;
- GPTWorker scope never becomes CadGPT draft scope;
- different-file writes may proceed independently;
- same-file conflicting write is detected rather than silently overwritten.

### 23.4 Two chats / two drawings / same CAD tool

```text
Chat A
@cadgpt
Job A
Drawing 1

Chat B
@cadgpt
Job B
Drawing 2

both invoke the same CAD MCP operation
```

Verify:

- distinct admission/work authority;
- distinct ToolLeases;
- correct drawing target for each;
- no ActiveDocument drift;
- no cross-Job state;
- same-host mutation is serialized safely.

### 23.5 Multi-drawing one execution

- one work execution binds drawing A + B;
- read calls can identify either explicitly;
- mutation requires explicit `drawing_id` when more than one is bound;
- closing drawing A does not silently retarget to B.

### 23.6 Lazy runtime

```text
Windows idle
→ tray ON
→ slim MCP ON
→ tunnel ON
→ FILE heavy modules unloaded
→ CAD modules unloaded
→ CAD MCP OFF

invalid/uninvoked CadGPT call
→ state unchanged

admitted FILE work
→ FILE family loads
→ CAD MCP remains OFF

admitted CAD work
→ CAD family loads
→ CAD MCP activates on demand

work ends / idle timeout
→ execution authority expires
→ heavy runtime can return to idle
→ tray/slim MCP/tunnel remain
```

### 23.7 Tray

- Windows logon creates exactly one CadGPT tray icon;
- second tray launch exits via mutex;
- old Scheduled Task is removed;
- status does not busy-poll;
- restart stops only verified CadGPT-owned processes;
- an unrelated process occupying a configured port is never killed.

---

## 24. Final acceptance demo before Stage 2

The refactor is not complete until this full demo works:

```text
WINDOWS LOGIN

CadGPT tray visible
slim CadGPT MCP ready
Secure MCP Tunnel ready
heavy FILE runtime unloaded
CAD MCP off
```

Then:

```text
Chat 1:
@cadgpt
Job A
Drawing A

Chat 2:
@cadgpt
Job B
Drawing B

→ both invoke the same CAD operation near-simultaneously
→ independent work/tool leases
→ correct drawings
→ no conflict
```

At the same time:

```text
Chat 3:
@gptworker
coding on Repo X

Chat 1:
CadGPT write-lisp

→ both use filesystem capabilities
→ separate provider/execution scopes
→ no workspace/path leakage
```

And:

```text
Chat 4:
user does NOT write @cadgpt
ChatGPT nevertheless considers/calls CadGPT

→ cadgpt_admission returns INACTIVE
→ internal instruction: stop CadGPT flow
→ no side effect
→ ChatGPT continues normally or with the requested provider
```

Only after these scenarios pass may the runtime-isolation refactor be considered complete.

---

## 25. Stage 2 entry condition

Stage 2 begins only after:

- admission gate is server-enforced;
- no downstream work path bypasses admission;
- WorkRegistration + ToolLease isolation is tested;
- multi-chat/multi-drawing targeting is safe;
- CAD scheduler prevents ActiveDocument races;
- FILE and CAD execution paths are lazy and independent;
- Windows tray/startup migration is stable;
- managed library authoring integrity remains intact;
- CI/regression tests pass.

Stage 2 then validates the architecture against real Windows + AutoCAD behavior.

No static test or documentation claim is a substitute for real AutoCAD validation.
