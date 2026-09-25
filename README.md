# CadGPT

CadGPT turns ChatGPT into a drawing-centric AutoCAD execution environment without adding another chat UI or local AI model.

```text
ChatGPT
   ⇅
OpenAI Secure MCP Tunnel
   ⇅
CadGPT slim control/admission plane
   ↓  explicit one-time session launch: literal @cadgpt OR CadGPT plugin/icon
WorkRegistration + ToolLease
   ├── FILE capability path
   └── CAD capability path
          ↓
        CAD MCP
          ↓
       AutoCAD
```

## User flow

CadGPT is drawing-workspace-first.

```text
CG plugin / @cadgpt
→ read latest tray snapshot
→ show 3-section Welcome
→ choose exactly 1 open drawing
→ start full CAD MCP
→ verify the selected drawing live
→ bind 1 drawing
→ register 1 work
→ Workspace Ready
→ natural request or registered Job
```

**Invariant: `1 work = 1 drawing`.** Multi-drawing workspace selection is not supported.

Welcome always contains:

1. **CAD** — `Offline`, or `Online` plus the open drawing list. The launcher does not display AutoCAD's active-document marker.
2. **WORKSPACE** — choose one drawing; `cg/list` refreshes from the latest tray snapshot without starting full CAD MCP.
3. **COMMANDS** — only the common shortcuts `cg/cl`, `cg/cj`, `cg/job`, and `cg/` for the full command menu.

Full fake CLI:

```text
cg/       full command menu
cg/list   refresh drawings / choose workspace
cg/cl     create or repair Lisp
cg/cj     create or repair Job
cg/job    list registered Jobs
cg/mcp    update/develop CAD MCP
cg/help   help
cg/stop   stop current work
```

`@cadgpt` is activation text, not the CLI namespace.

After the drawing is verified and bound, CadGPT reports the selected drawing and lists the Jobs currently registered in User Registry. Lisp/Job/file work uses the same single-drawing hybrid workspace; CAD MCP development remains development-only and retains its stricter authority rules.

## Product model

- ChatGPT is the reasoning/chat UI.
- CadGPT is a thin local execution/orchestration layer.
- CAD MCP is the only active CAD runtime.
- AutoCAD is never launched implicitly by CadGPT.
- Revit MCP is preserved only for possible future RevitGPT work.
- Job rules/specification are CadGPT internal knowledge; concrete Jobs are user assets.

## Admission and Windows lifecycle

The Windows tray independently runs a lightweight read-only AutoCAD probe. It does not start the full CAD MCP, create WorkRegistration, bind drawings, or grant mutation authority. The tray reports `AutoCAD: OFF` or `AutoCAD: ON · N drawings` and refreshes the probe periodically plus immediately when the tray menu opens.

The fake CLI is response-based, not live-updating. Use `cg/list` to refresh the drawing list from the newest tray snapshot after drawings are opened or closed in AutoCAD.

CadGPT launcher is context-aware:

```text
CG / @cadgpt
├─ AutoCAD not detected
│  → General Welcome
│  → SESSION READY / WORK IDLE / CAD MCP SLEEPING
│
└─ AutoCAD detected
   → CAD PREPARE (read-only)
   → list open drawings
   → ask user to confirm the CAD workspace
   → confirmation creates/reuses direct-cad WorkRegistration
   → bind selected drawings
   → CAD Work CLI + quick commands
```

Detection/prepare never launches AutoCAD, never starts full CAD MCP, and never grants mutation authority. The launcher reads the tray snapshot only. Full CAD MCP starts after workspace confirmation, then live AutoCAD is re-verified before binding.

CadGPT is explicit-launch only. The user launches CadGPT once per ChatGPT/MCP session, either with literal `@cadgpt` or by selecting/calling the CadGPT plugin/icon (the connector may be renamed, for example `CG`). That claim persists for later turns in the same session, so repeated `@cadgpt` is not required. A different chat/MCP session starts unclaimed.

```text
ChatGPT considers CadGPT
→ cadgpt_admission(exact launch turn, invocation_source)
   ├── first plugin/icon call OR bare/qualified @cadgpt → SESSION READY
   ├── no work_handle yet → WORK IDLE / CAD MCP SLEEPING
   ├── first real FILE/CAD task → cadgpt_work_start → create work_handle
   ├── later compatible tasks → reuse the same active work_handle
   ├── cg/status and cg/stop → direct control surface, no token handshake
   └── a different/unclaimed MCP session → IDLE until explicitly launched
```

There is no contextual exception for an AutoCAD-looking task, an `.lsp` file, an absolute path, AutoCAD already running, memory, or prior CadGPT use.

After one-time setup, Windows starts a **CadGPT tray host** through the current user's HKCU Run key. Idle state keeps only:

```text
CadGPT tray
slim admission/control MCP
OpenAI Secure MCP Tunnel
```

FILE capability families load only after admitted FILE work. CAD capability families load only after admitted CAD work. The Python CAD MCP backend starts only on actual CAD demand and returns to sleep after CAD work ends. AutoCAD is never launched implicitly.

The former Scheduled Task / polling wake-agent lifecycle is retired. The supported source entrypoints are now `setup.bat`, `run.bat`, the silent `cadgpt-tray.vbs` launcher, and `cadgpt-tray.ps1`; retired compatibility shims are no longer part of the active tree.

`run.bat` is a control utility (`install`, `start`, `stop`, `restart`, `status`, `uninstall`), not a daily launcher.

## Managed AppData

During Beta, AppData is repo-local. Packaged builds can move the same virtual paths to `%LOCALAPPDATA%\CadGPT` through `CADGPT_APPDATA_ROOT`.

```text
appdata/
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
├── data/
│   └── runs/
├── drawings/
├── state/
└── logs/
```

A user-selected Lisp or Job folder is an **import source only**:

```text
explicitly approved external source folder (read-only)
→ asset_import
→ managed copy in AppData
→ User Registry
```

CadGPT never writes to the external source folder. Import rejects symlinked source entries, excludes repository metadata such as `.git/.svn`, and bounds import size/file count.

After import, execution reads from the managed AppData copy. Permanent managed-library changes do **not** use generic file editing: they go through controlled draft/validation/promotion flows so the implementation and User Registry stay synchronized.

Most users need only Lisp Libraries. Job Libraries are optional for advanced/legacy CadGPT users.

Asset commands: `cg/rl` / `cg/rj` register an external folder in place; `cg/il` / `cg/ij` import by copying into AppData and indexing; `cg/el` / `cg/ej` export managed content to a user folder. Registry entries stay lightweight: identity/title/library/path/commands only; source is read when deeper understanding is actually needed.

Registered Jobs are extension-driven: `.py` is a Direct Job dispatched without model planning; `.md` is a sequential Reasoning Job that uses the per-stage READ → PLAN → REVIEW → REVISE → EXEC → READBACK loop.

## Capability Registry

CadGPT exposes one effective registry with strict ownership:

```text
Internal Registry
├─ MCP tools
└─ system skills

User Registry
├─ Lisp capabilities
└─ concrete Jobs
```

Use `registry_list` / `registry_get` to search the unified view. User Registry cannot overwrite Internal Registry because the allowed capability kinds are disjoint. User capability IDs are unique within User Registry.

Re-imported implementation content is hash-tracked. When an imported Lisp/Job implementation changes, previously trusted semantic/safety metadata is invalidated to `needs_review` rather than silently retained as curated truth.

## AutoLISP lifecycle

Lisp remains normal AutoLISP usable directly as AutoCAD commands and also discoverable/executable by CadGPT.

Import/index does not modify source. When the user explicitly asks `write-lisp` to change or repair an existing capability:

```text
User Registry discovery
→ lisp_checkout
→ appdata/workspace/lisp-draft/**
→ update/repair functionality + normalize working header/description
→ static validation
→ user-approved AutoCAD test drawing
→ verified load/runtime verification
→ lisp_promote_draft
→ managed Lisp Library + User Registry
```

Blocking syntax errors in the managed source do not prevent checkout for repair; they are reported as diagnostics and must be fixed before promotion. Helper/library Lisp files without public `c:` commands are valid when intentional and may be promoted.

`write-lisp` uses a CadGPT-native canonical scaffold. TBH Toolkit is the explicit exception: `library_id=tbh-toolkit` retains the TBH header convention. Other imported libraries are not rewritten on registration; their headers are normalized only when `write-lisp` is explicitly activated to edit them.

`ai_mode=dynamic` is not a Lisp type. It only allows CadGPT/AI to derive bounded temporary runtime variants from ordinary AutoLISP using registry-declared `dynamic_parameters`.

## Jobs

Concrete Jobs live under managed User Job Libraries in AppData and are registered in User Registry. Job rules, schema/authoring guidance and runtime semantics are internal CadGPT knowledge under `knowledge/jobs/**`.

`jobcreate` uses the same controlled working-copy principle as `write-lisp`:

```text
existing Job (optional)
→ job_checkout
→ appdata/workspace/job-draft/**
→ author/refine
→ job_draft_validate
→ explicitly approved real test
→ final-result validation
→ explicit user acceptance
→ job_promote_draft
→ managed Job Library + User Registry
```

New Jobs start directly in `appdata/workspace/job-draft/**` only after the `jobcreate` planning approval gate. `job_promote_draft` requires recorded test evidence, final-validation evidence and explicit user acceptance.

CadGPT core must remain functional with no user Job Library and no user Lisp Library configured.

## Internal resources

System skills remain under `skills/**`. Internal CAD fixtures/resources, such as the safe Lisp load smoke test, live under `resources/cad/**`; they are not user Lisp capabilities.

## Installation

Current Beta source requirements:

- Windows
- Node.js 20+
- Python 3.11–3.14
- AutoCAD for live CAD validation

One-time setup:

```bat
setup.bat
```

Setup installs locked dependencies, generates the stable CAD tool manifest, initializes managed AppData, configures the Secure MCP Tunnel, removes the legacy Scheduled Task if present, registers the silent CadGPT tray launcher under HKCU Run, starts the tray/slim runtime, and runs diagnostics.

Daily use normally requires no command.

```bat
run.bat status
run.bat restart
doctor.bat
```

## Execution isolation

Launching CadGPT claims only the current ChatGPT/MCP session; that claim is routing state, not execution authority. Real FILE/CAD work creates (or reuses) an execution-scoped WorkRegistration and opaque work_handle. Every actual capability call then receives a per-call ToolLease. Different chats, Jobs, Skills and providers therefore share implementations without sharing execution context.

CadGPT does not use global `currentJob`, `currentWorkspace`, or `currentDrawing` authority.

FILE and CAD work are separate execution paths. A workflow may use both through `execution_path=hybrid`, but FILE mutation scope and drawing scope remain explicit.

## File safety

All CadGPT file **mutations** require an explicit absolute filesystem path. Relative paths and ambient process CWD are never write authority. Mutation targets are canonicalized and verified inside the exact workflow-owned allowed root, including symlink/junction escape checks.

Generic file tools have **read** access to:

```text
appdata/libraries/**
appdata/workspace/**
appdata/data/**
```

Generic file tools have **write** access only to:

```text
appdata/workspace/**
appdata/data/**
```

`appdata/libraries/**` is permanent managed content and is read-only to generic file tools. It changes only through controlled operations such as `asset_import`, `lisp_promote_draft` and `job_promote_draft`.

External folders may be registered in place with `asset_register_external`, imported into AppData with `asset_import`, or used as export destinations with `asset_export`. Registry/runtime/state/log areas remain internal.

## Drawing binding and concurrency

Before CAD business operations, each work execution binds explicitly to one or more open drawings and receives opaque `drawing_id` values.

A binding stores a CAD-MCP runtime document-lifetime identity in addition to file name/path. Closing and reopening the same file does not silently revive an old `drawing_id`; stale bindings must be explicitly rebound.

When one execution has multiple drawings, mutation calls require an explicit `drawing_id`. AutoCAD `ActiveDocument` is never treated as ambient authority.

CAD tool implementations are shared across chats, while each invocation has its own ToolLease and drawing context. Mutation-sensitive operations are serialized per AutoCAD host so concurrent chats cannot race `ActiveDocument` switching.

## Development-only CAD MCP self-improvement

Source/development builds expose the internal `cad-mcp-dev` Skill when `CADGPT_BUILD_PROFILE=development`.

It is intentionally narrow:

```text
writable source root:
<repo>\runtimes\cad-mcp\**

read-only supporting context:
src/cg/**
knowledge/**
registry/**
selected contract/docs/generator files
```

The Skill has no unrestricted shell and no Git branch/add/commit/push/PR authority. It uses absolute-path source tools, immutable baseline snapshots, compile/import/manifest validation, controlled dependency sync, optional exclusive live candidate validation, and rollback of unaccepted source.

Adding/removing/changing a CAD MCP tool regenerates `runtimes/cad-mcp/tool-manifest.json`, which feeds CadGPT's Internal Registry/tool surface.

`cad-mcp-dev` is development-only. Production/package builds must not register or expose the Skill or its source-mutation tools.

## Development status

Stage 1 is complete. Source/CI integrity review and local Windows installation/runtime stabilization are in progress before the Human-run Stage 2 real-AutoCAD validation.

Static/CI checks do not substitute for real AutoCAD validation.


### Work idle cleanup

An active CadGPT work expires after **30 minutes of no CadGPT work/tool activity**. This prevents a closed or abandoned chat from leaving drawing/work authority alive indefinitely. Active ToolLeases are never interrupted; cleanup occurs only after the work is idle and no tool call is in flight.
