# CadGPT — Implementation Plan

Status: **Architecture locked enough to begin migration and scaffold implementation**  
Target repository: `thebimhouseinfo-sudo/Cadgpt`  
Migration source: `thebimhouseinfo-sudo/CAD-Agent`  
Reference for local file/tunnel patterns: `thebimhouseinfo-sudo/chatgpt-local-worker`

---

## 1. Product definition

CadGPT is a **thin local execution environment that lets ChatGPT work directly with AutoCAD**.

CadGPT does **not** provide:

- a separate chat UI;
- a local AI/model runtime;
- a local model-provider abstraction;
- multiple AI agents such as Chat / Observer / Operator;
- a general-purpose local coding worker.

ChatGPT is the reasoning layer. CadGPT supplies the local execution capabilities required for CAD work:

1. **CAD MCP** — the only active runtime, responsible for live AutoCAD access and execution.
2. **Job runtime** — executes small repeatable CAD workflows defined under `jobs/**`.
3. **Skill runtime** — loads reusable expert capabilities such as `write-lisp`.
4. **Local file tools** — a narrow subset of GPTWorker-style file tools, sandboxed by default to `lisp/**` and `jobs/**`.
5. **Session state** — binds the ChatGPT conversation to one explicit open drawing.
6. **ChatGPT connector** — exposes one CadGPT MCP endpoint to ChatGPT through a stable supported connection path.

Target interaction model:

```text
ChatGPT
   ⇅
OpenAI Secure MCP Tunnel
   ⇅
CadGPT MCP endpoint
   ↓
Jobs + Skills
   ↓
CAD MCP
   ↓
AutoCAD
```

When automation source must change:

```text
Job step
   ↓
write-lisp skill
   ↓
local file tools
   ↓
AutoLISP + coding harness
   ↓
CAD MCP load/test/run
   ↓
return to Job step
```

---

## 2. Core semantic model

### 2.1 Job

A **Job** is a small, repeatable CAD workflow — equivalent to the useful workflow-oriented CAD skills in the old CAD-Agent.

A Job defines:

- what final result must be produced;
- how many ordered steps are required;
- the instruction for each step;
- the tools available in each step;
- optional preferred execution mechanism;
- step inputs and outputs;
- success criteria;
- failure/recovery behavior;
- final validation.

A Job is not a session and is not an agent.

One CadGPT session may execute many Jobs against the same bound drawing.

### 2.2 Skill

A **Skill** is a reusable expert capability used by Jobs or by ChatGPT directly.

The first critical system Skill is:

```text
write-lisp
```

`write-lisp` must contain the coding knowledge, rules, patterns, and harness needed to create or patch AutoLISP with low error rates.

A Skill is not a CAD business workflow. CAD business workflows belong in Jobs.

### 2.3 Tool

A **Tool** is a concrete execution mechanism available to a Job step or Skill, for example:

- CAD MCP query/inspect;
- CAD MCP modify;
- CAD MCP command execution;
- CAD MCP LISP load/run;
- local file list/search/read/create/patch.

### 2.4 Harness

A **Harness** is a quality gate.

Examples:

- `write-lisp` harness validates generated or patched LISP;
- a Job's validation checks whether the final drawing/result satisfies the Job contract.

---

## 3. Job execution model

Every Job is an ordered sequence of constrained execution steps.

Each step should define:

```text
instruction
inputs
available_tools
preferred_tools        # optional
success_criteria
failure_handling
output
```

A step does not receive every CadGPT tool automatically. The Job exposes only the tools needed for that step.

Example semantics:

```yaml
- id: inventory
  instruction: collect the structured layer/object inventory required by later steps
  available_tools:
    - cad.query
    - cad.lisp.load
    - cad.lisp.run
    - file.read:lisp
    - file.search:lisp
    - skill.write-lisp
  preferred_tools:
    - cad.lisp.run
  success_criteria:
    - required inventory exists
  failure_handling:
    - if automation is missing or insufficient, call skill.write-lisp
  output:
    - inventory
```

The implementation does not have to use YAML; these semantics are the contract.

Detailed Job authoring rules live in:

```text
jobs/JOB_RULES.md
```

---

## 4. Executor selection inside a Job

A Job defines **what must happen**. Each step chooses the appropriate execution mechanism.

### 4.1 Existing AutoLISP

Use when a reusable LISP already implements the required operation reliably.

### 4.2 `write-lisp` Skill

Call when:

- the required LISP does not exist;
- the existing LISP cannot satisfy the step;
- the existing LISP needs a controlled patch.

Expected loop:

```text
Job step
  → automation missing/insufficient
  → call write-lisp
  → inspect existing lisp/**
  → patch or create LISP
  → run coding harness
  → load/test through CAD MCP
  → return to the original Job step
  → continue
```

### 4.3 CAD MCP direct tools

Use when the operation is small, explicit, and simpler to perform directly than by creating automation.

### 4.4 Structured reasoning

Use GPT reasoning where rules must adapt to structured CAD evidence, mappings, diagnostics, or Job state.

Prefer structured CAD queries/exports over visual interpretation whenever the same decision can be made from data.

---

## 5. Local file tools

CadGPT needs only the GPTWorker-style local file operations required to maintain Jobs and AutoLISP.

Initial tool surface:

```text
file.list
file.search
file.read
file.create
file.patch / file.edit
```

No general shell, terminal, package manager, arbitrary process execution, or whole-machine filesystem access is required for the core product.

### 5.1 Default writable roots

The default local editable workspace is restricted to:

```text
lisp/**
jobs/**
```

These two directories are the default working roots for ChatGPT/CadGPT.

### 5.2 Safety requirements

File tools must enforce:

- canonical path resolution;
- rejection of `..` path escape;
- rejection of absolute paths outside allowed roots;
- `create` must fail if the target already exists unless explicit overwrite semantics are later added;
- `patch/edit` requires an existing target;
- mutation logging;
- atomic writes where practical.

### 5.3 Skills are not a default writable root

Skills are system capabilities and should change less frequently than working Jobs/LISP. A future controlled `write-skill` capability may modify `skills/**`, but ordinary Job execution must not receive broad write access there.

---

## 6. `write-lisp` Skill

`write-lisp` is a specialized AutoLISP coding capability, not a generic coding agent.

Target shape:

```text
skills/write-lisp/
├── SKILL.md
├── coding-rules/
├── patterns/
├── templates/
└── harness/
```

Responsibilities:

1. search existing `lisp/**` before creating new code;
2. prefer patching reusable LISP over rewriting;
3. preserve existing command contracts unless an intentional change is required;
4. apply AutoLISP/Visual LISP/ActiveX coding rules;
5. validate syntax and parenthesis balance;
6. validate load behavior;
7. validate command/runtime behavior when possible;
8. load/reload through CAD MCP;
9. test against the bound drawing;
10. inspect postconditions before returning control to the Job.

Useful parts of the old CAD-Agent `openlisp` project may be extracted into this Skill's harness, but **OpenLISP is not an active CadGPT runtime**.

---

## 7. CAD MCP — the only active runtime

CadGPT has exactly one active runtime:

```text
runtimes/cad-mcp/
```

CAD MCP owns all live AutoCAD interaction.

Core responsibilities:

- runtime/connection health;
- list open drawings;
- stable drawing identity;
- inspect the explicitly bound drawing;
- structured query of layers/entities/blocks/xrefs/properties;
- inspect current selection when useful;
- modify entities;
- execute AutoCAD commands;
- load/reload AutoLISP;
- run LISP commands;
- return structured command results;
- validate drawing state;
- expose relevant AutoCAD events if later needed by an Observer capability.

### 7.1 Tool design principle

Prefer a compact semantic API rather than one tool per property or command.

Conceptual families:

```text
cad.documents
cad.context
cad.query
cad.inspect
cad.modify
cad.command
cad.lisp
cad.validate
```

Avoid both extremes:

- hundreds of tiny MCP tools;
- one unconstrained `cad.execute(anything)` tool.

---

## 8. Drawing-centric session model

The CadGPT session is centered on an explicitly bound open DWG.

```text
ChatGPT conversation
        ↓
CadGPT session
        ↓
bound drawing identity
```

Switching AutoCAD tabs must not silently retarget CadGPT.

If the bound drawing closes:

```text
CAD workspace = disconnected
```

CadGPT must not silently choose another drawing.

A single session may run multiple Jobs in sequence against the bound drawing.

---

## 9. Command/control surface

CadGPT does not need its own UI. Control is exposed through the ChatGPT conversation using lightweight commands.

Initial command concepts:

```text
/              list control commands
/drawing       list/select the bound open drawing
/job           list available Jobs
/status        show current runtime/session status
/doctor        run diagnostics
/settings      controlled settings
```

`/job` primarily helps the user remember which reusable Jobs exist.

Examples:

```text
/job
/job <name>
```

When the user explicitly selects a Job, CadGPT resolves that Job and begins executing it; GPT does not need to reason about which Job the user intended.

Natural-language requests may still allow GPT to select an appropriate Job when useful.

---

## 10. ChatGPT connection architecture

CadGPT must expose **one local MCP endpoint** to ChatGPT. ChatGPT should not need to know that CadGPT internally contains a Job runtime, file tools, Skills, and CAD MCP.

Target connection:

```text
ChatGPT Developer Mode
        ⇅
CadGPT custom MCP app
        ⇅
OpenAI Secure MCP Tunnel
        ⇅
http://127.0.0.1:<fixed-port>/mcp
        ⇅
CadGPT
```

### 10.1 Supported connection target

For local/private execution, the preferred transport is **OpenAI Secure MCP Tunnel** with a stable tunnel identity.

Do not make ephemeral public URLs such as ad-hoc ngrok/cloudflared quick tunnels part of the normal CadGPT workflow.

The design goal is:

- one tunnel identity created/configured once;
- one custom CadGPT MCP app registered in ChatGPT Developer Mode;
- one local MCP endpoint;
- the same connection reused across normal restarts;
- no URL copy/paste on every run.

### 10.2 Tunnel configuration

CadGPT may adapt the proven GPTWorker tunnel bootstrap pattern:

```text
OPENAI_TUNNEL_ID
OPENAI_TUNNEL_API_KEY
local MCP port
local tunnel health port
stable profile file
```

The exact secrets must remain outside source control.

Tunnel responsibilities:

- outbound secure connection to OpenAI;
- stable tunnel identity;
- health endpoint;
- doctor diagnostics;
- reconnect/restart handling;
- clear status reporting.

### 10.3 One MCP surface

Do not expose separate ChatGPT connectors for:

```text
file worker
job runtime
CAD MCP
```

Instead:

```text
ChatGPT
   ↓
one CadGPT MCP endpoint
   ├── Job tools
   ├── file tools
   └── CAD tools
```

Internal routing remains an implementation detail.

### 10.4 Compatibility gate

Because CadGPT needs mutating actions such as file edits and drawing modification, setup/doctor must verify that the connected ChatGPT workspace/account supports the required write-capable MCP actions before CadGPT is considered fully operational.

---

## 11. Installation and startup contract

Before any EXE packaging, CadGPT must be installable and runnable reliably through two root scripts:

```text
setup.bat
run.bat
```

This is a mandatory implementation gate.

### 11.1 `setup.bat`

`setup.bat` is the first-time bootstrap and development installer.

Responsibilities:

1. verify supported Windows environment;
2. verify/install required runtime dependencies;
3. create/install the CadGPT local environment;
4. configure fixed local paths;
5. install/register the AutoCAD plugin components required by CAD MCP;
6. install/configure OpenAI `tunnel-client`;
7. initialize the stable tunnel profile/identity;
8. create local config from safe defaults;
9. ensure secrets are stored locally and excluded from Git;
10. run connection/runtime diagnostics;
11. show the one-time ChatGPT Developer Mode setup instructions.

After successful setup, normal use must not require rerunning setup.

### 11.2 `run.bat`

`run.bat` is the normal daily entrypoint.

It should start/supervise the complete local CadGPT stack required by ChatGPT:

```text
run.bat
   ↓
validate config/environment
   ↓
start CadGPT local MCP endpoint
   ↓
start/reuse OpenAI Secure MCP Tunnel
   ↓
verify tunnel health
   ↓
start/verify CAD MCP
   ↓
check AutoCAD bridge
   ↓
READY
```

The user must not need multiple terminals for normal operation.

If AutoCAD is not running:

```text
CadGPT MCP        = READY
Secure MCP Tunnel = CONNECTED
CAD MCP           = READY / WAITING FOR HOST
AutoCAD bridge    = WAITING
```

When AutoCAD starts later, the bridge should connect without requiring CadGPT to restart whenever technically feasible.

### 11.3 Diagnostics

The script/runtime layer should support a doctor path covering at least:

- required local runtime;
- config validity;
- allowed workspace paths;
- CadGPT MCP health;
- tunnel-client availability;
- tunnel profile validity;
- secure tunnel health;
- CAD MCP health;
- AutoCAD plugin registration;
- AutoCAD bridge connection;
- ChatGPT write-action compatibility where verifiable.

### 11.4 BAT-first, EXE-last

EXE packaging must not begin until these flows are stable:

```text
fresh machine / clean environment → setup.bat
normal start                     → run.bat
restart Windows                  → run.bat
AutoCAD starts before CadGPT     → connect
AutoCAD starts after CadGPT      → reconnect/connect
network interruption             → recover or report clearly
CadGPT restart                   → same tunnel identity reused
```

Only then may packaging map the proven contract to:

```text
setup.bat → CadGPT-Setup.exe
run.bat   → CadGPT.exe
```

The EXE is packaging of an already-proven startup contract, not a separate architecture.

---

## 12. Repository layout

Target repository structure:

```text
Cadgpt/
│
├── setup.bat                     # first-time bootstrap
├── run.bat                       # normal startup entrypoint
│
├── src/
│   └── cadgpt/
│       ├── connector/            # ChatGPT/MCP tunnel integration + health
│       ├── session/              # drawing binding + shared session state
│       ├── commands/             # /drawing, /job, /status, /doctor, ...
│       ├── job_runtime/          # Job loading + step execution + validation
│       ├── skill_runtime/        # load reusable Skills
│       ├── file_tools/           # narrow local file operations
│       └── launcher/             # startup/supervision
│
├── runtimes/
│   └── cad-mcp/                  # only active runtime
│
├── jobs/
│   ├── JOB_RULES.md              # canonical Job authoring contract
│   ├── README.md
│   └── <job-name>/
│       ├── JOB.md
│       ├── rules/                # optional Job-specific rules
│       ├── mappings/             # optional Job-specific data
│       └── validation/           # optional Job-specific validation data
│
├── lisp/
│   ├── README.md
│   ├── tbh-toolkit/              # initial migration landing zone
│   └── ...
│
├── skills/
│   └── write-lisp/
│       ├── SKILL.md
│       ├── coding-rules/
│       ├── patterns/
│       ├── templates/
│       └── harness/
│
├── preserved/
│   └── revit-mcp/                # preserved only for future RevitGPT
│
├── config/
├── scripts/                      # optional doctor/reset helpers
├── tests/
├── installer/                    # later EXE packaging only
│
├── IMPLEMENTATION_PLAN.md
├── MIGRATION_PLAN.md
└── README.md
```

Git does not store empty directories; scaffolding files/READMEs may be used until implementation files exist.

---

## 13. Revit preservation boundary

The old CAD-Agent includes a separate Revit MCP runtime.

It must not be deleted during migration, but it is **not part of active CadGPT**.

Target location:

```text
preserved/revit-mcp/
```

Rules:

- no CadGPT startup dependency;
- no CadGPT runtime registration;
- no active build dependency unless a truly host-neutral shared component is later extracted deliberately;
- preserve provenance so it can seed a future `RevitGPT` project.

---

## 14. No separate UI and no local AI

The old CAD-Agent frontend/backend AI application architecture is not carried forward as a product boundary.

CadGPT does not need:

- `frontend/index.html` style custom chat UI;
- local chat history UI;
- model selectors;
- Ollama integration;
- Anthropic/OpenAI-compatible provider abstraction for local orchestration;
- Chat/Observer/Operator agent selection.

Useful host-neutral utilities may still be inspected during migration, but these old subsystems are not architectural requirements.

---

## 15. Migration strategy from CAD-Agent

The old repository is implementation source, not architecture authority.

Create a migration matrix with these classes:

```text
KEEP       compatible with the new boundary
ADAPT      useful implementation but needs API/boundary changes
EXTRACT    only a small reusable part is needed
PRESERVE   keep for future use but not active in CadGPT
DROP       obsolete in the new product
```

### 15.1 Migration-first principle

Phase 1 migration prioritizes **working behavior over perfect organization**.

Do not redesign every old workflow while moving it.

The initial goal is:

```text
migrate working behavior
→ connect reliably
→ run Jobs successfully
→ validate
→ reorganize later
```

### 15.2 Old CAD skills

Useful workflow-oriented CAD skills from CAD-Agent should initially be moved into:

```text
jobs/<job-name>/
```

They may enter the new repo largely as-is if that preserves working behavior.

After Job Runtime is stable, each migrated workflow can be normalized against `jobs/JOB_RULES.md`.

### 15.3 TBH Toolkit

The existing TBH Toolkit should initially move into:

```text
lisp/tbh-toolkit/
```

Do not spend migration time perfectly reorganizing all LISP/DCL assets.

Later cleanup may split it into more semantic areas such as shared/system/xref/HVAC/annotation/etc.

### 15.4 Expected source mapping

```text
CAD-Agent/runtimes/cad-mcp
    → KEEP / ADAPT
    → Cadgpt/runtimes/cad-mcp

CAD-Agent/runtimes/Revit-mcp
    → PRESERVE
    → Cadgpt/preserved/revit-mcp

CAD-Agent/runtimes/openlisp
    → inspect and EXTRACT useful harness pieces
    → skills/write-lisp/harness

CAD-Agent old workflow-oriented skills
    → initial migration to jobs/**

CAD-Agent/tool-kit
    → initial migration to lisp/tbh-toolkit/**

CAD-Agent/backend/agents/*
    → do not migrate as agents
    → extract only useful behavior if needed

CAD-Agent/frontend/*
    → DROP from active architecture

CAD-Agent/backend/providers/*
    → DROP from active architecture unless a host-neutral utility is proven useful
```

Do not blindly copy the old repository tree.

---

## 16. Implementation phases

### Phase 0 — Architecture and repository scaffold

- freeze Job/Skill/Tool semantics;
- establish target repository tree;
- create `jobs/JOB_RULES.md`;
- establish default editable roots `lisp/**` and `jobs/**`;
- ensure only `cad-mcp` is treated as active runtime;
- establish `setup.bat` and `run.bat` as required deployment entrypoints.

### Phase 1 — CAD-Agent inventory and coarse migration

- inventory actual CAD-Agent implementation;
- create migration matrix;
- copy/preserve Revit MCP into `preserved/revit-mcp`;
- migrate useful old workflow-oriented CAD skills into `jobs/**` without premature redesign;
- migrate TBH Toolkit into `lisp/tbh-toolkit/**`;
- keep behavior first, organization second.

### Phase 2 — CAD MCP migration

- migrate/adapt CAD MCP;
- confirm stable open-document identity;
- confirm bound-document targeting;
- validate LISP load/run support;
- validate structured CAD query support.

### Phase 3 — Local file tools

Implement narrow file operations for `lisp/**` and `jobs/**` with sandboxing and audit behavior.

### Phase 4 — Job runtime

Implement:

- Job discovery;
- `/job` listing/resolution;
- Job loading;
- step context;
- per-step tool exposure;
- success/failure transitions;
- Job validation.

Normalize migrated old Jobs gradually after runtime behavior is proven.

### Phase 5 — `write-lisp`

- migrate coding guidance;
- extract useful OpenLISP validation/harness components;
- implement search-first/patch-first workflow;
- connect local file tools;
- connect CAD MCP test/load/run loop.

### Phase 6 — Stable ChatGPT connection

Implement one CadGPT MCP endpoint and the Secure MCP Tunnel path:

- local CadGPT MCP server;
- stable tunnel identity/profile;
- tunnel bootstrap;
- health checks;
- doctor path;
- reconnect handling;
- one-time Developer Mode registration instructions;
- verification of required write-capable tool access.

Reuse/adapt proven GPTWorker tunnel ideas rather than inheriting the whole GPTWorker runtime.

### Phase 7 — BAT deployment gate

Implement and harden:

```text
setup.bat
run.bat
```

Validate clean setup, normal startup, restart behavior, AutoCAD-before/after startup, tunnel reuse, and recoverable connection failure.

### Phase 8 — End-to-end real Job validation

Use an actual migrated/repeated workflow such as Create XREF to prove:

```text
ChatGPT
→ Job
→ structured CAD inspection
→ existing LISP or write-lisp
→ local file edit if required
→ CAD MCP load/run
→ validation
```

### Phase 9 — EXE packaging

Only after Phase 7 and Phase 8 are stable:

- package installer from the proven `setup.bat` contract;
- package launcher from the proven `run.bat` contract;
- preserve doctor diagnostics;
- do not introduce a new runtime architecture solely for EXE packaging.

---

## 17. Acceptance invariants

CadGPT architecture is acceptable only if all of the following remain true:

1. **CAD MCP is the only active CAD runtime.**
2. **No separate CadGPT chat UI is required.**
3. **No local AI/model runtime is required.**
4. **A Job is a small repeatable CAD workflow, not a session or agent.**
5. **Each Job step has explicit instructions and an explicit available tool set.**
6. **Jobs may mix existing LISP, `write-lisp`, CAD MCP direct tools, and structured reasoning.**
7. **`write-lisp` owns AutoLISP coding expertise and harness rules.**
8. **Default local file access is restricted to `lisp/**` and `jobs/**`.**
9. **The session remains bound to an explicit drawing identity.**
10. **Switching AutoCAD tabs never silently retargets the session.**
11. **Revit MCP is preserved but inactive.**
12. **Old CAD-Agent code is migrated selectively, not copied wholesale.**
13. **Useful old workflow-oriented CAD skills may migrate temporarily into `jobs/**` before normalization.**
14. **TBH Toolkit may migrate largely as-is into `lisp/tbh-toolkit/**` before later cleanup.**
15. **ChatGPT sees one CadGPT MCP app, not multiple internal connectors.**
16. **Normal local/private connectivity uses a stable OpenAI Secure MCP Tunnel identity rather than an ephemeral public URL.**
17. **Developer Mode registration is a one-time setup flow; normal startup does not require repasting a URL.**
18. **`setup.bat` and `run.bat` must be stable before EXE packaging begins.**
19. **Normal use requires one startup action, not multiple user-managed terminals.**
20. **Connection/runtime failures must be diagnosable through status/doctor checks.**
