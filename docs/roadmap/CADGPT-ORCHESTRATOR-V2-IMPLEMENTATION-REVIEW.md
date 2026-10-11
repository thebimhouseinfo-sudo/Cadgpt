# CadGPT V2 — Detailed Plan Review Record

**Result: PASS (Detailed planning only, re-reviewed after HYBRID-default correction).** Date: 2026-10-11. Parent plan: GSA `J-6B01` revision 3, READY, planning review PASS. This review assesses the **detailed implementation annex** at `docs/roadmap/CADGPT-ORCHESTRATOR-V2-IMPLEMENTATION-DETAIL.md`; it does not replace the parent plan or claim CadGPT implementation PASS.

- Source baseline: `main@516efce04950a896dca71eb2652f19710063d5f7`.
- Original reviewed annex: blob `ee94b05881dc99a01819b9615c5b3254efd710f0`; **revised annex after Human correction:** blob `314f4e80c9d44c15876836baf5f57d2a4b4f0618`, on `plan/cadgpt-orchestrator-v2-detail-20261011`.
- Source files inspected: `src/cadgpt/tools/work-control.ts`, `src/cadgpt/lib/work-registration.ts`, `src/cadgpt/tools/jobs.ts`, `src/cadgpt/tools/filesystem.ts`, `src/cadgpt/tools/drawing-persistence.ts`, `src/cadgpt/lib/tool-policy.ts`, `src/cadgpt/lib/lisp-path-policy.ts`, `src/cadgpt/tools/job-system-helper.ts`; GSA `J-6B01` and original CR finding disposition.

## Review loop

| Round | Verdict | Findings / fixes | Evidence |
| --- | --- | --- | --- |
| Draft | CHANGES_REQUIRED | Handle legitimate CAD-only → **metadata-only** Temp by a controlled CAD→HYBRID successor; define approved field/handle patch constraints; show exact lazy scan hooks; fix escaped Markdown inline-code | `f0ab446ea3d642e3932dbd00d72b1d6650583c35` |
| Revised | CHANGES_REQUIRED | `tools/*.py` helpers are **not** automatically invocable: `job_system_run_helper` requires a Job SYSTEM lease and Job runtime. Keep helper unavailable unless an independently scoped executor exists | `3018ac9963f78405e2fa9a96f1c416da824f1f56` |
| Original final | PASS (superseded assumption) | Source-grounded plan for explicit FILE/CAD/HYBRID paths; later Human requirement simplified normal Work selection | `ee94b05881dc99a01819b9615c5b3254efd710f0` |
| Human correction | CHANGES_REQUIRED | **All Work default HYBRID**, not only Job Work; remove new CAD-only→HYBRID Temp transition. Current non-Job work resolver requires execution_path | `src/cadgpt/tools/work-control.ts` |
| Re-reviewed amendment | **PASS — detailed plan** | A4 changes default resolver for all owners, preserves explicitly chosen FILE/CAD exceptions; 18 test scenarios include non-Job omitted execution_path, zero unnecessary mode transitions | `314f4e80c9d44c15876836baf5f57d2a4b4f0618` |

## Source-derived execution walkthrough

These are **control-path/precondition simulations** derived from the source code, not executions of compiled CadGPT or the AutoCAD add-in.

| ID | Simulated input | Present-source constraint | Reviewed V2 route |
| --- | --- | --- | --- |
| M01 | Default Work, CAD-only task | New Work will default HYBRID | Use CAD MCP only for requested action, keep HYBRID Work |
| M02 | Default Work, metadata-only task | New Work will default HYBRID | Use FILE tools only for requested action, keep HYBRID Work |
| M03 | Explicit/legacy FILE Work, CAD now needed | Existing FILE→HYBRID upgrade with replacement handle | Keep `cadgpt_work_upgrade` for backward compatibility |
| M04 | Explicit/legacy CAD-only Work | Existing CAD Work intentionally excludes FILE tools | Preserve exception semantics; do not add a new Temp-specific CAD→HYBRID transition |
| M05 | HYBRID Work, any Temp or Builder task | Both families permitted | Reuse same HYBRID handle; no path selection/transition |
| M06 | Borrow one Custom Job subtool | Full Job start releases prior Job authority | Use callable subtool dispatcher, not `job_run_direct` |
| M07 | Read cached drawing metadata | `drawing_metadata_location` activates CAD | FILE fast path only when verified identity is valid |
| M08 | Patch cross-Job result | Generic drawing-root permission may be broader than one field | Dedicated typed patch with CAS and canonical anchor |
| M09 | Reuse Job Python helper | `job_system_run_helper` requires SYSTEM lease and runtime | Not exported until independently executable; do not fake a Job |
| M10 | Explicit CAD-only attempts FILE tool | Work family gate denies correctly | Designed refusal; NOT a CR defect |
| M11 | Non-Job `cadgpt_work_start` with omitted `execution_path` | Current `resolveWorkExecutionPath` throws `EXECUTION_PATH_REQUIRED` | A4 must default to HYBRID for all owner types; explicit FILE/CAD stays an exception |

**Result:** 10/10 source constraints map to explicit behavior/implementation/test routes. This **does not mean** those 10 behaviors already PASS in production; A1–A4 are still to be implemented.

## Plan acceptance checks

Post-correction plan checks: all Work modes default to HYBRID, with explicit FILE/CAD exceptions still protected; A4 no longer introduces a CAD-only→HYBRID Temp feature. Revised annex has **18 scenario tests**, including omitted `execution_path` for non-Job Work. Other coverage remains: pinned baseline; six phases; metadata fast path fail-closed; Python helper SYSTEM lease limitation; no whole-Job dispatch for a subtool; bounded CAS patch; strict execution tool-call traces; host-only acceptance checkpoint; truthful source versus AutoCAD evidence.

No open actionable **planning** finding remains. The invalid CR suggestion to allow CAD-only to call `file_*`/`job_*` was withdrawn after user correction, not implemented.

## Implementation verification still required

1. Real code implementation in a new branch and executable simulation/unit tests against the compiled modules.
2. Run `npm run build`, `npm test` and applicable `npm run test:lisp-syntax`, with actual outputs.
3. Verify zero extra CAD scan/tool calls for the metadata-complete case and no Job transition for Temp dispatch.
4. Host-only `checkpoint-cadgpt-v2-host-final` on Windows AutoCAD: mark `PASS_RETEST_REQUIRED` until observed.

**Final verdict after Human correction:** **PASS — revised detailed plan describes the necessary source change to make HYBRID the default for all Work, and removes the unnecessary Temp CAD-only→HYBRID feature.** This is planning/review only; currently deployed non-Job Work still requires explicit execution_path until A4 is implemented and tested. No main/runtime changes were made.
