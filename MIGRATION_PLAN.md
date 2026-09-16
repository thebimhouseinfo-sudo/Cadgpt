# CadGPT — Detailed Migration Plan

Status: **Pre-code / migration contract**  
Source repository: `thebimhouseinfo-sudo/CAD-Agent`  
Target repository: `thebimhouseinfo-sudo/Cadgpt`

> This document defines how code will be migrated after the architecture plan is accepted. It is intentionally written before re-reading the existing CAD-Agent code or its old plans.

---

## 0. Migration goal

CadGPT will be created from useful implementation already present in CAD-Agent, but the old repository is treated only as a **source of implementation**, not as architectural authority.

The migration has four goals:

1. keep and adapt the existing **CAD runtime** as the live AutoCAD runtime for CadGPT;
2. preserve the existing **Revit runtime** without deleting it, but isolate it from CadGPT's active runtime and build;
3. add the narrow repository/workspace capability required to read, create, and edit LISP, skills, mappings, and config;
4. unify repository capability and CAD MCP behind one CadGPT session/UX.

The migration must not turn CadGPT into a general-purpose GPTWorker clone.

---

## 1. Runtime split is a hard migration invariant

The current CAD-Agent is known to contain both a CAD runtime and a Revit runtime.

For CadGPT:

```text
CAD Runtime    -> ACTIVE, adapted into CadGPT
Revit Runtime  -> PRESERVED, isolated, inactive
```

The Revit runtime must **not be deleted** during migration.

It exists as source material for a future product/repository:

```text
RevitGPT
```

CadGPT must not depend on the preserved Revit runtime at runtime.

---

## 2. Target repository structure

Initial migration target:

```text
Cadgpt/
├── src/
│   ├── cad-runtime/              # active AutoCAD runtime/plugin
│   ├── cad-mcp/                  # live CAD MCP server/contracts
│   ├── repo-runtime/             # narrow fixed-root file capability
│   ├── session/                  # shared CadGPT session/context/router
│   └── launcher/                 # one-run supervisor/bootstrap
│
├── lisp/                         # CadGPT-managed reusable AutoLISP
├── skills/                       # CadGPT skills
├── mappings/                     # mutable mapping data/config
├── config/
├── tests/
│
├── preserved/
│   └── revit-runtime/            # preserved source for future RevitGPT
│       ├── README.md
│       └── ...original runtime source...
│
├── IMPLEMENTATION_PLAN.md
└── MIGRATION_PLAN.md
```

Folder names may be adjusted after code inventory, but the semantic boundary is frozen:

```text
active CadGPT code       != preserved Revit source
```

### 2.1 Preserved Revit folder rules

`preserved/revit-runtime/` must:

- retain the Revit runtime source needed for later extraction;
- preserve provenance from CAD-Agent;
- be excluded from the normal CadGPT runtime;
- be excluded from CadGPT startup;
- preferably be excluded from the active solution/build graph;
- have no CadGPT feature silently depending on it;
- contain a README describing source commit/path and future RevitGPT intent.

If the existing Revit runtime cannot initially compile independently, preservation takes priority over cleanup. Cleanup belongs to the future RevitGPT project, not the CadGPT migration.

---

## 3. Shared-code rule

During inventory, some code may currently be shared by CAD and Revit runtimes.

Do not prematurely build a large common framework.

Classify shared code into three categories:

```text
A. CAD-specific       -> move/adapt into active CadGPT runtime
B. Revit-specific     -> move with preserved Revit runtime
C. truly host-neutral -> may move into a small shared/common module
```

A component is "truly host-neutral" only if it does not depend on AutoCAD or Revit APIs and is genuinely needed by active CadGPT.

If a shared component is difficult to separate safely during the first migration, temporary duplication is preferable to leaving CadGPT coupled to the preserved Revit runtime.

Hard rule after runtime split:

```text
CadGPT active build -> MUST NOT reference preserved/revit-runtime
```

---

## 4. Migration phases

## Phase M0 — Plan freeze

No CAD-Agent code migration yet.

Exit criteria:

- `IMPLEMENTATION_PLAN.md` accepted;
- this `MIGRATION_PLAN.md` accepted;
- CAD/Revit runtime split invariant accepted;
- fixed repository workspace + selectable CAD workspace semantics accepted;
- one-install / one-run requirement accepted.

Only after M0 may CAD-Agent code and structure be inspected for migration.

---

## Phase M1 — Source inventory, no modification

Read CAD-Agent and produce a migration inventory before copying code.

Required outputs:

```text
MIGRATION_MATRIX.md
RUNTIME_DEPENDENCY_MAP.md
```

Every relevant component must be classified:

```text
KEEP
ADAPT
REPLACE
DROP
PRESERVE-REVIT
```

The inventory must identify at least:

- AutoCAD runtime/plugin entry points;
- CAD MCP implementation and contracts;
- Revit runtime/plugin entry points;
- any shared runtime code;
- current launcher/bootstrap/install code;
- current UI/session code;
- current tool registration;
- current workspace/file capabilities, if any;
- tests and diagnostics;
- hard references between CAD and Revit projects.

No architectural decision may be reversed merely because the old repo is structured differently.

### M1 gate

Do not start refactoring until the dependency map can answer:

```text
What does CadGPT need from CAD-Agent?
What belongs only to Revit?
What is actually shared?
What can be removed from the active product?
```

---

## Phase M2 — Create clean CadGPT scaffold

Create the target boundaries before moving implementation.

Minimum scaffold:

```text
src/cad-runtime/
src/cad-mcp/
src/repo-runtime/
src/session/
src/launcher/
lisp/
skills/
mappings/
config/
tests/
preserved/revit-runtime/
```

Do not copy the whole CAD-Agent tree into the root and clean it later.

Migration must be component-by-component against the matrix from M1.

---

## Phase M3 — Preserve and isolate Revit runtime first

Before destructive refactoring of CAD-Agent-derived code:

1. identify the complete Revit runtime source set;
2. copy/preserve it under `preserved/revit-runtime/`;
3. record source paths and source commit SHA;
4. preserve supporting files required to understand/reuse it later;
5. remove it from CadGPT's active startup/build graph;
6. verify active CadGPT code no longer references the preserved folder.

Recommended preservation metadata:

```text
preserved/revit-runtime/README.md
```

with:

```text
source repository
source commit
original project/path list
preservation date
known dependencies
future target: RevitGPT
migration status
```

### M3 gate

Pass only when:

```text
Revit source is safely retained
AND
CadGPT can evolve without editing preserved Revit source
```

---

## Phase M4 — Migrate active CAD runtime

Move/adapt the AutoCAD runtime into `src/cad-runtime/`.

Preserve working AutoCAD integration where compatible, especially:

- AutoCAD plugin lifecycle;
- document access;
- database/editor access;
- document locking;
- transaction handling;
- selection/entity inspection;
- event observation;
- LISP loading/execution capabilities;
- any proven CAD-side IPC/transport.

Do not retain abstractions whose only purpose was supporting both CAD and Revit if CadGPT no longer needs them.

### Required runtime boundary

```text
CadGPT session
   -> CAD MCP
      -> CAD runtime/plugin
         -> AutoCAD API
```

The session layer must never directly manipulate AutoCAD API objects.

---

## Phase M5 — Normalize CAD MCP

Adapt the existing CAD interface to the compact CadGPT-facing contract.

Initial semantic surface should converge toward:

```text
cad.documents
cad.context
cad.query
cad.inspect
cad.modify
cad.block
cad.command
cad.lisp
cad.validate
```

The exact schemas are frozen after inspecting existing implementation.

Required behavior:

- every write resolves against the CadGPT-bound document identity;
- `ActiveDocument` alone is never sufficient authorization for a write;
- `/wp` lists currently open drawings and binds one document;
- switching AutoCAD tabs does not silently switch the CadGPT workspace;
- closing the bound drawing disconnects that workspace rather than auto-selecting another.

---

## Phase M6 — Add narrow Repository Runtime

This is the small capability inspired by GPTWorker, not a general coding worker.

Initial file tools:

```text
repo.list
repo.search
repo.read
repo.edit
repo.create
```

Fixed root:

```text
CadGPT repository/workspace root
```

Primary writable areas:

```text
lisp/
skills/
mappings/
config/
tests/
```

The runtime must enforce canonical-path sandboxing and reject traversal outside the configured root.

No shell, general process execution, package manager, or arbitrary filesystem access in the initial product.

---

## Phase M7 — Unified CadGPT session and capability routing

The user must never have to switch manually between a "worker" and "CAD operator".

One session owns:

```text
mode
fixed repo workspace
bound CAD workspace
active skill
recent repo changes
recent LISP reloads
recent CAD operations
connection health
```

Capability routing is internal:

```text
read/edit LISP or skill  -> Repository Runtime
inspect/modify DWG       -> CAD MCP
reload/run LISP          -> CAD MCP
```

Example request:

```text
"Layer mapping is wrong. Fix the rule and run it again."
```

Expected closed loop:

```text
CAD MCP inspect
-> repo.read / repo.edit
-> CAD MCP reload LISP
-> CAD MCP execute
-> CAD MCP validate
```

This is one CadGPT task, not multiple user-visible agents.

---

## Phase M8 — Skill/runtime model

Skills live in the fixed CadGPT repository workspace.

Each skill may orchestrate both capability classes.

Example: `create-xref`

```text
skills/create-xref/SKILL.md
        |
        +-> CAD MCP: inspect existing drawing/layers
        +-> repo: read mapping
        +-> reasoning: identify known/unmapped cases
        +-> repo: edit mapping or LISP if required
        +-> CAD MCP: reload
        +-> CAD MCP: execute
        +-> CAD MCP: validate
```

Rule:

```text
mapping/data change -> change mapping/config first
algorithm change    -> change LISP only when required
```

Skills must not require unrestricted local filesystem access.

---

## Phase M9 — Launcher, install, and startup consolidation

CadGPT must expose one installation flow and one normal startup flow.

Target UX:

```text
INSTALL ONCE
CadGPT-Setup.exe

RUN
CadGPT.exe
```

One launcher supervises:

```text
ChatGPT connector
Repository Runtime
session/skill runtime
CAD MCP service
AutoCAD plugin/bridge health
```

Internal child processes are allowed; multiple manual startup steps are not.

AutoCAD may start before or after CadGPT. Connection should recover without restarting the whole system.

---

## Phase M10 — UI consolidation

Keep a single compact CadGPT UI.

User-visible concepts:

```text
Mode: Chat | Observer | Operator
Drawing: current CadGPT-bound drawing
Connection status
Chat
```

Not user-visible as separate products:

```text
Repository Runtime
CAD Operator service
GPTWorker job
Revit runtime
```

`/wp` and the drawing selector represent the same binding state.

---

## Phase M11 — First end-to-end acceptance: Create XREF

Before expanding feature scope, prove the full architecture with the Create XREF workflow.

Acceptance scenario:

1. open one or more drawings in AutoCAD;
2. use `/wp` to bind the intended architectural drawing;
3. invoke Create XREF skill;
4. CAD MCP reads the live layer inventory;
5. CadGPT loads current mappings/skill/LISP from the fixed repo;
6. mapping-only gaps update data/config;
7. unsupported logic may trigger a LISP patch;
8. CAD MCP reloads required LISP;
9. CAD MCP executes the workflow on the bound drawing;
10. CAD MCP validates the output;
11. no manual backend switching is required.

This workflow must pass before CadGPT is considered structurally migrated.

---

## Phase M12 — Cleanup only after acceptance

Only after M11 passes:

- remove obsolete CAD-Agent compatibility code from active CadGPT;
- remove dead dual-host abstractions that are no longer required;
- simplify package/project naming;
- tighten tool permissions;
- consolidate diagnostics/logging;
- document installer/runtime behavior.

Do not delete `preserved/revit-runtime/` during this cleanup.

---

## 5. Future RevitGPT extraction contract

RevitGPT is deliberately **out of scope for the current CadGPT implementation**, but current migration must make later extraction easy.

Future flow:

```text
CadGPT/preserved/revit-runtime
        +
selected host-neutral patterns learned from CadGPT
        |
        v
new RevitGPT repository
```

CadGPT must not become a permanent monorepo for both products.

When RevitGPT work begins:

1. create a separate `RevitGPT` repository;
2. copy preserved Revit runtime with provenance intact;
3. adapt its own MCP/runtime boundary for Revit;
4. independently decide which CadGPT patterns to reuse;
5. remove the preserved Revit source from CadGPT only after RevitGPT has its own canonical copy and migration is verified.

Until then:

```text
PRESERVE, ISOLATE, DO NOT DELETE
```

---

## 6. Migration safety rules

Throughout implementation:

1. Never modify the original CAD-Agent repository as part of the migration unless explicitly requested; use it as source/reference.
2. All new canonical implementation goes into `Cadgpt`.
3. Never delete Revit runtime merely because CadGPT does not use it.
4. Never let preserved Revit code remain a hidden active dependency.
5. Do not import the entire GPTWorker tool surface.
6. Do not let AutoCAD `ActiveDocument` silently retarget Operator writes.
7. Do not expose internal service boundaries as separate UX agents.
8. Do not migrate code before it has a classification in `MIGRATION_MATRIX.md`.
9. Prefer preserving known-working CAD runtime behavior before redesigning it.
10. Refactor architecture boundaries first; feature expansion comes later.

---

## 7. Deliverables before implementation starts

After this plan is approved, the next repository-reading phase must produce, before substantive code migration:

```text
MIGRATION_MATRIX.md
RUNTIME_DEPENDENCY_MAP.md
```

Then the first implementation PR should focus on:

```text
scaffold target structure
+ preserve/isolate Revit runtime
+ migrate minimal working CAD runtime boundary
```

It should not simultaneously attempt every UI, skill, installer, and CAD feature.

---

## 8. Definition of migration success

The initial CadGPT migration is successful when all of the following are true:

```text
[ ] CadGPT builds/runs without active Revit runtime dependency
[ ] Revit runtime source is preserved with provenance
[ ] one CadGPT launcher starts required backend services
[ ] CAD MCP connects to AutoCAD runtime
[ ] /wp binds an explicit open drawing
[ ] Repo Runtime is restricted to the fixed CadGPT workspace
[ ] GPT can read/create/edit LISP and skills in that workspace
[ ] CAD MCP can load/reload LISP into the bound drawing
[ ] Operator can inspect/modify/validate the bound DWG
[ ] Create XREF passes end-to-end
[ ] user never manually switches between worker and CAD operator
```

Only after these conditions pass should CadGPT expand to additional skills and automation workflows.
