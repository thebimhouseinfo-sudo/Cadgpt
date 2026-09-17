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
- Job rules/specification are CadGPT internal knowledge; concrete Jobs are user assets.

## Background-agent lifecycle

CadGPT behaves like a lightweight per-user driver. After one-time setup, a tiny hidden wake-agent + Secure MCP Tunnel start at Windows logon. Full CadGPT wakes on the first ChatGPT call. CAD MCP runs only while CadGPT is active and AutoCAD is running. AutoCAD alone never wakes CadGPT.

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
├── state/
└── logs/
```

A user-selected Lisp or Job folder is an **import source only**:

```text
explicitly approved external source folder (read-only)
→ library_import
→ managed copy in AppData
→ User Registry
```

CadGPT never writes to the external source folder. Import rejects symlinked source entries, excludes repository metadata such as `.git/.svn`, and bounds import size/file count.

After import, execution reads from the managed AppData copy. Permanent managed-library changes do **not** use generic file editing: they go through controlled draft/validation/promotion flows so the implementation and User Registry stay synchronized.

Most users need only Lisp Libraries. Job Libraries are optional for advanced/legacy CadGPT users.

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
- Python 3.11.x
- AutoCAD for live CAD validation

One-time setup:

```bat
setup.bat
```

Setup installs locked dependencies, generates the stable CAD tool manifest, initializes managed AppData, configures the Secure MCP Tunnel, installs the hidden background task and runs diagnostics.

Daily use normally requires no command.

```bat
run.bat status
run.bat restart
doctor.bat
```

## File safety

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

`appdata/libraries/**` is permanent managed content and is read-only to generic file tools. It changes only through controlled operations such as `library_import`, `lisp_promote_draft` and `job_promote_draft`.

External user folders are not generic file-tool roots. `library_import` is the controlled read/copy boundary. Registry/runtime/state/log areas remain internal.

## Drawing binding

Before CAD business operations, CadGPT binds explicitly to one drawing identity. AutoCAD tab switching does not silently retarget a session. Proxied CAD tools re-establish the bound drawing before execution.

## Development status

Stage 1 — Beta Build / Code Complete is complete. Current work remains Beta Scope Review before Stage 2 real-AutoCAD validation. Beta Scope Review includes closing authoring-integrity gaps so permanent libraries, User Registry metadata and tested drafts cannot drift from one another.
