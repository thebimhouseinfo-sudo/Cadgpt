# CadGPT — Current Implementation Plan

Status: **Stage 1 complete; Beta Scope Review in progress**  
Repository: `thebimhouseinfo-sudo/Cadgpt`  
Real-AutoCAD validation: **Stage 2, not yet claimed**

This file is the current implementation authority. Historical migration details belong in `MIGRATION_PLAN.md` / `MIGRATION_MATRIX.md`; old CAD-Agent layout assumptions are not architectural requirements.

---

## 1. Product boundary

CadGPT is a **thin local execution/orchestration layer that lets ChatGPT work directly with AutoCAD**.

CadGPT does not provide:

- a separate chat UI;
- a local AI/model runtime;
- model-provider abstraction;
- Chat/Observer/Operator personas;
- a general-purpose coding shell;
- a second autonomous local reasoning agent.

ChatGPT remains the reasoning/chat surface.

```text
ChatGPT
   ⇅
OpenAI Secure MCP Tunnel
   ⇅
CadGPT MCP endpoint
   ├── managed file tools
   ├── registry/library tools
   ├── Jobs + system Skills
   └── CAD proxy tools
          ↓
        CAD MCP
          ↓
       AutoCAD
```

CAD MCP is the only active CAD runtime. AutoCAD is never launched implicitly by CadGPT.

---

## 2. Runtime/lifecycle model

CadGPT behaves like a lightweight per-user driver.

### Installed state

One-time `setup.bat` installs/configures:

- locked Node/Python dependencies;
- stable CAD tool manifest;
- managed AppData layout;
- OpenAI Secure MCP Tunnel profile;
- hidden per-user wake-agent Scheduled Task;
- diagnostics/acceptance prerequisites.

### Normal Windows logon

```text
Windows logon
→ tiny hidden wake-agent
→ Secure MCP Tunnel/listener available
→ full CadGPT core still asleep
```

### ChatGPT activation

```text
first ChatGPT MCP call
→ wake full CadGPT core
→ expose stable tool descriptors
```

CAD MCP runs only when both conditions are true:

1. CadGPT has been activated by ChatGPT;
2. `acad.exe` / supported AutoCAD host is available.

AutoCAD starting by itself does not wake full CadGPT.

`run.bat` is a control shim, not a daily launcher:

```text
run.bat install
run.bat start
run.bat stop
run.bat restart
run.bat status
run.bat uninstall
```

Normal daily use should require no command after setup.

---

## 3. Managed AppData is the user-asset boundary

Beta default:

```text
<repo>/appdata
```

Packaged target:

```text
%LOCALAPPDATA%\CadGPT
```

selected through `CADGPT_APPDATA_ROOT` while preserving the same virtual paths.

Canonical layout:

```text
appdata/
├── libraries/
│   ├── lisp/                 permanent managed Lisp libraries
│   └── jobs/                 permanent managed Job libraries
├── registry/
│   └── user/                 User Registry + library manifest
├── workspace/
│   ├── lisp-draft/           write-lisp working copies
│   └── job-draft/            jobcreate working copies
├── runtime/
│   └── dynamic-lisp/         temporary bounded runtime variants
├── drawings/                 drawing-scoped Observator/semantic data
├── data/
│   └── runs/                 persistent run/test evidence
├── state/                    internal process/session state
└── logs/                     diagnostics
```

The repository's Beta `appdata/libraries/**` and `appdata/registry/user/**` may contain committed fixtures representing an already-imported environment. Other runtime/generated areas remain non-authoritative generated state.

---

## 4. External user folders are import sources only

A user-selected Lisp or Job folder is never a normal editable workspace.

```text
explicitly approved external source folder
        ↓ read only
library_import
        ↓
managed copy in appdata/libraries/**
        ↓
User Registry indexing
```

Rules:

- `source_path` must be an explicitly user-approved absolute directory;
- CadGPT never writes back to that source;
- symlink source entries are rejected;
- `.git` / `.svn` metadata is excluded from the managed copy;
- import file-count and byte-size bounds are enforced;
- replacement import is rollback-safe across managed content, library manifest and User Registry;
- re-import is explicit, never background synchronization.

After import, CadGPT reads/executes the managed copy, not the external source.

---

## 5. File safety model

Generic file tools are intentionally asymmetric.

### Generic readable roots

```text
appdata/libraries/**
appdata/workspace/**
appdata/data/**
```

### Generic writable roots

```text
appdata/workspace/**
appdata/data/**
```

### Permanent library rule

```text
appdata/libraries/** = generic read-only
```

Permanent library mutation is allowed only through controlled operations that keep implementation and registry state synchronized:

```text
library_import
lisp_promote_draft
job_promote_draft
```

Generic `file_create` / `file_edit` must never be able to bypass these lifecycles.

`appdata/registry/**`, `runtime/**`, `state/**`, `logs/**` remain internal and are not generic file roots.

---

## 6. Capability Registry

CadGPT presents one effective discovery view with disjoint ownership.

```text
Internal Registry
├── MCP tools
└── system Skills

User Registry
├── managed Lisp capabilities
└── managed concrete Jobs
```

Primary discovery tools:

```text
registry_list
registry_get
```

Ownership rules:

- User Registry may contain only `lisp` and `job` entries;
- Internal Registry is generated from CadGPT tools/Skills;
- User capability IDs are unique within User Registry;
- Lisp promotion cannot replace a Job ID and Job promotion cannot replace a Lisp ID;
- permanent promoted capabilities must point to an existing enabled managed library.

### Implementation freshness

Imported Lisp/Job implementation content is hash-tracked.

When re-import changes implementation bytes:

```text
previous curated semantics
        ↓ implementation hash changed
semantic_status = needs_review
risk/safety claims = no longer trusted as curated facts
```

CadGPT must not silently preserve old `mutates_drawing`, `destructive`, `effects`, or equivalent behavior claims as trusted metadata after implementation changes.

---

## 7. System Skills

System Skills are internal read-only expert capabilities under:

```text
skills/**
```

They are not user libraries and are not generic writable content.

Current critical Skills:

```text
write-lisp
jobcreate
```

A Skill constrains ChatGPT reasoning/workflow for a specialized task. It is not another AI agent or local model.

---

## 8. AutoLISP model

Managed Lisp remains ordinary AutoLISP/Visual LISP usable directly from AutoCAD commands and discoverable by CadGPT.

### 8.1 Import/index

Import does not rewrite source headers or implementation.

Unreviewed imported Lisp must not be represented as known-safe merely because indexing succeeded. Unknown semantic/safety properties remain unknown until curated.

### 8.2 `write-lisp` lifecycle

Existing capability:

```text
registry discovery
→ lisp_checkout
→ appdata/workspace/lisp-draft/**
→ edit/repair
→ lisp_draft_validate
→ explicitly approved CAD test context
→ verified load/runtime verification
→ user-accepted result
→ lisp_promote_draft
→ permanent managed Lisp + User Registry
```

New capability:

```text
lisp_scaffold
→ create under appdata/workspace/lisp-draft/**
→ implement
→ lisp_draft_validate
→ approved CAD test
→ verified runtime behavior
→ lisp_promote_draft
```

### 8.3 Repair rule

A managed Lisp source may contain syntax/blocking errors. That is precisely a valid `write-lisp` repair case.

Therefore:

- `lisp_checkout` reports source diagnostics;
- source errors do **not** block checkout into the draft workspace;
- promotion remains strict and is blocked until the draft passes validation.

### 8.4 Helper Lisp rule

A Lisp file without a public `c:` command may be an intentional helper/library module.

- validator may report no public command as informational/warning;
- helper-only files may be promoted;
- absence of `c:` must not itself make promotion impossible.

### 8.5 Authoring profiles

Default:

```text
CadGPT canonical header/profile
```

Explicit compatibility exception:

```text
library_id=tbh-toolkit → TBH header/profile
```

### 8.6 Dynamic AI mode

`ai_mode=dynamic` is metadata permitting bounded temporary derivation from normal AutoLISP using registry-declared `dynamic_parameters`.

It is not another source type and does not authorize permanent source mutation outside the normal draft/promote lifecycle.

---

## 9. Job semantic model

A **Job** is a small, repeatable CAD workflow / unit of work.

A Job is not:

- a chat session;
- a persona;
- an autonomous AI agent;
- a fixed wrapper around one tool.

A Job defines:

- identity and goal;
- preconditions;
- ordered steps;
- per-step instruction;
- step inputs and expected output/postcondition;
- explicit tool/executor scope;
- preferred and viable executors where useful;
- success criteria;
- failure handling;
- mutation scope;
- required evidence;
- final validation.

Canonical rules live in:

```text
knowledge/jobs/JOB_RULES.md
```

Concrete reusable Jobs are user assets in managed Job libraries.

---

## 10. Job execution model

Current Beta does **not** introduce another autonomous local Job agent.

ChatGPT remains the reasoning/sequencing layer. CadGPT provides:

- Job discovery/loading;
- explicit per-step capability contracts;
- drawing/session binding;
- constrained execution tools;
- validation/evidence surfaces;
- controlled Job authoring/promotion.

Conceptual execution:

```text
ChatGPT selects/loads Job
→ follows ordered Job step contract
→ uses only suitable declared capabilities
→ checks step success/postcondition
→ handles explicit failure rule
→ continues
→ verifies final Job result
```

`src/cadgpt/job_runtime/**` represents this execution contract/boundary; it must not evolve into an unnecessary second AI orchestration system.

---

## 11. `jobcreate` authoring lifecycle

`jobcreate` creates/refines concrete Jobs but does not invent missing company/domain policy.

### Phase A — planning

```text
goal/skeleton/current Job
→ clarify boundaries
→ agree skeleton
→ map every step + preferred/viable tools
→ define validation + real test
→ explicit user approval
```

No Job draft is created before planning approval.

### Phase B — draft

New Job:

```text
file_create under appdata/workspace/job-draft/<library>/<job>/JOB.md
```

Existing Job:

```text
job_get
→ job_checkout
→ edit workspace draft only
```

### Phase C — structural gate

```text
job_draft_validate
```

The draft must contain the canonical workflow semantics before real testing.

### Phase D — actual test

```text
execute actual workflow steps
→ collect actual outputs/postconditions
→ verify each required success criterion
→ verify final result
```

CAD-mutating tests require an explicitly approved test/bound drawing.

### Phase E — promotion

```text
explicit user acceptance
+ test evidence
+ final-validation evidence
+ valid draft
        ↓
job_promote_draft
        ↓
managed Job Library + User Registry
```

`job_promote_draft` is the normal permanent mutation path for authored Jobs.

---

## 12. Executor choice inside Jobs

A Job defines **what must happen**. The executor may differ by step while preserving the same semantics.

### Existing managed Lisp

Use when a curated/reviewed registered Lisp capability already performs the required work.

### `write-lisp`

Use when agreed AutoLISP is missing, broken or insufficient.

```text
Job step
→ write-lisp lifecycle
→ validated/tested/promoted capability
→ return to interrupted Job step
```

### Direct CAD MCP

Use for small explicit CAD operations better expressed directly than by creating automation.

### Structured reasoning

Use ChatGPT reasoning for decisions from structured CAD evidence, mappings, diagnostics and explicit rules.

Prefer structured CAD data over visual inference whenever the same decision can be made reliably from data.

---

## 13. Drawing-centric session model

CadGPT binds explicitly to one drawing identity before CAD business operations.

```text
ChatGPT conversation
→ CadGPT session
→ bound drawing identity
```

Rules:

- never silently use AutoCAD `ActiveDocument` as target authority;
- AutoCAD tab switching does not silently retarget CadGPT;
- proxied CAD calls re-establish/verify the bound drawing;
- if the bound drawing closes, CAD workspace becomes disconnected;
- do not silently choose another open drawing.

One conversation/session may execute many Jobs sequentially against the same bound drawing.

---

## 14. CAD MCP boundary

CAD MCP is the only live AutoCAD runtime.

Responsibilities include:

- host/runtime health;
- list/open drawing identities;
- explicit drawing targeting;
- structured layer/entity/block/xref/property queries;
- bounded mutation operations;
- AutoCAD command dispatch where appropriate;
- AutoLISP load/reload/run;
- runtime result/error evidence;
- safe test drawing support;
- selected AutoCAD events used by Observator.

CadGPT exposes stable proxied CAD tool descriptors even while CAD MCP is asleep/unavailable. Backend availability changes; ChatGPT's tool schema should not churn simply because AutoCAD is closed.

---

## 15. Observator boundary

Observator is an internal evidence/discovery subsystem, not a separate AI agent/persona.

Current design:

```text
capture start
→ collect identities from ObjectAdded events
→ capture finish resolves only those identities
→ remove erased/undone/nested results
→ return top-level type headers
```

It must not full-scan the drawing for this discovery path.

Deep property reads occur only after a Job chooses relevant candidate handles.

Job-specific filtering, semantics, lifecycle intent and persistence projection remain Job/runtime responsibilities.

Drawing-scoped Observator state lives under `appdata/drawings/<drawing_id>/**` and follows the Drawing Anchor rules documented in `appdata/README.md`.

---

## 16. Connection architecture

CadGPT exposes one MCP surface to ChatGPT.

```text
ChatGPT Developer Mode
        ⇅
OpenAI Secure MCP Tunnel
        ⇅
protected local CadGPT MCP endpoint
```

Do not require separate ChatGPT connectors for:

```text
file worker
Job runtime
CAD MCP
```

Internal routing is CadGPT's implementation detail.

Normal operation uses one stable tunnel identity/profile rather than disposable public tunnel URLs.

Secrets remain outside source control.

---

## 17. Installation contract

### `setup.bat`

One-time bootstrap must:

1. verify Windows + Node/Python requirements;
2. use locked dependencies;
3. initialize managed AppData;
4. generate the stable CAD tool manifest;
5. build CadGPT/wake-agent;
6. build isolated CAD MCP Python environment;
7. configure Secure MCP Tunnel;
8. install/start hidden per-user background task;
9. run status + doctor diagnostics.

### `run.bat`

`run.bat` controls the installed background agent; it is not the normal daily stack launcher.

### EXE-last rule

Do not package into installer/EXE until Stage 2/3 proves the BAT/runtime lifecycle on real Windows + AutoCAD.

Packaging must preserve a proven architecture rather than introduce a new one.

---

## 18. Repository structure

Current conceptual structure:

```text
Cadgpt/
├── setup.bat
├── run.bat
├── doctor.bat
├── acceptance.bat
│
├── src/
│   ├── index.ts
│   ├── wake-agent.ts
│   └── cadgpt/
│       ├── tools/
│       ├── session/
│       ├── runtime/
│       ├── launcher/
│       ├── observator/
│       ├── job_runtime/
│       ├── skill_runtime/
│       └── lib/
│
├── runtimes/
│   └── cad-mcp/
│
├── skills/
│   ├── write-lisp/
│   └── jobcreate/
│
├── knowledge/
│   └── jobs/
│
├── resources/
│   └── cad/
│
├── appdata/                   # Beta managed-user simulation root
│   ├── libraries/
│   ├── registry/
│   ├── workspace/
│   ├── data/
│   ├── runtime/
│   ├── drawings/
│   ├── state/
│   └── logs/
│
├── preserved/
│   └── revit-mcp/
│
├── scripts/
├── tests/
└── .github/workflows/
```

There are no authoritative root `lisp/**` / `jobs/**` writable workspaces in the current design.

---

## 19. Beta Scope Review — current fixes

Before Stage 2 is frozen, the following integrity contracts must be true:

```text
[ ] generic file writes cannot mutate appdata/libraries/**
[ ] Lisp syntax errors can be checked out for repair
[ ] helper-only Lisp can validate/promote intentionally
[ ] promotion cannot target a ghost/disabled library
[ ] User Registry IDs cannot be replaced across Lisp/Job kinds
[ ] Job checkout/validate/promote lifecycle is executable
[ ] Job promotion requires actual-test evidence + final-validation evidence + explicit acceptance
[ ] library replacement import is rollback-safe
[ ] changed imported implementation invalidates stale trusted semantics
[ ] import requires explicit source approval and bounded safe tree copying
[ ] CI exercises authoring-integrity invariants
[ ] product/roadmap/implementation docs all describe this same architecture
```

These are Beta Scope Review items, not Stage 2 real-CAD findings.

---

## 20. Stage 2 entry condition

Stage 2 begins only after the Beta Scope Review exit gate passes and scope is frozen.

Stage 2 then validates on a real Windows + AutoCAD workstation:

- setup/background-agent/tunnel end-to-end behavior;
- real AutoCAD host discovery and reconnect;
- explicit drawing binding across tab/close/reopen scenarios;
- structured read/query operations;
- reversible + guarded destructive mutations;
- real Lisp load/repair/test/promotion path;
- real Job execution/test/promotion path;
- TBH Toolkit runtime behaviors;
- reconnect/network/restart edge cases.

No documentation or static CI result should be presented as proof of real AutoCAD behavior.
