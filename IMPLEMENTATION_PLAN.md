# CadGPT — Implementation Plan

Status: **Architecture locked enough to begin repository scaffolding; implementation migration still pending**  
Target repository: `thebimhouseinfo-sudo/Cadgpt`  
Source for later migration: `thebimhouseinfo-sudo/CAD-Agent`

---

## 1. Product definition

CadGPT is a **thin local execution environment for ChatGPT to work with AutoCAD**.

CadGPT does **not** provide:

- a separate chat UI;
- a local AI/model runtime;
- a local model provider abstraction;
- multiple AI agents such as Chat / Observer / Operator;
- a general-purpose coding worker.

ChatGPT is the reasoning layer. CadGPT supplies the local execution capabilities required for CAD work:

1. **CAD MCP** — the only active runtime, responsible for live AutoCAD access and execution.
2. **Job runtime** — executes small repeatable CAD workflows defined under `jobs/**`.
3. **Skill runtime** — loads reusable expert capabilities such as `write-lisp`.
4. **Local file tools** — a deliberately narrow subset of GPTWorker-style file tools, sandboxed by default to `lisp/**` and `jobs/**`.
5. **Session state** — binds the ChatGPT conversation to one explicit open drawing.

The design goal is:

```text
ChatGPT
   ↓
CadGPT orchestration
   ↓
Jobs + Skills
   ↓
CAD MCP
   ↓
AutoCAD
```

When automation source must be changed:

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

A **Job** is a small, repeatable CAD workflow — equivalent to the old CAD workflow/skill concept.

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

### 5.3 Why `skills/**` is not a default general writable root

Skills are system capabilities and should change less frequently than working Jobs/LISP. The architecture may later expose a controlled `write-skill` path, but ordinary Job execution should not have broad write access to `skills/**` by default.

---

## 6. `write-lisp` Skill

`write-lisp` is a specialized AutoLISP coding capability, not a generic coding agent.

It must eventually include:

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

## 10. Repository layout

Target repository structure:

```text
Cadgpt/
│
├── src/
│   └── cadgpt/
│       ├── session/             # drawing binding + shared session state
│       ├── commands/            # /drawing, /job, /status, /doctor, ...
│       ├── job_runtime/         # Job loading + step execution + validation
│       ├── skill_runtime/       # load reusable Skills
│       ├── file_tools/          # narrow local file operations
│       └── launcher/            # startup/health orchestration if required
│
├── runtimes/
│   └── cad-mcp/                 # only active runtime
│
├── jobs/
│   ├── JOB_RULES.md             # canonical Job authoring contract
│   ├── README.md
│   └── <job-name>/
│       ├── JOB.md
│       ├── rules/               # optional Job-specific rules
│       ├── mappings/            # optional Job-specific data
│       └── validation/          # optional Job-specific validation data
│
├── lisp/
│   ├── README.md
│   └── ...                      # reusable AutoLISP maintained locally
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
│   └── revit-mcp/               # preserved only for future RevitGPT
│
├── config/
├── tests/
├── installer/
│
├── IMPLEMENTATION_PLAN.md
├── MIGRATION_PLAN.md
└── README.md
```

Git does not store empty directories; scaffolding files/READMEs may be used until implementation files exist.

---

## 11. Revit preservation boundary

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

## 12. No separate UI and no local AI

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

## 13. Migration strategy from CAD-Agent

The old repository is implementation source, not architecture authority.

Before moving code, create a migration matrix with these classes:

```text
KEEP       compatible with the new boundary
ADAPT      useful implementation but needs API/boundary changes
EXTRACT    only a small reusable part is needed
PRESERVE   keep for future use but not active in CadGPT
DROP       obsolete in the new product
```

Expected high-level direction:

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

CAD-Agent/tool-kit workflow folders
    → reinterpret as Jobs where appropriate

CAD-Agent/tool-kit reusable LISP
    → migrate into lisp/**

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

## 14. Implementation phases

### Phase 0 — Architecture and repository scaffold

- freeze Job/Skill/Tool semantics;
- establish the target repository tree;
- create `jobs/JOB_RULES.md`;
- establish default editable roots `lisp/**` and `jobs/**`;
- ensure only `cad-mcp` is treated as active runtime.

### Phase 1 — CAD-Agent inventory

Read the actual implementation and create a migration matrix.

Do not use old CAD-Agent plans as architectural authority.

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

### Phase 5 — `write-lisp`

- migrate coding guidance;
- extract useful OpenLISP validation/harness components;
- implement search-first/patch-first workflow;
- connect local file tools;
- connect CAD MCP test/load/run loop.

### Phase 6 — First real Job

Only after Job rules and runtime exist, define the first real CAD Job from an actual repeated workflow such as Create XREF.

The Job itself should be authored from the real workflow, not from a placeholder template.

### Phase 7 — Packaging and diagnostics

- one setup path;
- one startup path if a local service is required;
- `/status`;
- `/doctor`;
- clear CAD MCP connection diagnostics.

---

## 15. Acceptance invariants

CadGPT architecture is acceptable only if all of the following remain true:

1. **CAD MCP is the only active runtime.**
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
