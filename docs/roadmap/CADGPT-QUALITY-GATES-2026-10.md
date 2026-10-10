# CadGPT Quality Roadmap — CI Gate Refresh (October 2026)

Status: **active working roadmap**, adopted to supersede obsolete pre-migration Beta Build Gate assumptions.

## Baseline

- Canonical code: `main`; feature/CI fixes use one bounded branch then return to `main`.
- CadGPT works on a real AutoCAD host at the user's workstation. Do not change
  drawing binding, CAD MCP, or install scripts merely to satisfy stale textual markers.
- User data and draft jobs live under `%LOCALAPPDATA%\CadGPT`
  (or an explicit **external** `CADGPT_APPDATA_ROOT` for CI/dev).
  Repository-local `appdata/` is deliberately forbidden.
- `setup.bat` delegates to `scripts/setup-core.bat`, which provisions
  AppData, installs pinned Node/Python dependencies, builds, runs tests,
  configures tunnel, and invokes `run.bat install`. The latter registers
  the hidden `cadgpt-tray.vbs` Windows Startup launcher.

## Active quality gates

| Gate | Proof | Failure action |
| --- | --- | --- |
| Core CI | Node build/unit; CAD MCP Python 3.11/3.14; add-in tests; runtime smoke | Block |
| Registry Contract | Actual registry interface and tool surface | Block |
| Authoring Integrity | Dedicated external CI AppData; create User libraries; promote, checkout, validate Job and Lisp; reject unauthorized permanent writes | Block |
| Runtime Roadmap Gate (formerly Beta Build Gate) | Installed dependency manifests, launcher/source topology, external managed AppData, import/index/checkout/validate through live slim MCP | Block |
| Local Acceptance | Parse launch scripts and verify actual delegation to setup-core + hidden per-user tray startup + non-mutating Lisp smoke | Block |

A gate may be replaced only with an equal-or-stronger test of the **current
behavior**. Never add a missing placeholder file or weaken a negative control
only to make the pipeline green. Reviewer must read test scripts together
with production code at appropriate checkpoints; not every commit.

## Upcoming checkpoints (separate scope from CI drift)

1. **CP-SEC:** Secure SYSTEM Python Job helpers; verify Excel ZIP contents,
   formulas and writer ownership on real workbook fixtures.
2. **CP-CAD:** Confirm `HandleToObject`-first lookups and no silently omitted
   COM failures using real AutoCAD acceptance.
3. **CP-LAT:** Instrument RPC queue, drawing activation and Job/CAD lock;
   optimize only against measured baseline.
4. **CP-REC:** Verify add-in sleep/wake, header states, session recovery and
   single Startup owner on real Windows workstation.
5. **CP-MTO:** Re-test PDF/DWG/Hybrid MTO and existing Excel schedule
   reconciliation; promote only after explicit user acceptance.

These checkpoints are NOT implicitly implemented by a green CI gate.
They require their own tests, review, and user acceptance before merge
when implementation changes are requested.

## Evidence policy

- Record source commit, exact failed step and real cause; distinguish test
  drift from production regressions.
- Require a negative control where security/boundary logic is exercised.
- Functional integration smoke must run with a real MCP process and external
  throwaway AppData (never the user's AutoCAD/drawing workspace).
- A read-only audit of production code is not a benchmark of latency or
  a proof of safety against arbitrary Python job code.
