# CadGPT — Implementation Plan

Status: **Architecture-first / pre-code**  
Target repository: `thebimhouseinfo-sudo/Cadgpt`  
Source for later migration: `thebimhouseinfo-sudo/CAD-Agent`  

> This plan is intentionally written from the agreed product architecture, not from the existing CAD-Agent implementation or its existing plans. No CAD-Agent code should be migrated or refactored until this plan is accepted.

---

## 1. Product definition

CadGPT is a single ChatGPT-facing CAD agent that combines two different execution capabilities behind one user experience:

1. **Repository capability** — a deliberately narrow local workspace used only to read, create, and edit CadGPT automation assets such as AutoLISP files, skills, mappings, configuration, and tests.
2. **Live CAD capability** — CAD MCP backed by the AutoCAD runtime, used to inspect and modify open DWG documents, load/reload LISP, execute commands, observe drawing state, and validate results.

The user should experience these as **one agent, one chat, one session, one current CAD workspace**.

CadGPT is not a general-purpose coding agent and must not inherit the full tool surface of GPTWorker.

---

## 2. Core architecture

```text
                         ChatGPT
                            │
                            ▼
                    ┌──────────────┐
                    │    CadGPT    │
                    │ session / UX │
                    └──────┬───────┘
                           │
                  Capability Broker
                   ┌───────┴────────┐
                   │                │
                   ▼                ▼
          Repository Runtime      CAD MCP
          fixed workspace         live CAD runtime
                   │                │
          LISP / skills /         AutoCAD plugin
          mappings / config            │
                   │                AutoCAD API
                   └────────┬───────────┘
                            │
                      shared context
```

### 2.1 Architectural rule

The two runtimes are independent internally but unified at the CadGPT session layer.

- Repository Runtime owns **automation source assets**.
- CAD MCP owns **live drawing state and CAD execution**.
- Neither runtime substitutes for the other.
- CadGPT decides which capability is appropriate for each step.

---

## 3. Two workspaces, different semantics

CadGPT must distinguish two workspace concepts.

### 3.1 Repository workspace — fixed

A fixed root directory configured during installation or setup.

Example:

```text
D:\CadGPT\
├── lisp\
├── skills\
├── mappings\
├── config\
├── tests\
└── logs\
```

Properties:

- fixed for the running installation;
- cannot be changed implicitly by ChatGPT;
- all repository file tools are sandboxed to this root;
- path traversal outside the root must be rejected;
- intended for CadGPT-owned automation assets, not arbitrary user files.

### 3.2 CAD workspace — selectable

The CAD workspace is one **open AutoCAD document** explicitly bound to the CadGPT session.

It is selected through the CadGPT command:

```text
/wp
```

`/wp` requests the list of currently open AutoCAD drawings from CAD MCP and presents them for selection.

Supported initial forms:

```text
/wp            # list open drawings
/wp <number>   # bind session to listed drawing
/wp current    # bind to AutoCAD ActiveDocument
/wp info       # show current binding
```

### 3.3 Binding invariant

AutoCAD `ActiveDocument` and CadGPT current CAD workspace are **not equivalent**.

Switching tabs in AutoCAD must not silently retarget CadGPT.

If the bound document is closed:

```text
CAD workspace = DISCONNECTED
```

CadGPT must not silently select another drawing. The user selects a replacement with `/wp`.

This is a safety invariant, especially in Operator mode.

---

## 4. User-facing modes

CadGPT keeps the previously established three-mode UX.

### 4.1 Chat

Read-only assistance.

Allowed conceptually:

- inspect drawing context;
- inspect selections;
- read repository assets;
- explain or propose changes.

No live drawing modification.

### 4.2 Observer

Read-only CAD observation plus drawing/event context.

Examples:

- active selection changes;
- selected entity properties;
- current drawing context;
- relevant drawing events.

Observer must not mutate the drawing.

### 4.3 Operator

Allows live CAD mutation through CAD MCP.

Examples:

- modify entities;
- run commands;
- load/reload LISP;
- execute automation;
- validate results.

Operator is a **permission mode**, not a separate product or agent.

---

## 5. Repository Runtime — intentionally minimal

CadGPT needs only a small subset of GPTWorker-like local file capabilities.

### 5.1 Initial tool surface

```text
repo.list(path)
repo.search(query, path?)
repo.read(path)
repo.edit(path, patch)
repo.create(path, content)
```

Optional later:

```text
repo.delete(path)
```

`repo.delete` should not be included in the first implementation unless required.

### 5.2 Explicit exclusions

The first CadGPT release must not expose general-purpose capabilities such as:

```text
arbitrary filesystem access
shell / terminal
package manager
process execution
general Git commands
browser automation
general coding-agent harness
```

If later required, each capability must be justified by a concrete CadGPT workflow rather than inherited from GPTWorker by default.

### 5.3 File safety

Repository Runtime must enforce:

- canonical path resolution;
- no `..` escape;
- no absolute path outside configured root;
- atomic file update where possible;
- `repo.create` fails if the target exists;
- `repo.edit` requires an existing target;
- audit logging of file mutations.

### 5.4 Initial file types

Initial expected assets:

```text
.lsp
.md
.json
.yaml / .yml
.csv
```

The allow-list may be configurable, but defaults should stay narrow.

---

## 6. Skill and automation asset model

CadGPT separates procedure, reusable implementation, and live execution.

```text
Skill      = knowledge, workflow, decision rules
LISP       = reusable AutoCAD automation implementation
Mapping    = mutable data/configuration
CAD MCP    = live inspection and execution interface
```

### 6.1 Preferred repository shape

```text
CadGPT/
├── lisp/
│   ├── utilities/
│   └── workflows/
├── skills/
│   ├── create-xref/
│   │   └── SKILL.md
│   └── ...
├── mappings/
│   └── ...
├── config/
├── tests/
└── runtime/
```

The exact final layout can be adjusted during implementation, but the semantic separation must remain.

### 6.2 Data change vs algorithm change

CadGPT must prefer **data/config updates** over source-code modification when the engine already supports the required behavior.

Example:

```text
new source layer mapping
→ update mapping CSV/JSON
```

not:

```text
new source layer mapping
→ rewrite LISP engine
```

LISP should be changed when the existing algorithm or capability is insufficient.

Example:

```text
existing mapper only reads block reference layer,
but correct behavior requires inspecting nested block entities
→ algorithm change → patch LISP
```

---

## 7. CAD MCP responsibilities

CAD MCP is the authoritative interface for live AutoCAD work.

It must be backed by an AutoCAD runtime/plugin capable of accessing the current application/document/database state.

### 7.1 Core responsibilities

CAD MCP should provide semantic capabilities for:

- connection and runtime health;
- list open documents;
- identify current AutoCAD active document;
- inspect the CadGPT-bound document;
- inspect current selection;
- query entities;
- inspect entities and properties;
- inspect layers, blocks, linetypes, colors, geometry and relevant relationships;
- modify drawing entities;
- execute AutoCAD commands where appropriate;
- load/reload AutoLISP;
- run LISP commands;
- validate post-operation state;
- expose drawing events required by Observer mode.

### 7.2 Tool design rule

Do not create one MCP tool for every AutoCAD property or command.

Prefer a compact semantic API such as:

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

Exact schemas will be frozen during the CAD MCP contract phase.

### 7.3 Avoid the opposite extreme

Do not collapse the entire API into one unconstrained tool such as:

```text
cad.execute(anything)
```

The schema must remain typed enough to validate intent and parameters.

---

## 8. Shared CadGPT session context

One CadGPT session should maintain at least:

```text
mode
repository root
bound CAD document identity
bound CAD document display name/path
AutoCAD active document identity
current selection summary
loaded/active skill
recent repository mutations
recent LISP load/reload
recent CAD operations
connection health
```

This context allows a single user request to cross both runtimes without exposing backend switching to the user.

Example:

```text
"The fitting detection is wrong. Fix the logic and test it again."
```

CadGPT may:

1. inspect the failing fitting through CAD MCP;
2. inspect nearby pipes through CAD MCP;
3. read the relevant skill/LISP through Repository Runtime;
4. patch the automation;
5. reload the changed LISP through CAD MCP;
6. rerun the command;
7. inspect and validate the result.

The user remains in one conversation and one agent.

---

## 9. Reference workflow — Create XREF skill

This is the first reference workflow for validating the architecture.

### 9.1 User flow

User opens an architectural drawing and invokes the Create XREF skill.

### 9.2 Expected execution

```text
Load create-xref skill
        ↓
CAD MCP: inspect bound drawing
        ↓
CAD MCP: enumerate relevant existing/source layers
        ↓
Repository Runtime: load existing mapping data
        ↓
CadGPT: classify known/unmapped layers
        ↓
If mapping-only change:
    update mapping data
Else if current engine cannot express required behavior:
    inspect and patch LISP
        ↓
CAD MCP: reload LISP/config as required
        ↓
CAD MCP: execute XREF workflow
        ↓
CAD MCP: inspect result
        ↓
Validate remaining source/unmapped layers and target properties
```

### 9.3 Decision rule

CadGPT must not guess ambiguous mappings.

A layer with insufficient evidence remains `UNMAPPED` and is reported rather than silently assigned.

### 9.4 Why this workflow is the architecture test

Create XREF requires all important CadGPT capabilities in one coherent user action:

- skill loading;
- live CAD inspection;
- layer inventory;
- mapping reasoning;
- repository edits;
- possible LISP edits;
- LISP reload;
- CAD execution;
- post-operation validation.

The architecture is not considered complete until this workflow can run end-to-end without the user manually switching between separate worker/operator systems.

---

## 10. One-install / one-run requirement

Installation and startup simplicity is a product requirement, not an optional polish item.

### 10.1 Installation target

The user should install CadGPT once.

Conceptually:

```text
CadGPT-Setup.exe
```

Installer responsibilities:

- install CadGPT launcher/runtime;
- create or register repository workspace configuration;
- install/register the AutoCAD plugin bundle;
- install CAD MCP service/runtime components;
- install Repository Runtime components;
- create local configuration and authentication material;
- configure logging;
- avoid manual `NETLOAD` for normal use.

### 10.2 Runtime target

The user starts one thing:

```text
CadGPT.exe
```

or equivalent one-step command.

The launcher supervises the internal components:

```text
CadGPT launcher
├── ChatGPT connector
├── Repository Runtime
├── Skill/session runtime
├── CAD MCP server
└── AutoCAD bridge health
```

The implementation may use multiple child processes internally, but process topology must not leak into normal UX.

### 10.3 AutoCAD lifecycle

If AutoCAD is not running:

```text
CadGPT backend = READY
CAD runtime = WAITING
```

When the AutoCAD plugin connects later:

```text
CAD runtime = CONNECTED
```

CadGPT should not require a restart solely because AutoCAD was opened after CadGPT.

---

## 11. Health and diagnostics

CadGPT should expose a single diagnostic command analogous to a worker `doctor` command.

Example:

```text
cadgpt doctor
```

Expected checks:

```text
CadGPT runtime
Repository workspace
Repository permissions
ChatGPT connector
CAD MCP server
AutoCAD plugin registration
AutoCAD plugin connection
AutoCAD version
Bound CAD workspace
```

Diagnostic output should identify the failing layer and a concrete corrective action when possible.

---

## 12. Security boundaries

### 12.1 Repository boundary

Repository tools are sandboxed to the configured CadGPT repository root.

No general machine filesystem access is required for the core product.

### 12.2 CAD document boundary

Write operations must target the explicitly bound CadGPT CAD workspace, not whichever AutoCAD document happens to be active at execution time.

Every mutating CAD request must carry or resolve an immutable document identity.

### 12.3 Operator boundary

Live drawing mutation requires Operator mode.

Chat and Observer must reject mutating CAD operations.

### 12.4 Transaction safety

Where supported by the AutoCAD API, mutating workflows should use:

```text
document lock
→ transaction
→ modifications
→ validation
→ commit
```

Failure before commit should abort/rollback the transaction.

For workflows spanning multiple CAD transactions, CadGPT should establish an undo boundary and report partial-completion risk explicitly.

### 12.5 No implicit target switching

Changing AutoCAD active tabs does not change the bound CadGPT target.

This rule is mandatory.

---

## 13. Logging and audit model

CadGPT should keep structured logs sufficient to answer:

- which drawing was targeted;
- which skill was active;
- which repository files were changed;
- which LISP file was loaded/reloaded;
- which CAD operation was executed;
- whether validation passed;
- whether a transaction committed or aborted.

Logs must not become a hidden secondary session model exposed to the user. User-facing history remains the chat for the current working flow.

---

## 14. UI requirements

The UI should remain compact and CAD-focused.

Initial conceptual layout:

```text
┌──────────────────────────────┐
│ CadGPT          ● Connected  │
├──────────────────────────────┤
│ Mode:     Operator         ▼ │
│ Drawing:  ARCH-L02.dwg     ▼ │
│ CAD MCP:  Connected          │
├──────────────────────────────┤
│                              │
│            CHAT              │
│                              │
├──────────────────────────────┤
│ Ask CadGPT...            Send│
└──────────────────────────────┘
```

Requirements:

- one chat surface;
- no separate History panel;
- no permanent Tools panel;
- no Quick Skill panel in the initial UI;
- drawing selector reflects `/wp` semantics;
- connection status visible;
- mode selector limited to Chat / Observer / Operator;
- backend concepts such as “GPTWorker job” or “CADOperator service” must not appear in normal UX.

---

## 15. Migration strategy from CAD-Agent

Migration starts **only after this implementation plan is accepted**.

The existing CAD-Agent repository will then be inspected as a source of reusable implementation, not as architectural authority.

### 15.1 Migration rule

For each CAD-Agent component, classify it as:

```text
KEEP       compatible with CadGPT architecture
ADAPT      useful implementation but wrong boundary/API
REPLACE    conflicts with new architecture
DROP       obsolete or unnecessary
```

### 15.2 Likely reusable categories to inspect later

Without assuming their current implementation:

- AutoCAD plugin/runtime integration;
- CAD MCP server or related transport;
- document/selection/entity inspection;
- CAD event observation;
- existing compact UI components;
- connection state handling.

### 15.3 Explicitly not inherited automatically

- existing CAD-Agent implementation plans;
- old agent/session abstractions;
- duplicate history/session UI;
- arbitrary tool panels;
- runtime boundaries that separate Operator from the main CadGPT experience;
- any assumption that ActiveDocument automatically equals CadGPT workspace.

---

## 16. Implementation phases

### Phase 0 — Plan freeze

Deliverables:

- this implementation plan reviewed and accepted;
- core invariants confirmed;
- no production code migration before completion.

Exit gate:

```text
PLAN APPROVED
```

### Phase 1 — CAD-Agent source audit against new plan

Only after Phase 0.

Tasks:

- inspect CAD-Agent file tree and runtime architecture;
- identify reusable AutoCAD integration;
- identify reusable CAD MCP implementation;
- identify reusable UI;
- produce KEEP / ADAPT / REPLACE / DROP matrix;
- do not preserve code merely to minimize diff.

Deliverable:

```text
MIGRATION_MATRIX.md
```

### Phase 2 — CadGPT repository skeleton

Create the target source structure and migrate only the minimum reusable foundation.

Expected major modules:

```text
src/
  app-or-launcher/
  session/
  repository-runtime/
  cad-mcp/
  autocad-plugin/
  ui/

lisp/
skills/
mappings/
config/
tests/
```

Exact language/project structure will follow the source audit.

### Phase 3 — Repository Runtime

Implement and test:

```text
repo.list
repo.search
repo.read
repo.edit
repo.create
```

Acceptance:

- sandbox escape tests fail safely;
- atomic edit behavior verified;
- allowed file types enforced;
- audit entries produced.

### Phase 4 — CAD document identity and `/wp`

Implement CAD MCP document enumeration and session binding.

Acceptance:

- `/wp` lists open drawings;
- `/wp N` binds by stable document identity;
- switching AutoCAD tabs does not retarget CadGPT;
- closing the bound drawing disconnects workspace rather than auto-switching;
- all CAD mutation APIs reject mismatched/stale document identity.

### Phase 5 — CAD MCP semantic core

Implement/finalize compact semantic tools for:

- context;
- query;
- inspect;
- modify;
- commands;
- LISP loading/execution;
- validation.

Acceptance:

- read and write permission boundaries match modes;
- transactions and document locks are correct;
- structured errors are returned instead of silent CAD failures.

### Phase 6 — Unified CadGPT session

Connect Repository Runtime and CAD MCP behind one session/context broker.

Acceptance scenario:

```text
inspect CAD
→ edit LISP or skill
→ reload LISP
→ execute CAD command
→ validate result
```

must complete without user-side backend switching.

### Phase 7 — Create XREF reference skill

Implement the first end-to-end skill.

Minimum behavior:

- inspect layer inventory from bound drawing/source;
- read mapping data;
- identify known and unknown mappings;
- update mapping data when sufficient;
- patch LISP only when algorithmic capability is missing;
- reload automation;
- execute XREF workflow;
- validate resulting layer state;
- report unresolved mappings instead of guessing.

This is the primary architecture acceptance test.

### Phase 8 — Compact UI integration

Implement/refactor UI around:

```text
Mode
Drawing
Connection status
Chat
Input
```

No extra panels unless justified by observed workflow needs.

### Phase 9 — Packaging and one-step startup

Deliver:

- one installer;
- AutoCAD plugin registration/bundle;
- one launcher;
- automatic startup/supervision of required internal services;
- health checks;
- `doctor` command.

Acceptance:

A clean supported Windows machine with supported AutoCAD should require no manual multi-terminal startup and no routine manual `NETLOAD`.

### Phase 10 — Hardening

Test:

- multiple open drawings;
- target tab changes during long operation;
- drawing closes mid-operation;
- AutoCAD restart while CadGPT stays running;
- CAD MCP crash/reconnect;
- repository edit failure;
- malformed LISP;
- LISP reload failure;
- transaction failure;
- ambiguous layer mapping;
- Observer/Chat attempting write operations;
- path traversal attempts.

---

## 17. Pre-code invariants

These are considered frozen unless explicitly revised in this plan before implementation:

1. **CadGPT is one user-facing agent.**
2. **Operator is a CadGPT mode, not a separate product.**
3. **Repository Runtime and CAD MCP are separate capabilities behind one session.**
4. **Repository workspace is fixed and sandboxed.**
5. **CAD workspace is one explicitly selected open drawing.**
6. **`ActiveDocument` changes do not implicitly change CadGPT workspace.**
7. **`/wp` is the canonical drawing-binding command.**
8. **CAD MCP owns live DWG inspection and mutation.**
9. **Repository Runtime owns LISP/skill/mapping source mutation.**
10. **CadGPT does not receive GPTWorker's full general-purpose tool surface.**
11. **Data/mapping changes should not require LISP rewrites when the engine already supports them.**
12. **Ambiguous CAD classification/mapping must not be silently guessed.**
13. **Normal installation is one-step and normal startup is one-step.**
14. **Backend topology must not leak into ordinary UX.**
15. **The Create XREF workflow is the first end-to-end architectural acceptance case.**

---

## 18. Definition of first usable release

The first usable CadGPT release is reached when all of the following are true:

- CadGPT installs as one product;
- normal startup launches all required services;
- AutoCAD plugin connects automatically after AutoCAD starts;
- user can use `/wp` to bind one of multiple open drawings;
- user can switch Chat / Observer / Operator modes;
- CadGPT can inspect the bound drawing;
- CadGPT can read/edit/create permitted LISP and skill assets inside the fixed repository root;
- CadGPT can load/reload LISP into the bound AutoCAD runtime;
- CadGPT can execute and validate a live CAD operation;
- Create XREF runs end-to-end through the unified workflow;
- switching AutoCAD tabs cannot redirect an Operator action to the wrong drawing;
- the user never needs to manually choose between a “worker” and a “CAD operator”.

---

## 19. Immediate next step after approval

After this plan is accepted:

1. inspect `thebimhouseinfo-sudo/CAD-Agent` for the first time under this plan;
2. produce `MIGRATION_MATRIX.md`;
3. identify the smallest reusable runtime slice;
4. migrate/refactor that slice into `thebimhouseinfo-sudo/Cadgpt`;
5. preserve the new plan as the architectural authority throughout migration.

Until the plan is accepted, **no CAD-Agent implementation should be copied into CadGPT**.
