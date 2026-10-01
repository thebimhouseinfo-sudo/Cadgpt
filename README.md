# CadGPT

**Status: Beta complete / temporarily frozen**

CadGPT turns ChatGPT into a drawing-centric AutoCAD execution environment without adding another chat UI or local AI model.

```text
ChatGPT
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

ChatGPT is the reasoning surface. CadGPT provides controlled local execution, drawing binding, AutoLISP/Job orchestration, registry discovery, diagnostics, and the CAD MCP bridge.

## Current Beta contract

- explicit launch through the CadGPT/CG plugin or literal `@cadgpt` / `@cg`;
- one work binds one drawing;
- current CAD facts are always read fresh from the bound drawing;
- when CG is active with a bound drawing, requests such as **draw / redraw / create / add / modify / vẽ / vẽ lại / tạo / sửa** default to modifying the AutoCAD drawing, not generating an external image;
- image generation is used only when the user explicitly asks for an image/render/illustration outside AutoCAD;
- AutoCAD is never launched implicitly;
- CAD MCP sleeps until actual CAD demand;
- managed user/runtime state lives under `%LOCALAPPDATA%\CadGPT`;
- production runtime does not self-modify CAD MCP source;
- Revit MCP is preserved only as inactive source material for the future **RevitGPT** project.

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

A bound workspace follows the invariant:

```text
1 work = 1 drawing
```

CadGPT never treats ambient AutoCAD `ActiveDocument` as authority.

## Fake CLI

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

## CAD intent and live state

While CadGPT is active with a drawing workspace:

- drawing/editing language targets the bound AutoCAD drawing by default;
- an attached image can be used as a visual/geometric reference for CAD work;
- the attachment does not change the output destination to image generation;
- layer counts, entity counts, geometry, properties, selections, and other current-state questions require a fresh CAD read in the same turn;
- conversation history is never treated as live CAD state.

The curated rules used by ChatGPT are stored in:

```text
knowledge/cad/WORKING_KNOWLEDGE.md
```

## Diagnostics and product improvement

Real product failures and incorrect behavior are accumulated separately from model knowledge:

```text
diagnostics/cad/ERROR_LOG.md
```

Use this log for:

- tool/runtime failures;
- wrong model routing;
- latency regressions;
- workarounds;
- unexpected CAD behavior;
- other defects discovered during real use.

The error log is product evidence for future CadGPT improvement. It does **not** automatically change model behavior.

Only stable CAD operating knowledge should be promoted into `knowledge/cad/WORKING_KNOWLEDGE.md`.

## Internal and User Registry

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

TBH Toolkit is bundled internal content under:

```text
resources/cad/internal-lisp/tbh-toolkit
```

The official Internal Direct Job `tbh` loads:

```text
resources/cad/internal-lisp/tbh-toolkit/tbhloader.lsp
```

TBH commands are already known by Internal Registry.

Per drawing:

```text
tbhloader.lsp load success → TBH = ON
tbhloader.lsp load failure → TBH = OFF
```

The Job does not dynamically re-register the toolkit commands. A failed Internal Direct Job is surfaced as a failure rather than bypassed with lower-level tools.

## AutoLISP

Lisp remains normal AutoLISP usable directly in AutoCAD and discoverable through CadGPT.

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

- **Direct Jobs** — execute through fixed local implementations without model planning;
- **Reasoning Jobs** — sequential READ → PLAN → REVIEW → EXEC → READBACK workflows.

Official Internal Direct Jobs use bounded built-in executors.

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

Beta source requirements:

- Windows
- Node.js 20+
- Python 3.11–3.14
- AutoCAD for live CAD work

One-time setup:

```bat
setup.bat
```

Common maintenance commands:

```bat
run.bat status
run.bat restart
doctor.bat
acceptance.bat
```

After setup, the Windows tray hosts the lightweight CadGPT control plane and Secure MCP tunnel.

## Runtime safety

Important invariants:

- explicit CadGPT session launch;
- execution authority comes only from the current `work_handle`;
- file mutation requires canonical absolute paths inside approved roots;
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

## Preserved Revit MCP

The inactive Revit source mirror is intentionally retained at:

```text
preserved/revit-mcp/
```

CadGPT does not import, start, build, or expose it.

It is preserved as source material for the next project: **RevitGPT**.

## Repository areas

```text
src/cadgpt/                    CadGPT orchestration/control plane
runtimes/cad-mcp/              active AutoCAD MCP runtime
resources/cad/                 bundled CAD resources / TBH Toolkit
skills/                        system authoring/development skills
knowledge/                     curated runtime/model knowledge
diagnostics/                   product error evidence
registry/                      registry contracts/docs
tests/                         regression suite
preserved/revit-mcp/           inactive Revit source for RevitGPT
```

## Beta closure

The current CadGPT Beta has passed the working real-AutoCAD flows exercised during development, including drawing binding/continuity, live CAD reads, AppData productionization, Internal Registry/TBH Direct Job behavior, and current CI/registry contracts.

CadGPT development is now **temporarily frozen**. Future CadGPT defects should be recorded in `diagnostics/cad/ERROR_LOG.md` for a later improvement cycle.

The next planned project is **RevitGPT**, using the preserved Revit MCP only as source material rather than activating it inside CadGPT.
