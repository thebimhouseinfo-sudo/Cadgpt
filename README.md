# CadGPT

CadGPT is a thin local execution layer that lets ChatGPT work with AutoCAD through a single MCP connection.

CadGPT does **not** provide its own chat UI or local AI model. ChatGPT is the reasoning/UI layer. The local runtime provides controlled access to AutoCAD, CAD Jobs, and AutoLISP assets.

## Architecture

```text
ChatGPT
   |
   | Developer Mode / custom MCP app
   v
OpenAI Secure MCP Tunnel
   |
   v
CadGPT local MCP (127.0.0.1)
   |-- file tools -> lisp/**, jobs/** only
   |-- drawing binding/session
   `-- CAD MCP -> AutoCAD
```

`runtimes/cad-mcp/` is the only active execution runtime in CadGPT.

## Requirements

- Windows
- Node.js 20 or newer
- Python 3.11 or newer
- AutoCAD for live CAD operations
- ChatGPT account/workspace with Developer Mode and the required custom MCP permissions
- OpenAI Secure MCP Tunnel ID + Runtime API key

## One-time setup

Run:

```bat
setup.bat
```

Setup will:

1. validate Node.js and Python;
2. install/build the CadGPT connector;
3. create the isolated `.venv-cad` environment;
4. install CAD MCP dependencies;
5. configure the OpenAI Secure MCP Tunnel and a private local MCP path token;
6. start CadGPT;
7. run `doctor.bat`.

After the tunnel is configured, enable ChatGPT Developer Mode and add/select the CadGPT tunnel connection once.

Secrets and generated tunnel profiles are local-only (`.env`, `profiles/*.yaml`) and are ignored by Git.

## Daily use

Run:

```bat
run.bat
```

`run.bat` starts the local CadGPT MCP service, waits until it is healthy, starts the Secure MCP Tunnel, and waits for the tunnel `/readyz` health check before reporting success.

AutoCAD may be opened before or after CadGPT. CAD availability is reported separately from ChatGPT/tunnel health.

## Diagnostics

Run:

```bat
doctor.bat
```

Doctor checks the local environment, dependency versions, file roots, CAD MCP import, CadGPT HTTP health, Secure MCP Tunnel configuration/health, tunnel-client doctor result, and reports whether AutoCAD COM is currently reachable.

## Pre-EXE local acceptance

Before packaging CadGPT as an EXE, run the real-host acceptance gate on the intended Windows/AutoCAD machine:

```bat
acceptance.bat
```

The acceptance gate verifies the proven BAT/runtime contract rather than simulating AutoCAD in CI. It checks:

1. `run.bat` startup;
2. `doctor.ps1`;
3. protected MCP session/tool discovery;
4. live AutoCAD drawing discovery;
5. creation and binding of a **new unsaved blank test drawing**;
6. verified AutoLISP load using `lisp/_cadgpt-system/CADGPT_LOAD_SMOKE.lsp`;
7. safe no-op AutoLISP command dispatch.

The acceptance script never chooses an existing project drawing for mutation. The blank test drawing is intentionally left unsaved and should be closed manually after the test.

If AutoCAD cannot create a new drawing programmatically on a particular host, the write-lisp workflow must fall back to asking the user to open a blank/test drawing manually; it must not silently use the project drawing.

CI validates source/build/tool-surface behavior, but this local acceptance gate is the authority for COM/AutoCAD/tunnel behavior that requires the real host.

## Local file boundary

ChatGPT file tools are restricted by default to:

```text
lisp/**
jobs/**
```

Paths outside these roots, including traversal attempts, are rejected. There is no generic full-disk file access.

## Drawing binding

CadGPT does not treat AutoCAD `ActiveDocument` as the session target. A ChatGPT MCP session explicitly binds one open drawing. CAD operations exposed through CadGPT must re-establish that bound drawing before execution so changing AutoCAD tabs does not silently retarget the session.

## AutoLISP testing rule

Changed production AutoLISP is not complete after static validation alone. Before handoff it must pass a real AutoCAD load test.

When `write-lisp` is ready to test, it asks whether to:

- create/use a new blank test drawing; or
- test on the currently bound drawing.

Testing on the current drawing requires explicit user choice. If the command requires manual selections, points, dialogs, or prompts, CadGPT stops after verified load and asks the user to test the command manually in the chosen test drawing.

## Development status

The project is being migrated from `CAD-Agent` incrementally. Existing CAD skills and TBH Toolkit assets may be carried over temporarily to preserve working behavior before later cleanup. Concrete CAD Job redesign is intentionally deferred until the core connector/runtime is stable.
