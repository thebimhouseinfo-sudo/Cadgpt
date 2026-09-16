# CadGPT

CadGPT turns ChatGPT into a drawing-centric AutoCAD execution environment without adding another chat UI or local AI model.

```text
ChatGPT
   ⇅
OpenAI Secure MCP Tunnel
   ⇅
CadGPT
   ↓
Jobs + Skills
   ↓
CAD MCP
   ↓
AutoCAD
```

## Product model

- ChatGPT is the reasoning/chat UI.
- CadGPT is a thin local execution/orchestration layer.
- CAD MCP is the only active CAD runtime.
- AutoCAD is never launched implicitly by CadGPT.
- Revit MCP is preserved only for possible future RevitGPT work.
- Jobs describe repeatable CAD workflows; concrete Job redesign is intentionally deferred until the core is stable.

## Background-agent lifecycle

CadGPT behaves more like a lightweight per-user driver than a daily-launched application.

After one-time setup:

```text
Windows logon
→ tiny hidden wake-agent + Secure MCP Tunnel ON
→ full CadGPT MCP OFF
→ CAD MCP OFF

first ChatGPT call to CadGPT
→ full CadGPT MCP ON
→ if acad.exe is running, CAD MCP ON

acad.exe closes
→ CAD MCP OFF
```

AutoCAD being open by itself never wakes the full CadGPT core. The public CAD tool descriptors remain stable while the CAD backend sleeps so ChatGPT does not need tool-list churn merely because AutoCAD opens/closes.

`run.bat` is a control utility (`install`, `start`, `stop`, `restart`, `status`, `uninstall`), not something users should need to launch every day.

## AppData

CadGPT keeps generated/user runtime data separate from permanent source.

During Beta the AppData root intentionally lives inside the repository:

```text
appdata/
├── data/
│   └── runs/
├── lisp-draft/
├── runtime/
│   └── dynamic-lisp/
├── state/
└── logs/
```

`CADGPT_APPDATA_ROOT` abstracts this location. Packaged builds can move the same virtual `appdata/...` paths to a per-user location such as `%LOCALAPPDATA%\CadGPT` without changing capability/tool contracts.

Only `appdata/data/**` and `appdata/lisp-draft/**` are exposed through general file tools. Runtime/state/log areas remain internal.

## AutoLISP lifecycle

`lisp/**` is the permanent reusable AutoLISP library. New/substantial work goes through a draft first:

```text
semantic registry discovery
→ appdata/lisp-draft/**
→ AutoLISP/TBH static validation
→ user-approved AutoCAD test drawing
→ verified load / runtime test
→ lisp_promote_draft
→ permanent lisp/** + semantic registry update
```

`write-lisp` is a specialized AutoLISP/Visual LISP capability, not a generic Lisp/software-engineering agent. Its harness explicitly rejects recognizable Common Lisp constructs and follows the TBH library presentation/scaffold.

Parameterized/session-only Lisp can live under `appdata/runtime/dynamic-lisp/**` and be verified-loaded directly without mutating the permanent template/library.

## Semantic capability registry

Use `registry_list` / `registry_get` to discover what existing Lisp/tools actually do. Lisp filenames/command names may be personal or historical and are not treated as reliable semantic descriptions.

Permanent Lisp registry entries include functional class/subclass, static/dynamic type, interaction, load behavior, mutation/destructive risk, inputs, effects, dynamic parameters, and implementation caveats.

Every user-facing permanent `.lsp` under `lisp/**` must be catalogued. Drafts are excluded until promotion.

## Installation

Requirements for the current Beta source build:

- Windows
- Node.js 20+
- Python 3.11.x
- AutoCAD for Stage 2/live CAD validation

One-time setup:

```bat
setup.bat
```

Setup installs locked Node/Python dependencies, generates the stable CAD tool manifest, initializes Beta AppData, configures the Secure MCP Tunnel, installs the hidden per-user background task, and runs diagnostics.

Daily use normally requires no command.

Useful controls:

```bat
run.bat status
run.bat restart
doctor.bat
```

`acceptance.bat` is reserved for real Windows + AutoCAD acceptance work in Stage 2.

## File safety

Permanent editable source roots:

```text
lisp/**
jobs/**
```

Editable AppData roots:

```text
appdata/data/**
appdata/lisp-draft/**
```

The file sandbox uses lexical containment plus realpath/symlink checks. Generic arbitrary filesystem/shell/package-manager access is not part of normal CadGPT capability.

## Drawing binding

Before CAD business operations, CadGPT binds explicitly to one drawing identity. AutoCAD tab switching does not silently retarget a session. Proxied CAD tools re-establish the bound drawing before execution.

## Development status

Stage 1 — Beta Build / Code Complete is complete.

Current work is the **Beta Scope Review**: simplify/add/remove features and tighten contracts before starting Stage 2 real-AutoCAD validation.

No claim is made yet that the current Beta Review branch has completed live Windows + AutoCAD lifecycle validation.
