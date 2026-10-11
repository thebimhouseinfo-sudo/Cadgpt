# CadGPT V2 — Detailed Plan Review Record

**Result: PASS (Detailed planning only).** Date: 2026-10-11. Parent plan: GSA `J-6B01` revision 3, READY, planning review PASS. This review assesses the **detailed implementation annex** at `docs/roadmap/CADGPT-ORCHESTRATOR-V2-IMPLEMENTATION-DETAIL.md`; it does not replace the parent plan or claim CadGPT implementation PASS.

- Source baseline: `main@516efce04950a896dca71eb2652f19710063d5f7`.
- Detailed annex reviewed: blob `ee94b05881dc99a01819b9615c5b3254efd710f0`, on `plan/cadgpt-orchestrator-v2-detail-20261011`.
- Source files inspected: `src/cadgpt/tools/work-control.ts`, `src/cadgpt/lib/work-registration.ts`, `src/cadgpt/tools/jobs.ts`, `src/cadgpt/tools/filesystem.ts`, `src/cadgpt/tools/drawing-persistence.ts`, `src/cadgpt/lib/tool-policy.ts`, `src/cadgpt/lib/lisp-path-policy.ts`, `src/cadgpt/tools/job-system-helper.ts`; GSA `J-6B01` and original CR finding disposition.

## Review loop

| Round | Verdict | Findings / fixes | Evidence |
| --- | --- | --- | --- |
| Draft | CHANGES_REQUIRED | Handle legitimate CAD-only → **metadata-only** Temp by a controlled CAD→HYBRID successor; define approved field/handle patch constraints; show exact lazy scan hooks; fix escaped Markdown inline-code | `f0ab446ea3d642e3932dbd00d72b1d6650583c35` |
| Revised | CHANGES_REQUIRED | `tools/*.py` helpers are **not** automatically invocable: `job_system_run_helper` requires a Job SYSTEM lease and Job runtime. Keep helper unavailable unless an independently scoped executor exists | `3018ac9963f78405e2fa9a96f1c416da824f1f56` |
| Final | **PASS** | Plan distinguishes CAD / FILE / HYBRID, contains valid first-use capability export, strict Custom Job execution, scoped metadata mutation and Builder continuity; no new Temp Job runtime or global permission bypass | `ee94b05881dc99a01819b9615c5b3254efd710f0` |

## Source-derived execution walkthrough

These are **control-path/precondition simulations** derived from the source code, not executions of compiled CadGPT or the AutoCAD add-in.

| ID | Simulated input | Present-source constraint | Reviewed V2 route |
| --- | --- | --- | --- |
| M01 | CAD Work, CAD-only task | CAD family permitted | Reuse CAD Work/CAD MCP |
| M02 | FILE Work, metadata task | FILE family permitted | Reuse FILE Work |
| M03 | FILE Work, CAD now needed | Existing FILE→HYBRID upgrade with replacement handle | Use `cadgpt_work_upgrade` |
| M04 | CAD Work, metadata-only Temp | Existing upgrade rejects CAD→HYBRID | Implement controlled successor; don't violate FILE gate |
| M05 | HYBRID Work, mixed task | Both families permitted | Reuse HYBRID |
| M06 | Borrow one Custom Job subtool | Full Job start releases prior Job authority | Use callable subtool dispatcher, not `job_run_direct` |
| M07 | Read cached drawing metadata | `drawing_metadata_location` activates CAD | FILE fast path only when verified identity is valid |
| M08 | Patch cross-Job result | Generic drawing-root permission may be broader than one field | Dedicated typed patch with CAS and canonical anchor |
| M09 | Reuse Job Python helper | `job_system_run_helper` requires SYSTEM lease and runtime | Not exported until independently executable; do not fake a Job |
| M10 | CAD-only attempts FILE tool | Work family gate denies correctly | Designed refusal; NOT a CR defect |

**Result:** 10/10 source constraints map to explicit behavior/implementation/test routes. This **does not mean** those 10 behaviors already PASS in production; A1–A4 are still to be implemented.

## Plan acceptance checks

12/12 checks PASS on reviewed annex: pinned baseline; six phased scope; 17 scenario tests; CAD-only rights unchanged; metadata fast path fail-closed; Python helper SYSTEM lease limitation; FILE→HYBRID and CAD→HYBRID differentiation; no whole Job dispatch for a subtool; bounded CAS patch; strict execution tool-call tests; host-only acceptance checkpoint; truthful source versus AutoCAD evidence.

No open actionable **planning** finding remains. The invalid CR suggestion to allow CAD-only to call `file_*`/`job_*` was withdrawn after user correction, not implemented.

## Implementation verification still required

1. Real code implementation in a new branch and executable simulation/unit tests against the compiled modules.
2. Run `npm run build`, `npm test` and applicable `npm run test:lisp-syntax`, with actual outputs.
3. Verify zero extra CAD scan/tool calls for the metadata-complete case and no Job transition for Temp dispatch.
4. Host-only `checkpoint-cadgpt-v2-host-final` on Windows AutoCAD: mark `PASS_RETEST_REQUIRED` until observed.

**Final verdict:** **PASS — detailed plan is implementable and source-aligned; no main/runtime/source behavior was changed by this review.**
