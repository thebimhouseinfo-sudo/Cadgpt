# CadGPT — Migration Plan

Status: **active migration plan**  
Source repository: `thebimhouseinfo-sudo/CAD-Agent`  
Target repository: `thebimhouseinfo-sudo/Cadgpt`

This document is subordinate to `IMPLEMENTATION_PLAN.md`. It describes how useful implementation/assets are moved from the old CAD-Agent into the current CadGPT architecture.

---

## 1. Locked migration direction

CadGPT is no longer the old CAD-Agent architecture.

The migration must preserve these invariants:

```text
ChatGPT = reasoning + UI
CadGPT = thin local MCP execution layer
CAD MCP = only active runtime
Job = repeatable CAD workflow
Skill = reusable expert capability
Tool/LISP = execution mechanism
```

CadGPT does **not** migrate:

- the old custom frontend;
- local AI/provider layers;
- Chat / Observer / Operator as separate agents;
- a general-purpose coding worker;
- Revit MCP as an active runtime.

Default editable local roots remain:

```text
lisp/**
jobs/**
```

---

## 2. Migration philosophy

Migration phase work prioritizes **working behavior over perfect organization**.

Rules:

1. preserve known-working AutoCAD behavior first;
2. do not refactor AutoLISP merely while moving it;
3. keep source provenance whenever practical;
4. move existing useful CAD workflow descriptions into `jobs/**` only when needed, without redesigning each Job yet;
5. move TBH Toolkit assets into `lisp/tbh-toolkit/**` largely as-is;
6. normalize structure only after the core runtime and assets are stable;
7. never silently reintroduce old architecture because source code happens to be organized that way.

---

## 3. Current component classification

| CAD-Agent source | CadGPT treatment | Target |
|---|---|---|
| `runtimes/cad-mcp/` | KEEP / ADAPT | `runtimes/cad-mcp/` |
| `runtimes/Revit-mcp/` | PRESERVE, inactive | `preserved/revit-mcp/` |
| `runtimes/openlisp/` | EXTRACT useful ideas only | `skills/write-lisp/` harness/knowledge |
| `tool-kit/` | MIGRATE largely as-is | `lisp/tbh-toolkit/` |
| useful legacy CAD skills/workflows | TEMPORARY migration, no redesign yet | `jobs/<name>/` |
| `backend/agents/*` | DROP as agents; extract behavior only if still useful | none/direct capability |
| `backend/providers/*` | DROP unless clearly host-neutral | none |
| `frontend/*` | DROP | none |
| tracked venv/cache/log/temp output | DROP | none |

---

## 4. Completed foundation

The following architecture/runtime work is already merged into `main`.

### 4.1 ChatGPT connection foundation — COMPLETE

- one CadGPT MCP HTTP endpoint;
- OpenAI Secure MCP Tunnel pattern;
- stable local protected MCP path;
- session recovery;
- health reporting;
- `setup.bat`, `run.bat`, `doctor.bat`;
- no custom CadGPT UI;
- no local AI runtime.

### 4.2 File/runtime boundary — COMPLETE

- sandboxed file operations;
- default write/read workspace limited to `lisp/**` and `jobs/**`;
- no generic shell/git/package-manager tool surface;
- path traversal protection.

### 4.3 CAD MCP migration foundation — COMPLETE

Incremental safe tool slices are merged:

- document discovery/binding;
- inventory/layer/entity/block inspection;
- host diagnostics;
- reversible layer/entity property changes;
- geometry transforms;
- copy/mirror without source deletion;
- guarded entity delete using preview/token/exact snapshot;
- sandboxed AutoLISP load/run bridge.

The outer CadGPT session owns drawing identity. Business operations cannot choose a different document parameter to bypass binding.

### 4.4 `write-lisp` specialist — COMPLETE

`skills/write-lisp/` is a dedicated AutoLISP/Visual LISP coding capability, not a generic app coding agent.

It includes:

- AutoLISP-vs-Common-Lisp dialect boundary;
- AutoCAD API/DXF/COM knowledge;
- selection/batch patterns;
- block/xref/attribute guidance;
- debugging/testing guidance;
- TBH library scaffold/style guidance;
- static `lisp_validate` harness;
- canonical `lisp_scaffold`;
- verified AutoCAD load requirement;
- safe test-drawing policy;
- manual-user-test handoff for interactive commands.

### 4.5 Real-host acceptance tooling — COMPLETE IN REPO / PENDING REAL-HOST RUN

`acceptance.bat` now defines the pre-EXE local-host gate:

```text
run.bat
→ doctor
→ protected MCP session
→ AutoCAD discovery
→ new blank unsaved test drawing
→ verified AutoLISP load
→ safe command dispatch
```

CI can validate syntax/contracts but cannot replace an actual AutoCAD host. EXE packaging remains blocked until this acceptance flow passes on a real target Windows/AutoCAD machine.

---

## 5. Current migration phase — TBH Toolkit

The complete old:

```text
CAD-Agent/tool-kit/**
```

must become:

```text
Cadgpt/lisp/tbh-toolkit/**
```

### 5.1 Preserve-as-is rule

During migration:

- preserve every file needed by the toolkit, including `.lsp`, `.dcl`, supporting text/data and nested folders;
- preserve relative paths;
- do not rewrite Lisp into the new style just because it is being copied;
- do not rename commands;
- do not remove legacy files solely because they look inconsistent;
- record source commit provenance.

Later edits to an individual Lisp are governed by `skills/write-lisp/`.

### 5.2 Canonical migration mechanism

The source repository is private and GitHub repository-scoped tokens do not provide a safe default cross-repository copy path. Git object SHAs also cannot be reused directly across the two repositories.

Therefore the canonical migration is a local verified copy from a trusted clone:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass \
  -File scripts/migration/migrate-tbh-toolkit.ps1
```

Expected default sibling layout:

```text
<parent>/
├── CAD-Agent/
└── Cadgpt/
```

The script:

1. reads `CAD-Agent/tool-kit/**`;
2. copies every file preserving relative paths;
3. overwrites prior partial copies so the destination represents one exact source commit;
4. SHA256-verifies every copied file;
5. writes `lisp/tbh-toolkit/MIGRATION_PROVENANCE.md`;
6. leaves source behavior untouched.

This migration is not complete until the resulting asset changes are committed to CadGPT.

---

## 6. Revit preservation phase

Revit MCP remains out of scope for active CadGPT execution but its source must be preserved for future RevitGPT work.

Target:

```text
preserved/revit-mcp/
```

Requirements:

- copy source needed to understand/reuse the old Revit runtime;
- preserve original source repository/commit/path provenance;
- exclude preserved code from CadGPT startup/build/runtime dependency graph;
- no CadGPT feature may import from `preserved/revit-mcp/**`;
- do not refactor preserved Revit source during this migration.

The existing placeholder README is not equivalent to full source preservation; this phase remains open until the source set is actually retained.

---

## 7. Legacy CAD workflow migration

Useful workflow-oriented CAD-Agent skills may later be moved into `jobs/**` as temporary legacy Jobs.

This phase is intentionally **not** the redesign of individual Jobs.

Rules:

- preserve useful instructions/behavior first;
- add only enough metadata to make the workflow discoverable;
- do not spend migration time redesigning step semantics/mappings unless required for execution;
- detailed Job engineering happens after core/runtime/assets are stable.

`jobs/JOB_RULES.md` remains the canonical authoring contract for new/normalized Jobs.

---

## 8. Cleanup and packaging-prep

Only after core runtime + assets are stable:

- remove obsolete legacy scaffolding;
- consolidate migration docs;
- ensure no active Revit dependency;
- ensure no custom UI/local-AI remnants;
- validate setup/run/doctor/acceptance from a clean clone;
- lock dependency reproducibility where possible;
- prepare packaging layout.

Do not redesign business Jobs merely as part of cleanup.

---

## 9. EXE packaging gate

EXE work begins only after all of these pass on a real target machine:

```text
clean clone → setup.bat
normal startup → run.bat
doctor.bat → no blocking failures
acceptance.bat → PASS
AutoCAD before CadGPT → connects
AutoCAD after CadGPT → connects/reconnects
same Secure MCP Tunnel identity reused
verified AutoLISP load works in blank test DWG
```

Then packaging may wrap the already-proven contract:

```text
setup.bat → CadGPT-Setup.exe
run.bat   → CadGPT.exe
```

The EXE must not introduce a new runtime architecture.

---

## 10. Remaining sequence

Current recommended order:

```text
1. Run + commit complete TBH Toolkit migration
2. Preserve full Revit MCP source under preserved/
3. Migrate only useful legacy CAD workflow descriptions when needed
4. Run clean-host BAT + AutoCAD acceptance
5. Cleanup / dependency reproducibility / packaging-prep
6. Package EXE
7. Only then start detailed new Job implementation/normalization
```

The immediate next migration deliverable is the complete, hash-verified `lisp/tbh-toolkit/**` asset pack.
