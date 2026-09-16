# CadGPT Product Roadmap

This roadmap defines the product-level delivery stages. Detailed implementation phases and migration commits may be smaller, but they roll up into these four stages.

## Stage 1 — Beta Build / Code Complete

Goal: produce a coherent CadGPT beta that is code-complete and reviewable **without requiring a real AutoCAD host**.

Real-AutoCAD behavior is not an exit requirement for Stage 1. Anything that can be validated by build, static checks, Windows CI, MCP smoke tests, mocks/contracts, dependency resolution, or source inspection should be completed here.

### Stage 1 scope

- single CadGPT MCP endpoint for ChatGPT;
- OpenAI Secure MCP Tunnel bootstrap/health/recovery;
- local file sandbox restricted to `lisp/**` and `jobs/**`;
- drawing-binding/session contract;
- CAD MCP read/query surface;
- guarded mutation surface;
- destructive preview/token execution guard;
- AutoLISP load/run bridge;
- `write-lisp` AutoLISP specialist skill and harness;
- AutoLISP-only language rules, TBH scaffold/style rules, Common-Lisp misuse detection;
- verified-load protocol and safe test-drawing policy;
- Job discovery/contract infrastructure, without requiring concrete business Jobs;
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
- designing concrete business Jobs such as Create XREF;
- broad feature expansion based on real-host feedback.

### Stage 1 exit gate

All of the following must be true:

```text
[ ] clean checkout has complete dependency lockfiles
[ ] npm ci succeeds on Windows CI
[ ] locked Python install succeeds on Python 3.11 Windows CI
[ ] pip check passes
[ ] TypeScript build passes
[ ] CAD MCP compile/import passes
[ ] protected MCP initialize/tools/list smoke passes
[ ] stale-session recovery smoke passes
[ ] file sandbox positive/negative tests pass
[ ] write-lisp skill/scaffold/static validation surface passes
[ ] drawing-binding and safe-test-drawing contracts are present
[ ] migration contracts pass
[ ] preserved Revit is not an active runtime dependency
[ ] setup/run/doctor/acceptance scripts parse and their non-host contracts pass
[ ] architecture and roadmap docs match the implemented design
[ ] no known architecture-level blocker remains for real-host testing
```

When this gate passes, the repository may be marked:

```text
CadGPT Beta 0.1
CODE COMPLETE
REAL-CAD VALIDATION PENDING
```

---

## Review Gate — Beta Scope Review

**This review happens after Stage 1 and before Stage 2.**

The team/user reviews the complete beta as a product and may:

- remove unnecessary tools or concepts;
- add missing core capability that should exist before host testing;
- simplify commands/tool schemas;
- tighten security boundaries;
- adjust `write-lisp` behavior/harness;
- revise diagnostics/status presentation;
- revise what is considered a core beta feature.

No real-CAD validation campaign begins until this review is complete and the Stage 2 scope is frozen.

---

## Stage 2 — Real CAD Beta Validation

Goal: validate the reviewed Beta Build on a real Windows + AutoCAD workstation.

Primary work:

- local `setup.bat` and `run.bat` validation;
- ChatGPT Developer Mode / Secure MCP Tunnel end-to-end connection;
- AutoCAD COM/host discovery;
- drawing list/bind/close/tab-switch behavior;
- read/query operations;
- reversible mutations;
- geometry transforms/copy/mirror;
- guarded destructive operations;
- real AutoLISP verified-load behavior;
- `write-lisp` test workflow on user-approved test/current drawings;
- reconnect/restart/network scenarios;
- actual TBH Toolkit migration and actual Revit preservation from trusted local clones.

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
- TBH style/scaffold refinements from the fully migrated library;
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

Concrete business Jobs and feature expansion can proceed after the core beta foundation is stable; they are not blockers for Stage 1.

---

## Current position

```text
NOW → Stage 1: Beta Build / Code Complete
       ↓
     Review Gate: add/remove/simplify features
       ↓
     Stage 2: Real CAD Beta Validation
       ↓
     Stage 3: Improve / Stabilize
       ↓
     Stage 4: Package / Release Prep
```

Current Stage 1 focus: finish reproducible installation/CI and close the remaining code/documentation gates before the Beta Scope Review.
