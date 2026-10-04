# CadGPT

**Status: Active development**

CadGPT turns ChatGPT into a drawing-centric AutoCAD execution environment. ChatGPT remains the reasoning surface; CadGPT provides the local control plane, drawing binding, AutoLISP/Job orchestration, registry discovery, diagnostics, the AutoCAD add-in, and the CAD MCP bridge.

```text
ChatGPT / CadGPT plugin
        ⇅
OpenAI Secure MCP Tunnel
        ⇅
CadGPT slim admission/control plane
        ↓
WorkRegistration + ToolLease
   ├── FILE
   └── CAD / HYBRID
          ↓
        CAD MCP
          ↓
       AutoCAD
```

The AutoCAD add-in can host ChatGPT in a dockable palette, but the add-in UI is not CAD authority. CadGPT runtime/work binding remains authoritative.

## Current product contract

- explicit launch through the CadGPT/CG plugin or literal `@cadgpt` / `@cg`;
- one active work binds one drawing;
- current CAD facts are read fresh from the bound drawing;
- while CG is active with a bound drawing, requests such as **draw / redraw / create / add / modify / vẽ / vẽ lại / tạo / sửa** target AutoCAD by default;
- external image generation is used only when the user explicitly asks for an image/render/illustration rather than CAD output;
- AutoCAD is never launched implicitly by the MCP runtime;
- CAD MCP sleeps until actual CAD demand;
- managed user/runtime state lives under `%LOCALAPPDATA%\CadGPT`;
- file mutation uses canonical absolute paths inside approved roots;
- production runtime does not self-modify CAD MCP source;
- Revit development is not part of this repository. RevitGPT is maintained as a separate project/repository.

## Launch and drawing binding

CadGPT reads the lightweight tray snapshot before starting full CAD MCP.

```text
CG / @cg / @cadgpt
├─ 0 drawings
│  → Welcome screen
│  → WORK IDLE
│
├─ exactly 1 drawing
│  → auto-bind that drawing
│  → Workspace Ready
│
└─ 2+ drawings
   → Welcome screen + drawing list
   → user chooses exactly one
   → Workspace Ready
```

`cg/list` refreshes the tray-backed drawing list and does not wake full CAD MCP by itself.

A bound workspace follows:

```text
1 work = 1 drawing
```

CadGPT never treats ambient AutoCAD `ActiveDocument` as drawing authority.

## Commands

```text
cg/       full command menu
cg/list   refresh open drawings
cg/cl     create or repair Lisp
cg/cj     create or repair Job
cg/job    list registered Jobs
cg/mcp    CAD MCP development workflow (development builds only)
cg/help   help
cg/stop   stop current work
```

`@cadgpt` / `@cg` activate CadGPT; they are not the CLI namespace.

## AutoCAD add-in

The managed add-in lives at:

```text
addins/cadgpt-autocad/
```

It embeds ChatGPT in an AutoCAD dockable palette while leaving admission, work authority, and drawing binding in the CadGPT runtime.

Install or refresh it after closing AutoCAD:

```bat
cadaddin.bat
```

Then open AutoCAD and run:

```text
CADGPT
```

The installed bundle is placed under the current user's Autodesk ApplicationPlugins directory and is configured for AutoCAD startup loading. The panel itself stays hidden until requested.

See `addins/cadgpt-autocad/README.md` for host probing, build details, WebView2 profile behavior, and compatibility notes.

## CAD intent and live state

While CadGPT is active with a drawing workspace:

- drawing/editing language targets the bound AutoCAD drawing by default;
- an attached image may be used as a geometric/visual reference for CAD work;
- the attachment does not change the output destination to image generation;
- layer counts, entity counts, geometry, properties, selections, and other current-state questions require a fresh CAD read in the same turn;
- conversation history is never treated as live CAD state.

Curated CAD operating knowledge lives in:

```text
knowledge/cad/WORKING_KNOWLEDGE.md
```

## Diagnostics

Real product failures and incorrect behavior are accumulated separately from model knowledge:

```text
diagnostics/cad/ERROR_LOG.md
```

Use the error log for tool/runtime failures, routing errors, latency regressions, workarounds, unexpected CAD behavior, and other defects discovered during real use.

Only stable CAD operating knowledge should be promoted into `knowledge/cad/WORKING_KNOWLEDGE.md`.

## Registry

CadGPT exposes one effective registry with strict ownership.

```text
Internal Registry
├─ MCP tools
├─ system skills
├─ bundled Lisp
└─ official Internal Jobs

User Registry
├─ Lisp capabilities
└─ user Jobs
```

User Registry cannot overwrite Internal Registry.

### TBH Toolkit

Bundled TBH content lives under:

```text
resources/cad/internal-lisp/tbh-toolkit
```

The official Internal Direct Job `tbh` loads:

```text
resources/cad/internal-lisp/tbh-toolkit/tbhloader.lsp
```

Per drawing:

```text
tbhloader.lsp load success → TBH = ON
tbhloader.lsp load failure → TBH = OFF
```

A failed Internal Direct Job is surfaced as a failure instead of being bypassed through lower-level tools.

## AutoLISP

User-managed Lisp lives under:

```text
%LOCALAPPDATA%\CadGPT\libraries\lisp
```

Editing uses controlled checkout → validate → real CAD test → promote workflows. Generic file tools cannot mutate permanent managed libraries.

System Lisp authoring guidance lives under:

```text
skills/write-lisp/
```

## Jobs

User-created/imported Jobs live in managed AppData and User Registry.

CadGPT supports:

- **Direct Jobs** — fixed local implementations without model planning;
- **Reasoning Jobs** — sequential READ → PLAN → REVIEW → EXEC → READBACK workflows.

When a reusable Job needs a dynamic form of an already-working Lisp, CadGPT seeds a byte-for-byte copy once under the Job's own `dynamic-lisp/` folder, patches only declared data/sections with hash-guarded exact replacements, and reuses that persisted copy on later runs. Shared Lisp logic stays in the Lisp Library; Job-owned derivatives are not adapter commands.

Job authoring guidance lives under:

```text
skills/jobcreate/
knowledge/jobs/
```

## Managed AppData

Production data lives under:

```text
%LOCALAPPDATA%\CadGPT\
├── libraries/
│   ├── lisp/
│   └── jobs/
├── registry/
│   └── user/
├── workspace/
│   ├── lisp-draft/
│   └── job-draft/
├── runtime/
├── data/
├── drawings/
├── state/
└── logs/
```

`CADGPT_APPDATA_ROOT` is a development/test override only and must not point to a repository-root `appdata` folder.

## Installation and daily use

Requirements:

- Windows
- Node.js 20+
- Python 3.11–3.14
- AutoCAD for live CAD work

One-time source setup:

```bat
setup.bat
```

Common runtime commands:

```bat
run.bat status
run.bat restart
doctor.bat
acceptance.bat
```

Install/refresh the AutoCAD add-in:

```bat
cadaddin.bat
```

After setup, the Windows tray hosts the lightweight CadGPT control plane and Secure MCP tunnel.

## Runtime safety

Important invariants:

- explicit CadGPT session launch;
- execution authority comes only from the current `work_handle`;
- FILE and CAD authority remain explicit;
- one work binds one drawing;
- stale/reopened drawing lifetimes do not silently reuse old drawing authority;
- destructive CAD actions use guarded preview/execution contracts;
- work authority expires after idle timeout;
- different ChatGPT conversations do not intentionally share work authority.

## Development-only CAD MCP improvement

Source/development builds may expose `cad-mcp-dev`.

Its writable scope is limited to:

```text
runtimes/cad-mcp/**
```

It is not part of the production self-modification surface.

## Repository layout

```text
src/cadgpt/                    CadGPT orchestration/control plane
runtimes/cad-mcp/              active AutoCAD MCP runtime
addins/cadgpt-autocad/         AutoCAD dockable ChatGPT panel
resources/cad/                 bundled CAD resources / TBH Toolkit
skills/                        system authoring/development skills
knowledge/                     curated runtime/model knowledge
diagnostics/                   product error evidence
registry/                      registry contracts/docs
scripts/                       setup/build/audit/install utilities
tests/                         regression suite
```

Historical Stage 0 experiment plans and the old Revit MCP preservation area are intentionally not kept in the active CadGPT tree. Git history remains the archive for superseded implementation material.
