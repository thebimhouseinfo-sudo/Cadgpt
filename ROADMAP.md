# CadGPT Product Roadmap

This roadmap defines the product-level delivery stages. Detailed implementation phases and migration commits may be smaller, but they roll up into these four stages.

## Stage 1 — Beta Build / Code Complete

Goal: produce a coherent CadGPT beta that is code-complete and reviewable **without requiring a real AutoCAD host**.

Real-AutoCAD behavior is not an exit requirement for Stage 1. Anything that can be validated by build, static checks, Windows CI, MCP smoke tests, mocks/contracts, dependency resolution, or source inspection should be completed here.

### Stage 1 scope

- single CadGPT MCP endpoint for ChatGPT;
- OpenAI Secure MCP Tunnel bootstrap/health/recovery;
- managed AppData model with narrow generic file access;
- permanent managed Lisp/Job libraries isolated from generic writes;
- drawing-binding/session contract;
- CAD MCP read/query surface;
- guarded mutation surface;
- destructive preview/token execution guard;
- AutoLISP load/run bridge;
- `write-lisp` AutoLISP specialist skill and harness;
- controlled Lisp draft/validate/promote lifecycle;
- AutoLISP-only language rules, TBH scaffold/style rules, Common-Lisp misuse detection;
- verified-load protocol and safe test-drawing policy;
- Job discovery/contract infrastructure;
- `jobcreate` planning/authoring skill plus controlled Job draft/validate/promote lifecycle;
- `setup.bat`, `run.bat`, `doctor.bat`, `acceptance.bat` contracts;
- reproducible Node/Python dependency locks;
- migration tooling for TBH Toolkit and preserved Revit source;
- CI and smoke gates that do not require AutoCAD;
- current architecture/migration/product documentation.

### Stage 1 non-goals

- proving COM behavior against a real AutoCAD installation;
- executing real CAD mutations on project files;
- validating AutoCAD-version-specific behavior;
- production EXE packaging;
- completing a broad catalog of concrete business Jobs;
- broad feature expansion based on real-host feedback.

### Stage 1 exit gate

Stage 1 is complete. Its code-complete gate established the beta foundation without claiming real-host proof.

```text
[x] reproducible Node/Python dependency locks
[x] Windows build/compile/static gates
[x] protected MCP initialize/tools/list smoke
[x] stale-session recovery contract
[x] managed AppData/file sandbox contract
[x] write-lisp skill/scaffold/static validation surface
[x] drawing-binding and safe-test-drawing contracts
[x] migration contracts
[x] preserved Revit excluded from active runtime dependency
[x] setup/run/doctor/acceptance non-host contracts
[x] coherent background wake-agent + stable MCP surface
```

Repository state after Stage 1:

```text
CadGPT Beta 0.1 foundation
CODE COMPLETE FOR REVIEW
REAL-CAD VALIDATION PENDING
```

---

## Review Gate — Beta Scope Review

**Current stage. This review happens after Stage 1 and before Stage 2.**

The Beta Scope Review is allowed to change core beta behavior when a completed implementation exposes an architectural or integrity gap. Current review focus includes:

- remove unnecessary tools or concepts;
- add missing core capability that should exist before host testing;
- simplify commands/tool schemas;
- tighten security boundaries;
- ensure permanent managed libraries cannot bypass draft/validate/promote lifecycles;
- ensure User Registry metadata cannot silently drift from re-imported implementation;
- ensure `write-lisp` supports repair and helper-library files consistently;
- ensure `jobcreate` has an executable draft/validate/promote path rather than documentation-only semantics;
- revise diagnostics/status presentation;
- keep architecture/product docs synchronized with the implemented AppData/background-agent model.

No real-CAD validation campaign begins until this review is complete and the Stage 2 scope is frozen.

### Beta Scope Review exit gate

```text
[ ] generic file tools cannot mutate permanent managed libraries
[ ] Lisp repair checkout works while promotion remains strict
[ ] helper-only Lisp can follow the same managed promotion lifecycle
[ ] Lisp/Job promotion verifies an existing enabled target library
[ ] Job checkout/validate/promote tools are present and registered
[ ] Job promotion records real-test/final-validation evidence and explicit user acceptance
[ ] library re-import is rollback-safe across managed content + manifest + User Registry
[ ] changed re-imported implementation invalidates stale trusted semantics
[ ] import source approval, symlink/repository-metadata and size boundaries are enforced
[ ] CI covers the authoring-integrity contracts above
[ ] README/roadmap/implementation docs describe the same architecture
```

---

## Stage 2 — Real CAD Beta Validation

Goal: validate the reviewed Beta Build on a real Windows + AutoCAD workstation.

Primary work:

- local `setup.bat` and background-agent lifecycle validation;
- ChatGPT Developer Mode / Secure MCP Tunnel end-to-end connection;
- AutoCAD COM/host discovery;
- drawing list/bind/close/tab-switch behavior;
- read/query operations;
- reversible mutations;
- geometry transforms/copy/mirror;
- guarded destructive operations;
- real AutoLISP verified-load behavior;
- `write-lisp` repair/create/test/promotion workflow on user-approved test/current drawings;
- `jobcreate` Job test/promotion workflow on user-approved test contexts;
- reconnect/restart/network scenarios;
- actual TBH Toolkit runtime validation against trusted local managed copies.

Stage 2 discovers real-host defects. It is not the packaging stage.

---

## Stage 3 — Improve / Stabilize

Goal: fix and harden what Stage 2 exposes.

Typical work:

- COM/RPC busy handling;
- AutoCAD-version differences;
- reconnect/backoff/startup races;
- stale processes/ports/sessions;
- drawing identity edge cases;
- LISP load/runtime error evidence;
- validator false positives/false negatives;
- Job runtime edge cases exposed by real workflows;
- TBH style/scaffold refinements from the fully validated library;
- clearer status/doctor/error recovery;
- regression tests for every real-host defect found.

Exit state:

```text
CadGPT Beta Stable
```

---

## Stage 4 — Packaging / Release Prep

Goal: package the already-proven BAT/runtime contract without changing architecture.

Only after Stage 3 is stable:

- freeze `setup.bat` and `run.bat` behavior;
- choose Node/Python bundling vs prerequisites;
- create `CadGPT-Setup.exe`;
- create `CadGPT.exe` launcher;
- installer/uninstaller;
- configuration/secrets storage;
- versioning/upgrade path;
- signing if required;
- clean-machine install/uninstall/reinstall validation.

Concrete business Jobs and feature expansion can continue after the core beta foundation is stable; they are not prerequisites for starting real-host validation unless they are specifically needed as validation fixtures.

---

## Current position

```text
Stage 1: Beta Build / Code Complete          ✓
                 ↓
NOW → Beta Scope Review: integrity + simplify
                 ↓
Stage 2: Real CAD Beta Validation
                 ↓
Stage 3: Improve / Stabilize
                 ↓
Stage 4: Package / Release Prep
```

Current focus: close authoring/library/registry integrity findings, align CI/docs, then freeze the Stage 2 real-AutoCAD validation scope.
