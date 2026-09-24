# CadGPT — Ship Implementation Plan

Status: **Ship-focused implementation plan**  
Repository: `thebimhouseinfo-sudo/Cadgpt`  
Current architecture: **admission + WorkRegistration + ToolLease + lazy FILE/CAD runtime + development-only CAD MCP self-improve already implemented at source level**  
Remaining objective: **close real-AutoCAD gaps, add deterministic Lisp load-check loop, harden release/runtime packaging, then ship a production build with development-only self-improve removed**

This file is the current implementation authority for taking CadGPT from the current development state to a shippable product. Completed CAD-Agent migration scaffolding is intentionally not part of the active repository contract.

---

## 0. Product definition

CadGPT is a thin local execution/orchestration layer that lets ChatGPT work with AutoCAD and CadGPT-managed files.

```text
ChatGPT
   ⇅
OpenAI Secure MCP Tunnel
   ⇅
CadGPT slim control/admission plane
   ↓
WorkRegistration + ToolLease
   ├── FILE path
   │    ├── managed file work
   │    ├── write-lisp
   │    └── Job authoring
   └── CAD path
        └── CAD MCP
             ↓
          AutoCAD
```

CadGPT does not provide:

- another chat UI;
- a local AI model;
- a general-purpose autonomous coding agent;
- a replacement for GPTWorker;
- implicit AutoCAD startup.

ChatGPT remains the reasoning surface. CadGPT provides controlled local execution.

---

## 1. Ship invariants

These rules are release blockers. A production build must not violate them.

### 1.1 Explicit invocation

CadGPT is explicit-invocation only.

```text
explicit invocation in the exact current user turn:
- literal @cadgpt, or
- user-selected CadGPT plugin/icon
→ admission may become ACTIVE/CONTROL

neither current-turn invocation source present
→ INACTIVE
→ no CadGPT work
```

Memory, prior turns, CAD-looking tasks, open drawings, file extensions, local paths, or ChatGPT routing decisions are not invocation authority.

### 1.2 Authority is runtime-scoped

Persistent state never grants execution authority.

```text
admission token
→ WorkRegistration
→ opaque authority token
→ per-call ToolLease
```

Runtime restart, work replacement, expiry, explicit stop, or session teardown invalidates stale authority.

### 1.3 Absolute-path mutation

Every source/file mutation must use an explicit absolute path.

Required sequence:

```text
absolute target
→ canonicalize
→ real-path/nearest-existing-ancestor resolution
→ allowed-root proof
→ reject symlink/junction escape
→ acquire resource/tool protection
→ mutate
```

Relative paths, ambient CWD, fallback path guessing, `..` escape, and similarly named external files are forbidden.

### 1.4 FILE and CAD authority remain separate

A FILE-capable execution does not automatically receive CAD authority.

A CAD-capable execution does not automatically receive generic FILE mutation authority.

Hybrid workflows may use both paths, but each tool call still validates its own family/scope.

### 1.5 No ambient ActiveDocument authority

The currently visible/active AutoCAD document is never treated as the target merely because it is active.

Every CAD mutation must resolve an explicit execution-owned drawing context.

### 1.6 Production cannot self-modify

Production/package builds must not expose CAD MCP source mutation.

The development-only `cad-mcp-dev` Skill and its write/rollback/candidate tools must be absent from the production capability surface.

---

## 2. Idle/runtime lifecycle

Windows idle state should remain small:

```text
Windows sign-in
├── CadGPT tray
├── slim CadGPT MCP admission/control plane
└── OpenAI Secure MCP Tunnel

heavy FILE families = unloaded
CAD family = unloaded
CAD MCP = off
AutoCAD polling = off
```

Generic MCP initialize/tool discovery must not wake CAD MCP.

Runtime activation:

```text
@cadgpt
→ admission
→ WorkRegistration
→ first required capability
→ lazy-load only that capability family
```

CAD MCP starts only when an admitted CAD operation actually requires it.

When CAD work ends and no valid execution still needs CAD, the CAD MCP child may shut down while tray/control plane/tunnel remain alive.

---

## 3. Admission / WorkRegistration / ToolLease

The implemented authority model remains the product core.

### 3.1 Admission

`cadgpt_admission(current_user_turn, invocation_source)` returns:

- `INACTIVE`
- `CONTROL`
- `ACTIVE + admission_token`

Downstream work must not bypass admission.

### 3.2 WorkRegistration

Each work execution records at least:

```text
execution_id
authority_token
admission/session identity
owner_type
owner_id
execution_path
driver_epoch
generation
created_at
last_activity_at
```

Valid owners include:

```text
skill:write-lisp
skill:jobcreate
skill:cad-mcp-dev        # development only
job:<job-id>
direct-cad
```

Do not invent fake Job IDs for Skill/direct work.

### 3.3 ToolLease

Every actual capability invocation gets a per-call lease.

ToolLease must bind:

```text
provider
execution
family
actual tool
target/resource
epoch
generation
call sequence
```

A ToolLease does not bypass resource conflict checks.

---

## 4. Managed AppData and registry ownership

Managed roots remain:

```text
<appdata>/
├── libraries/
│   ├── lisp/
│   └── jobs/
├── registry/
│   └── user/
├── workspace/
│   ├── lisp-draft/
│   └── job-draft/
├── runtime/
│   └── dynamic-lisp/
├── drawings/
├── data/
├── state/
└── logs/
```

External Lisp/Job folders are import sources only.

```text
external user folder (read-only import source)
→ controlled import
→ managed AppData copy
→ User Registry
```

CadGPT must not write back to the external original.

Registry ownership remains:

```text
Internal Registry
├── MCP tools
└── system Skills

User Registry
├── Lisp capabilities
└── concrete Jobs
```

User content cannot overwrite internal tools/Skills.

---

## 5. AutoLISP / Visual LISP coder — ship workflow

The LISP coder must remain specialized and lightweight.

Its primary reliability problem is not a full software-engineering lifecycle; it is that AutoLISP/Visual LISP files frequently look valid but fail when AutoCAD actually loads them.

Therefore the mandatory ship workflow is:

```text
WRITE / PATCH
→ STATIC CHECK
→ LOAD INTO THE SAME AUTOCAD WINDOW
→ PASS ?
   ├── no → return exact AutoCAD load error → patch → reload
   └── yes → continue / complete
```

### 5.1 Scope

`write-lisp` is only for AutoLISP/Visual LISP used by AutoCAD.

It is not a generic Lisp/Common Lisp coding agent.

### 5.2 Static validation

Keep the existing static harness for:

- balanced parentheses/strings;
- obvious AutoLISP/Visual LISP syntax errors;
- Common-Lisp-only constructs;
- public `c:` command discovery;
- required authoring metadata/profile rules;
- obvious COM initialization/safety warnings.

Static PASS is necessary but not sufficient.

### 5.3 Deterministic AutoCAD load-check

Add a small fixed internal load-check mechanism.

The agent must not invent a new test script for each Lisp file.

Required internal operation:

```text
lisp_load_check(
  execution authority,
  drawing_id,
  absolute_file_path
)
```

Behavior:

1. require an already bound/approved AutoCAD drawing/window;
2. require an absolute canonical Lisp path in an allowed Lisp root;
3. use the existing CAD MCP/AutoLISP loading mechanism;
4. load the file into the exact AutoCAD host/window that owns the bound drawing;
5. synchronously determine success/failure;
6. return the exact load result/error to `write-lisp`.

Typical failures to surface include:

```text
malformed list on input
extra right paren on input
bad argument type
no function definition
quit / exit abort
missing dependency during load
Visual LISP/COM initialization failure
```

A queued `SendCommand` without verified completion is not PASS.

### 5.4 Same-window rule

Do not open a second AutoCAD instance just to test Lisp syntax/load.

The load check must use the exact AutoCAD host/drawing context already selected for the work.

This guarantees that the test uses the same environment, loaded dependencies, support paths, and application state that the user will actually use.

### 5.5 Minimal fix loop

If load fails:

```text
exact load error
→ narrow patch
→ static check
→ load same file again into same AutoCAD host
→ repeat until PASS or a non-source/environment dependency blocks progress
```

Do not automatically expand this into a large functional QA loop.

### 5.6 Completion levels

For normal Lisp authoring:

```text
STATIC PASS
+
LOAD PASS
= source/load reliability gate passed
```

A functional command test is required only when:

- the requested task explicitly requires behavioral verification;
- a concrete Job requires postconditions;
- the change affects runtime behavior that cannot be validated from load alone.

For interactive commands, after static + load PASS CadGPT may hand the command to the user for manual interaction instead of inventing selections/points/dialog input.

### 5.7 Promotion

Reusable Lisp may be promoted only after the required gates for that task pass.

For the normal lightweight case:

```text
draft
→ static PASS
→ same-window load PASS
→ user acceptance / task-specific functional test when required
→ promote managed copy
→ sync User Registry
```

---

## 6. Drawing context and CAD scheduler

Each CAD-capable execution owns explicit drawing contexts.

```text
DrawingContext
├── drawing_id
├── execution_id
├── host_id
├── name/full_name
├── runtime document identity
├── bound_at
└── availability
```

`drawing_id` must survive filename ambiguity and distinguish reopened documents.

If one execution owns multiple drawings, mutating operations must require explicit `drawing_id`.

Required CAD call sequence:

```text
validate work authority
→ acquire CAD ToolLease
→ resolve drawing_id
→ resolve exact host/document
→ acquire host scheduler lock
→ activate/verify exact document if needed
→ execute
→ capture result
→ release host lock
→ release ToolLease
```

Initial safe scheduler policy:

```text
one AutoCAD host
→ one serialized mutation-sensitive queue
```

Concurrency can be relaxed only after real AutoCAD evidence proves it safe.

---

## 7. Development-only CAD MCP self-improve module

CadGPT includes a development-only self-improve capability:

```text
skill:cad-mcp-dev
```

This module must be treated as a complete but tightly sandboxed coding workflow, not as generic repository authority.

### 7.1 Purpose

`cad-mcp-dev` may:

- inspect CAD MCP runtime code;
- repair an existing CAD MCP tool;
- add a new CAD MCP tool;
- update tool schema/description;
- run runtime-local validation;
- regenerate the CAD MCP tool manifest;
- validate the changed tool against live AutoCAD when necessary;
- rollback an unaccepted/broken candidate.

### 7.2 Hard write boundary

The only writable source tree is:

```text
<repo>\runtimes\cad-mcp\**
```

Every mutation requires an absolute canonical path inside that root.

Read-only supporting context may include CadGPT core contracts, docs, Skill rules, and manifest generator inputs needed to understand the runtime boundary.

If the correct implementation requires changing CadGPT core outside the runtime root, return:

```text
OUT_OF_SCOPE_CORE_CHANGE
```

Do not widen the source write boundary.

### 7.3 No Git workflow

Self-improve is local development only.

It performs:

```text
no branch
no git add
no commit
no push
no PR
no Git rollback
```

Rollback uses its own baseline/snapshot mechanism.

### 7.4 No unrestricted shell

Do not expose generic PowerShell/cmd/bash authority.

Use scoped named operations for:

- read/search;
- create/edit/delete/move inside runtime root;
- Python compile/import validation;
- runtime tests;
- dependency-lock validation;
- manifest generation;
- candidate runtime lifecycle.

### 7.5 Crash-safe baseline

Before the first source mutation:

```text
recovery status
→ resolve any pending foreign/old recovery
→ create immutable baseline snapshot
→ begin source mutation
```

If CadGPT/Windows exits before acceptance, the next `cad-mcp-dev` session must recover or explicitly resolve the pending baseline before new mutation.

Only one active CAD MCP source-development execution is allowed.

Within it, only one self-improve mutation/validation ToolLease runs at a time.

### 7.6 Self-improve loop

Required loop:

```text
DISCOVER / REPRODUCE
→ PLAN
→ USER CONFIRMS IMPLEMENTATION
→ SNAPSHOT
→ EDIT RUNTIME SOURCE
→ VALIDATE
→ if failure: FIX → VALIDATE again
→ if schema/tool changed: REGENERATE MANIFEST
→ VERIFY EFFECTIVE CADGPT TOOL SURFACE
→ live CAD candidate only when needed
→ ACCEPT or ROLLBACK
```

### 7.7 Validation gate

Source validation must include the applicable parts of:

- Python syntax/compile;
- import validation;
- runtime-local tests;
- exact dependency-lock validation;
- tool-manifest generation/consistency;
- public CadGPT tool-surface validation.

Passing only one compile command is not enough.

### 7.8 Internal Registry update exception

CAD MCP tool source remains authoritative.

For tool additions/removals/schema changes:

```text
runtimes/cad-mcp/tools/**/*_tools.py
        ↓
manifest generator
        ↓
runtimes/cad-mcp/tool-manifest.json
        ↓
effective CadGPT Internal Registry/tool surface
```

`cad-mcp-dev` may regenerate/write the CAD-MCP-owned generated manifest artifact.

It may not edit:

- CadGPT core registry implementation;
- User Registry;
- unrelated Skills;
- repository-root application code.

### 7.9 Live candidate validation

Use live AutoCAD only when static/runtime validation cannot prove the change.

Live candidate flow:

```text
validated source
→ candidate generation
→ explicitly approved drawing context
→ normal CadGPT CAD tool path
→ same drawing/host authority rules
→ at least one successful changed-behavior tool call
→ candidate accept
```

A tool merely appearing in the manifest is not proof that it works.

Required proof chain for changed/new tools:

```text
source
→ manifest
→ CadGPT public surface
→ callable tool
→ CAD MCP execution
→ AutoCAD result
```

Candidate failure:

```text
candidate FAIL
→ rollback source to baseline
→ preserve slim CadGPT control plane
→ do not corrupt unrelated Job/drawing state
```

### 7.10 Dependency changes

The Skill may edit exact dependency declaration/lock files only when they live under `runtimes/cad-mcp/**`.

It must not install packages or mutate `.venv-cad/**`.

Environment installation/rebuild belongs to setup/maintainer authority outside self-improve.

### 7.11 Production exclusion

Production builds must fail closed if any of the following is still exposed:

```text
cad-mcp-dev Skill
cad_mcp_dev_* tools
runtime source-write authority
candidate source mutation tools
recovery/snapshot authoring surface
development coding runner
```

Runtime binaries/resources needed for normal CAD operation may remain.

Source self-improvement capability must not.

---

## 8. Tray, startup and diagnostics

Use the current tray architecture as the shipping desktop lifecycle.

Startup:

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
→ CadGPT tray
→ slim MCP
→ Secure MCP Tunnel
```

Requirements:

- current-user installation; no admin requirement for normal startup;
- single-instance mutex;
- verified ownership before stopping/restarting child processes;
- tray-ready marker;
- low-frequency health check;
- immediate health refresh when tray menu opens;
- logs under managed AppData;
- no busy AutoCAD polling;
- never kill an unrelated process merely because it occupies a configured port.

Minimal tray surface:

```text
Status
Open diagnostics/logs
Restart CadGPT
Exit CadGPT
```

ChatGPT remains the normal UI.

---

## 9. Setup and release layout

### 9.1 Development/source setup

Source setup must:

1. validate supported Windows environment;
2. install locked Node dependencies;
3. build CadGPT TypeScript;
4. create/validate isolated CAD MCP Python environment;
5. generate/validate CAD tool manifest;
6. initialize managed AppData;
7. configure Secure MCP Tunnel;
8. register tray auto-start;
9. start tray/slim MCP/tunnel;
10. run doctor;
11. leave CAD MCP off until demanded.

### 9.2 Production runtime rule

A packaged production installation ships prebuilt application/runtime artifacts.

It must not automatically rebuild CadGPT source on the user's machine.

Production should behave as:

```text
installed build
→ validate runtime files/config
→ run
```

not:

```text
installed build
→ detect source
→ npm/tsc rebuild on user machine
```

### 9.3 Release integrity

External downloaded runtime dependencies/install artifacts should be verified before execution where practical:

```text
download
→ existence/size sanity
→ format/signature sanity
→ hash/version verification
→ install/extract
```

### 9.4 AppData move

Before shipping, default managed data should resolve to a per-user location such as:

```text
%LOCALAPPDATA%\CadGPT
```

The repo-local `appdata` layout remains a development convenience, not the final product data location.

---

## 10. Implementation phases to ship

### S0 — Current-state verification

Do not re-implement already completed architecture.

Verify current main contains and tests:

- server-side explicit current-turn admission from literal `@cadgpt` or CadGPT plugin/icon invocation;
- admission token enforcement;
- WorkRegistration;
- ToolLease;
- absolute canonical mutation boundary;
- FILE/CAD execution-path isolation;
- drawing-context model;
- host scheduler;
- lazy CAD MCP;
- tray startup;
- development-only `cad-mcp-dev`;
- self-improve baseline/candidate/rollback;
- manifest regeneration.

Fix regressions first.

### S1 — Deterministic Lisp load-check

Implement the missing lightweight reliability gate:

- add a fixed internal `lisp_load_check` path or formalize the existing verified load tool as that contract;
- bind it to explicit `drawing_id` / host;
- accept only absolute canonical Lisp files from approved Lisp roots;
- return synchronous verified success/failure;
- preserve exact AutoCAD load error;
- integrate into `write-lisp`:
  `static → load same window → fix/reload loop`;
- do not require full functional execution for every Lisp file.

Acceptance:

```text
valid file
→ STATIC PASS
→ LOAD PASS

syntax-broken file
→ static or AutoCAD load failure
→ patch
→ reload same host
→ PASS

file loads with environment/dependency error
→ exact blocker reported
→ not mislabeled syntax PASS
```

### S2 — Real AutoCAD runtime acceptance

Run real Windows + AutoCAD tests for:

- drawing discovery/bind/rebind;
- stale drawing after close/reopen;
- two chats / two drawings / same CAD tool;
- one execution / multiple drawings;
- host scheduler serialization;
- no ActiveDocument drift;
- verified Lisp load in the same AutoCAD window;
- CAD MCP sleep/wake/reconnect;
- AutoCAD-close behavior.

No static/CI simulation substitutes for this phase.

### S3 — Self-improve acceptance

Test `cad-mcp-dev` as a real development workflow:

1. repair one existing CAD MCP tool;
2. add or alter one tool schema;
3. regenerate manifest;
4. verify effective CadGPT public tool surface;
5. start candidate;
6. call changed tool against an explicitly approved drawing;
7. accept successful candidate;
8. separately force a broken candidate and verify rollback;
9. restart CadGPT/Windows with pending recovery and verify recovery gate;
10. verify every attempted write outside `runtimes/cad-mcp/**` is rejected.

### S4 — FILE/Lisp/Job governance acceptance

Verify:

- external import source remains read-only;
- managed library is generic read-only;
- draft editing uses absolute paths;
- same-file conflict is detected;
- Lisp checkout/repair/promote works;
- lightweight static + load gate works;
- helper-only Lisp remains valid;
- Job authoring/promotion remains rollback-safe;
- User Registry cannot overwrite Internal Registry.

### S5 — Production-profile strip

Create an explicit production build gate.

Production profile must prove:

```text
cad-mcp-dev not registered
cad_mcp_dev_* not listed
runtime source mutation unavailable
development recovery/candidate authoring unavailable
normal CAD tools still available
write-lisp still available
Job runtime still available
```

This is a mandatory automated test.

### S6 — Installer / packaged runtime

Only after S0–S5 pass:

- set production AppData default to `%LOCALAPPDATA%\CadGPT`;
- package prebuilt CadGPT runtime;
- package or install the required normal CAD MCP runtime;
- configure Secure MCP Tunnel;
- register HKCU tray startup;
- add uninstall/repair behavior;
- preserve user-managed AppData unless the user explicitly chooses data removal;
- ensure install/uninstall never deletes arbitrary external Lisp/Job source folders.

### S7 — Release CI

Release CI must run at least:

```text
npm ci
→ build
→ unit/regression tests
→ manifest validation
→ production capability-strip test
→ packaging test
→ installer artifact
```

Development-only tests may run against `CADGPT_BUILD_PROFILE=development`.

Production artifact validation must run against production profile.

### S8 — Fresh-machine acceptance

Test the installer on a clean Windows user profile.

Required proof:

```text
install
→ restart/sign-in
→ one CadGPT tray
→ slim MCP ready
→ tunnel ready
→ `@cadgpt` and CadGPT plugin/icon admission both work
→ CAD remains lazy
→ open AutoCAD manually
→ bind drawing
→ perform safe CAD read
→ write/load a small Lisp
→ restart CadGPT
→ reconnect without stale authority
→ uninstall/repair works
```

Do not use the developer machine as the only release proof.

---

## 11. Mandatory regression matrix

### Admission

- literal `@cadgpt` in the current turn → admitted;
- explicit CadGPT plugin/icon invocation in the current turn → admitted even without `@cadgpt` text;
- neither current-turn source present → INACTIVE;
- previous-turn `@cadgpt` or plugin invocation does not carry forward → INACTIVE;
- CONTROL cannot mutate FILE/CAD;
- stale/forged admission token rejected.

### Work/ToolLease

- same tool + two executions → distinct leases;
- old generation rejected after replacement;
- old epoch rejected after runtime restart;
- active ToolLease blocks unsafe stop/replace.

### Absolute path

For write-lisp, Job authoring, write-skill when present, and self-improve:

- relative mutation rejected;
- `..` escape rejected;
- symlink/junction escape rejected;
- process CWD cannot redirect target;
- canonical in-root absolute path succeeds.

### Lisp load

- static-valid + AutoCAD-valid Lisp → LOAD PASS;
- malformed file → FAIL with real load evidence;
- patch/reload uses the same host/window;
- queued command without verified result is never PASS;
- no automatic second AutoCAD instance.

### Multi-drawing

- two chats + same CAD tool + two drawings remain isolated;
- multiple drawings in one execution require explicit mutation target;
- close/reopen invalidates stale document identity.

### Lazy runtime

- idle → CAD MCP off;
- FILE-only work → CAD MCP off;
- actual CAD operation → CAD MCP on demand;
- idle/stop → work authority expires and CAD backend may stop.

### Self-improve

- one source-development owner at a time;
- one self-improve ToolLease at a time;
- source writes only under runtime root;
- no unrestricted shell;
- no Git workflow;
- snapshot before mutation;
- crash recovery enforced;
- compile/import/tests run;
- manifest regenerated when applicable;
- public surface verified;
- successful live candidate evidence required when candidate path is used;
- failed candidate rolls back;
- production profile exposes none of it.

### Tray/process ownership

- one tray instance;
- verified process ownership before stop/restart;
- unrelated process on configured port is not killed;
- no short-interval AutoCAD polling.

---

## 12. Ship blockers

CadGPT is not shippable while any of these remain true:

- Lisp authoring can claim success without a verified AutoCAD load;
- load test may run in a different/uncontrolled AutoCAD instance;
- drawing target can drift through ambient ActiveDocument;
- any mutation can use relative/CWD-derived authority;
- stale WorkRegistration/ToolLease can survive generation/runtime replacement;
- CAD MCP self-improve can write outside its runtime root;
- self-improve is present in production capability discovery;
- production install rebuilds development source implicitly;
- packaged AppData writes into the source repo by default;
- installer/startup can kill an unrelated process;
- release has not been tested on real AutoCAD and a fresh Windows profile.

---

## 13. Definition of Done — production ship

The product is ready to ship only when all of the following are true.

### Core

- explicit current-turn admission from `@cadgpt` or CadGPT plugin/icon is enforced server-side;
- WorkRegistration and ToolLease isolation pass regression tests;
- FILE/CAD paths remain separated;
- stale authority is rejected.

### CAD

- real AutoCAD drawing binding/rebinding works;
- multi-chat/multi-drawing test passes;
- scheduler prevents drawing-target race;
- CAD MCP starts only on demand and recovers cleanly.

### Lisp

- static validation works;
- fixed same-window AutoCAD load-check works;
- syntax/load failure produces actionable error;
- patch/reload loop reaches verified PASS;
- full command behavior is tested only when task requirements need it.

### Self-improve

- development-only `cad-mcp-dev` can repair/add a CAD MCP tool;
- source write boundary is proven;
- baseline/recovery/rollback work;
- manifest + effective public tool surface are verified;
- live changed behavior can be proven on an approved drawing;
- production build strips the entire development capability.

### Packaging

- production uses per-user AppData;
- installed runtime is prebuilt;
- tray auto-start is stable;
- setup/doctor/uninstall/repair work;
- release CI produces a reproducible installer;
- fresh-machine Windows + real-AutoCAD acceptance passes.

Only after these gates pass should CadGPT be labeled a production release.
