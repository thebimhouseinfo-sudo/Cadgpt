# CadGPT Integrated Implementation Plan — Draft revision 4 (for CR)
Date: 2026-10-10
Canonical baseline: main @ 8e21ef3ae3bd4b9102aeb8f09531a06638ee9f2f
Status: REVISION_4_CR_PENDING; planning-only, no runtime mutation. Previous review PASS applies exclusively to revision 3.
Review evidence: docs/roadmap/CADGPT-INTEGRATED-PLAN-REVIEW-2026-10.md.

## Objective
Harden the existing single-bound-drawing CadGPT, reproduce/fix the bulk Grille + Grille Tag selection failure, grow CAD MCP from the current 41-manifest-tool baseline into useful broad 2D/CAD/HVAC coverage, and improve demonstrated latency without breaking real AutoCAD workflows.

## Scope boundaries
- One source repo: thebimhouseinfo-sudo/Cadgpt. main is the sole production source of truth. Use one named implementation integration branch, with checkpoint-specific commits, tests, artifacts and review; do not merge a failed checkpoint or scatter changes over unmerged branches.
- AutoCAD R22.0 (2018) + legacy .NET 4.6-compatible add-in remains a supported acceptance target.
- Preserve the single primary binding and no add-in idle timeout; preserve drawing anchor identity, explicit rebind, header colors, managed Jobs, SYSTEM/CAD lease separation, job result directories and user data.
- Preserve Tag ownership by two-way XData/handles; SIZE (neck size) distinct from optional FACE_SIZE and MODEL (invisible); no TAG_NUMBER-only auto-sync.
- Do not edit TabSortV2-2.lsp. Change only proven Grille/Grille Tag-related Lisp faults; do not mass-refactor the TBH Toolkit.
- Do not clone the entire AutoCAD API, expose arbitrary command strings, or grant unrestricted Python shell access. No speculative rewrites of transport or add-in.
- This plan is not an instruction to manipulate a production DWG. Live E2E requires a disposable copy and user-controlled host. No default use of an active drawing as a QA fixture, even when an AutoCAD session is bound.
- Drawing identity and AppData metadata can carry lasting state: acceptance/rollback must snapshot both test DWG bytes and test Drawing Anchor/result metadata. Never restore a production Anchor from a fixture, never reuse a fixture Anchor with a live production drawing.
- The internal AutoCAD R22.0/.NET Framework 4.6 add-in is operational; no .NET bridge is presumed available. Require an explicit spike with real editor UI-thread and DocumentLock proof before choosing that route.
- Every accepted capability must have a named engineering consumer scenario and one observed end-to-end postcondition, not just a schema entry.

## Verified baseline / evidence
- runtimes/cad-mcp/tool-manifest.json has 41 tools. Existing: layers; get/list entities, blocks, block definitions; MOVE/COPY/ROTATE/SCALE/MIRROR; entity state/color/linetype/layer; line/arc update; LISP load/run; observation; guarded delete. No general geometry create, block insert/set ATT batch, spatial selection, annotation, topology, or full layout/xref workflows.
- runtimes/cad-mcp/utils/filters.py supports simple type/layer/handle/text_contains filters, limit capped 5000, not pagination.
- src/cadgpt/tools/cad-proxy.ts registers manifest business proxies and a generic cad_invoke_manifest_tool fallback, each under bound-drawing/host lock. The generic gateway must enforce future tool safety tiers as well as regular named proxies.
- runtimes/cad-mcp/services/entity_service.py still scans ModelSpace/layouts for each handle, swallowing some COM enumeration failures; modify_service.py repeatedly uses _find_entity for each handle.
- src/cadgpt/session/drawing-binding.ts calls listOpenDrawings and setActiveDocument for each activation; cad-upstream.ts re-lists tools in activate after connect discovery; mcp-session-manager.ts queues non-GET by transport.
- src/cadgpt/tools/jobs.ts holds CAD host lock around a whole Direct Python Job when bound; src/cadgpt/tools/job-system-helper.ts invokes trusted, hash-presented Python helpers under user OS permissions (not a sandbox); filesystem binary writer checks only a PK prefix, not OOXML integrity.
- MEP Properties.lsp uses :vlr-objectModified callbacks with attribute write/sync; current Grille tests are primarily static source assertions and syntax preflight. Failure when region-selecting a drawing with many grilles/tags has been reported but exact command/error stage is not yet reproduced.
- Five existing CI workflows passed after PR #46, but GitHub CI alone is not real AutoCAD E2E.

## Execution packaging, finite work units and gates
This roadmap contains separate finite implementation Jobs, not a single mega-Job. Work serially on exactly one active milestone branch (for example work/cadgpt-m0a), branched from latest main. Within it, commits can close finite Job Packs independently. Complete review and applicable host tests, obtain Human approval and merge only that accepted milestone into main. Archive/delete the already merged branch; create the NEXT milestone branch afresh from updated main. Do NOT reset/rebase a branch carrying future unmerged changes and do not mix multiple milestone packs before the prior release gate. Stage new write families behind explicit rollout gates, default-off until accepted. Never merge failing/unverified changes. If main advances meanwhile, reconcile intentionally with a reviewed diff and rerun tests; never force-push/reset unrelated work.

J00 BASELINE / TEST HARNESS (minimal evidence prerequisite for J01, extend for each later pack):
- Capture tool manifest, drawing+add-in version and fixed datasets without revealing client designs. Do not force full performance benchmarking or broad observability instrumentation before beginning the urgent J01 Grille investigation; record only the minimum reproducibility data for M0a, then extend metrics for later performance work.
- Instrument transport queue, CAD host queue, upstream connect/RPC, activation, handle lookup and Job helper elapsed. Correlation ID, tool name, counts, status only; no complete file paths/private data/arguments.
- Create deterministic COM mocks and real AutoCAD fixture suite with recorded baseline p50/p95. Explicitly distinguish mocked CI from live results. Verify tests themselves: negative controls and intentional test defect.
- Exit: minimal J01 fixture+error evidence captured, five CI gates PASS, and no production behavior change. For J07/J08, additionally require repeatable hardware/config-tagged p50/p95 samples (warm/cold split, same workload, min sample count and outlier handling defined before measurement).

J01 GRILLE SELECTION DEFECT (high-priority independent bounded Job after J00):
- Diagnose before fix: reproduce in disposable DWG at scales 1/10/100/500 mixed grille/tag/text/duct objects. Separate A) selection-only window/crossing/PICKFIRST when no drawing mutation occurs, from B) MOVE/COPY/ERASE/ATT edits after selection, C) GT/TG/GRR/GRILLE_ATTR_UPGRADE, D) two drawings and reopening. Capture exact error text, command, event callback sequence, modified HANDLE and whether a callback actually fired. If selection-only fails without callbacks, do not implement a reactor deferral as a guessed fix.
- Inspect MEP Properties.lsp callback and per-drawing reactor lifecycle; TG global selected entity cleanup; Ensure* ATTDEF/ATTSYNC; dual XData links, clone/delete/undo/redo, missing backlink; evaluate global reactor lock on exceptions.
- Fix only demonstrated failure; if callback writes during unsafe database notification, queue handle-based updates and commit only at a safe command boundary, guarded against re-entry and identity drift. Do not defer when it would silently drop manual AIR_FLOW updates; prove scheduling. When the bug cannot be reproduced on an authorized fixture, mark ROOT_CAUSE_UNVERIFIED and produce a bounded read-only logging/probe plan; do not ship an unproven reactor rewrite.
- Explicit invariants to test before changing XData: MEP_TAG_LINK forward/back handles, legacy back-link behavior, no TAG_NUMBER fallback from the reactor, preservation of unrelated XData apps even when deleting/copying/tagging. Current candidate paths include GT:LinkGrilleAndTag and c:CG removing all -3 records, and TG's global *TG_SELECTED_ENTITY* cleanup on error; implement isolated corrections only if test shows fault. Preserve all existing grille fields, including manual FLEX_DUCT_SIZE priority, optional blank FACE_SIZE/MODEL and original neck SIZE.
- Exit: no selection/modify exceptions or data corruption on mixed 500 objects; correct sync and links after undo/reopen; compare pre/post handle, ATTRIB, XData and object counts; tests include real COM/CAD behavior, not solely regex. Explicit unchanged-source SHA guard for TabSortV2-2.lsp. If the authorized AutoCAD host is unavailable, only code/simulation verdict can be reached, not live acceptance.

J02 SYSTEM SECURITY / EXCEL (before MTO automation or broad writes):
- Review and bind helper source trust to promoted Job bundle identity and checked source hash, rather than caller-chosen hash alone. Restrict draft execution to authorized development context. Document Python's OS permission boundary; Python subprocess is not sandboxed merely by a Job root and a sanitized environment. If untrusted helper source remains runnable as the user, reject/disable that execution path until actual OS isolation is proven (a separate architecture gate); do not silently mark access controls PASS.
- Read/copy/write XLSX atomically where possible, verify OOXML with actual workbooks, formulas/styles/merged cells/data-validation/macro absence or explicit unsupported format; preserve workbook metadata and manually edited cells in openpyxl helper. Some Excel artifacts (external links, drawings/unsupported extension features) may not round-trip losslessly: inventory unsupported features before saving and BLOCK rather than silently rewriting. Guard concurrent writers and locked Excel files without deleting original first; compare source byte hash and semantic workbook readback.
- Boundary tests: cross-job traversal, symlink, malicious/invalid ZIP, size limits, file locked, interrupted write, hash conflict, readback, wrong interpreter, timeout/child cleanup.
- Exit: workbook fixtures valid and unchanged or correctly modified; no unapproved Job helper; no accidental data loss.

J03 CAD MCP FOUNDATION (dependency for MCP expansion):
- Fast _find_entity: doc.HandleToObject first plus type/erased/space/lifetime validation; controlled fallback only with explicit reason. COM enumeration failure must report incomplete result, not silently skip it.
- Shared typed schemas for points WCS/UCS/OCS, distance/angle units, handle sets, bounds, pagination and batch outcome. Keep bound drawing and live identity verified.
- Add versioned, fail-closed manifest security metadata: family, visibility, risk, read/mutate/destructive class, undo/preflight and authorization requirements. Define ONE authoritative human-reviewed policy catalog (not unversioned inline decorators), generate both surfaced schema and enforcement metadata from it or join deterministically with AST output, and fail CI on unknown/unclassified tool names, schema drift or missing metadata. Provide allowlisted routing: *identical* authorization in named cad__ proxy and cad_invoke_manifest_tool; bypass attempts through direct proxy, fallback gateway and dynamically discovered candidate are denied. Internal tools remain private; unknown-tool default is disabled. Test high-risk candidate, malformed argument, and false-positive classifier through both paths. No arbitrary command-string backdoor.
- Define shared mutation protocol: preflight against exact drawing runtime identity, permission and immutable handle/attribute snapshot; preview+one-shot expiry token and explicit user confirmation for destructive/high-impact actions; execute under CAD lock/DocumentLock; postcondition readback; per-object partial failure report. Previews have bounded count/time caps, per-action risk; rejection leaves drawing byte-identical. Batch writes must declare either transactional commit with rollback proof OR partial-commit semantics with per-handle before/after evidence. Rename/copy/undo/redo, timeout and retry-unknown outcomes cannot claim atomicity. Match confirmation authority to session, drawing and exact snapshot; decline if selection changed.
- Dedicated technical spike (no production modifications): attempt needed spatial window/crossing selection, Editor preselection and one bounded transaction on actual R22.0 AutoCAD/net46 add-in host, documenting UI-thread/DocumentLock behavior and deployment compatibility. Prefer stable Python COM when sufficient; adopt a .NET Editor/Transaction bridge only if the spike proves it necessary and safe. Unknown bridge feasibility blocks that capability, not unrelated Python COM work.
- Exit: batch lookup parity, missing-vs-incomplete errors, no gateway bypass through direct proxy/gateway, deterministic manifest generation/schema parity, host spike decision record; existing 41 tools regression PASS.

J04 MCP QUERY / SELECTION / BATCH READ (first expansion slice):
- Proposed capabilities: cad_query_entities; cad_select_by_region (window/crossing/polygon); cad_selection_snapshot (including editor preselection if available); cad_get_entities_batch; cad_get_blocks_batch; cad_read_attributes_batch; cad_get_geometry_metrics; cad_get_bounding_boxes; cad_find_nearest; cad_find_intersections; cad_query_spatial_relation.
- Paginated results, query limits, incomplete/COM-busy explicit errors. Selection snapshot keyed to bound drawing lifetime and handles, TTL/invalidation rules; no stale PICKFIRST reliance in reactors. Pagination cursor must bind to drawing identity, query hash and stable snapshot/revision: reject cursor on edits, reopen or expired snapshot rather than silently skip/duplicate results. If no stable cursor/snapshot is feasible, advertise offset-less bounded results with explicit incomplete flag. Batch responses include matched, returned, skipped, errors, next cursor, fully_scanned.
- Exit: 1/100/1000/5000-object fixture queries comparable to AutoCAD selection and no silent truncation; pagination remains correct when DWG mutates between pages; verify no overflow/unbounded COM loop; measure speedups versus individual reads and do not mandate a numerical gain if fixture sizes differ.

J05A MCP BLOCK & ATTRIBUTE WRITE (depends J02–J04; independent Job Pack):
- Insert existing block at explicit 3D point and rotation/scale; get/edit ATTRIB in batch by block handle and exact tag; read/update dynamic block properties when supported by R22.0; inspect definitions and optional scoped ATTSYNC.
- Guard ATTDEF mutations that affect shared definitions, copied grille XData provenance and hidden SIZE/FACE_SIZE/MODEL. Prefer non-destructive update per instance over ATTSYNC unless required.
- Scenario: update 200 grilles and their linked tags without 200 round trips, preserving all non-target attributes and XData applications.
- Exit: per-entity report, readback and undo/redo; conflict/locked layer/erased handle tests; no unexpected source/grille link changes.

J05B MCP GEOMETRY CREATE & BASIC EDIT (depends J03–J04; independent Job Pack):
- Create LINE, 2D/3D POLYLINE, RECTANGLE, CIRCLE, ARC, ELLIPSE, POINT and SPLINE, with explicit coordinate system and layer/style; return verified new handles. Add bounded polyline-vertex edits only when source geometry tests pass.
- Scenarios: draw simple HVAC equipment footprint and duct centerlines in test DWG, confirm layer/geometry and no unintended objects.
- Exit: correct geometry and units (WCS/UCS/OCS), undo/redo, invalid-coordinate, locked-layer and unsupported-entity negative controls.

J05C MCP ANNOTATION (depends J05B; independent Job Pack):
- Create/edit TEXT, MTEXT, dimension, multileader, hatch and table; verify style existence, hatch boundaries, annotation space and current scale. No silent style/substitute guessing.
- Scenario: annotated duct+grille schedule area including leaders and dimensions, preserving native CAD editability.
- Exit: visual + structured annotation readback in R22.0, undo/redo and error cases.

J06A MCP ADVANCED GEOMETRY & TOPOLOGY (depends J04–J05B; independent Job Pack):
- Offset, array, trim/extend, fillet/chamfer where reliable; nearest/intersection geometry; topology/clearance queries with tolerance, explicit WCS units and HVAC interpretation constraints.
- Scenario: trace FCU↔duct↔fitting geometry; crossing does NOT automatically mean connected.
- Exit: benchmark and geometry discrepancy report on known test fixtures; unsupported primitives honestly reported.

J06B MCP CAD METADATA & NAMESPACED DATA (depends J03 and J05A; independent Job Pack):
- Drawing units/UCS and style reads, scoped XData and Extension Dictionary reader/writer, carefully preserving *other apps'* XData and ownership/lifetime.
- Scenario: Create System + Grille Tag linking survives copy/save/reopen without overwriting unrelated metadata.
- Exit: roundtrip+negative controls, owner identity, malformed XData, no accidental overwrites.

J06C MCP XREF / LAYOUT / EXPORT (depends J03, independently gated):
- List/reload Xref, inspect layouts and viewport, safe PDF export. High-impact attachment/path operations require explicit preview and host approval; do not implement arbitrary external path writes.
- Scenario: inspect project Xref state and export a test layout PDF with verified output location.
- Exit: R22.0 host proof; exported file readback; blocked unauthorized paths; unsupported plotting setting reported.

J07 LATENCY LOW-RISK (after baseline, J03, J04; independent Job Pack):
- Remove redundant upstream listTools discovery; replace list-open-documents + unconditional activation with an identity-validated atomic verify-or-activate operation if host supports it. A simple cached active-tab flag or TTL is NOT sufficient because the user can switch AutoCAD tabs outside CadGPT. Compare RPC counts and latency.
- Batch reads/updates to avoid O(m*n) lookups and base64 bulk transport when helper runs locally.
- Exit: p50/p95 recorded for same test fixture, no binding/anchor drift; ideally 20% p95 improvement on affected paths, but correctness is mandatory.

J08A JOB LIFECYCLE AND HOST LOCK (highest risk; only if measured; independent Job Pack):
- Separate confirmed SYSTEM-only Direct/Reasoning processing from CAD host lock while preserving lock for actual CAD actions. Prove Job A SYSTEM and Job B CAD coexist, Stop→New, crash/restart and lease cleanup.
- Classify Direct Job privileges by a verified promoted manifest/capability declaration, not naming convention or user assertion. A manifest claim alone is not an enforceable runtime boundary; if Python may call CAD or use arbitrary OS access, do not release host lock unless the separation is enforced and an attempted CAD re-entry negative test is rejected.
- Exit: lease and lock accounting exact for Job A SYSTEM→Job B CAD, Job stop/new, failure/reconnect and sleep/wake, with no misuse of CAD while detached.

J08B MCP TRANSPORT CONCURRENCY (depends J08A and measured congestion; independent Job Pack):
- Measure per-transport post queue and response coupling first; preserve ordered initialize/recovery/bind/stop and SDK response correctness. Concurrency only if SDK session transport can handle approved disjoint requests safely; otherwise retain queue and prefer asynchronous detached Job results.
- Exit: concurrency/cancellation/fault injection tests across two sessions and mixed SYSTEM/CAD; no request-response contamination, lost notification, cross-job writes, deadlock, lost work/lease, header/session reconnect regression or duplicate execution. Require measured net benefit; otherwise preserve serialized queue. No speculative whole-transport rewrite.

J09 FINAL INTEGRATION / ACCEPTANCE (after all *elected* Job Packs, with explicit release gate):
- Test on a user-authorized disposable copy of the actual DWG with AutoCAD R22.0 and real add-in. Before/after snapshots of object/handle counts, complete grille and tag ATT fields, two-way XData links, other registered-app XData, layers, Drawing Anchor, current drawing ID and target files. Test binding/mismatch, sleep/wake, header color, startup hidden, Job A→B, selection-only versus MOVE/COPY/ERASE of 500 mixed objects, GT/TG/GRR and MEP fields, Excel schedule copy/update and newly added MCP business workflows. No production DWG is used as a test fixture.
- Check manifest generation, Python 3.11/3.14, Windows tests, all five CI workflows, docs, family-level tool discoverability, default-visible surface size/latency, rollback, and review of production code AND test scripts. Each accepted tool must pass a documented consumer scenario. Tag/release and merge only after explicit human acceptance.
- Exit: attached evidence of real DWG smoke, latency before/after, zero critical regressions and rollback instructions.

## Proposed capability coverage / prioritization
Available now (reuse rather than duplicate): entity/block/layer read, generic transforms, line/arc update, sandboxed LISP and guarded delete (41 manifest entries including internal).
P0 before broad exposure: spatial/selection snapshot, bulk entity/block/ATT read, block insert/ATT mutation, bounding/measurement, geometry primitives, batch safety.
P1: annotation, advanced geometry edits, dynamic blocks, XData/extension dictionary and topology.
P2: xref/layout/viewport/plot and rare advanced API actions.
Target an approximate 40–55 useful additional endpoints only if J04–J06 scoped, individually tested Job Packs justify them; no hard quota or blind implementation. Count only implemented tools with manifest security metadata, schema parity, R22.0 proof when needed and an observed consumer scenario. Default model surface advertises concise high-frequency families; advanced capability families are discoverable through an indexed catalog/validated gateway without dumping dozens of tool schemas into every conversation. Monitor description tokens and tool-list refresh overhead.

## Test and review contract
Per Job Pack: evidence-driven red test/negative control → smallest implementation → correctness test → relevant security boundary tests → code and test-script review at designated checkpoint → benchmark where applicable → disposition and commit. Do not make fake-green CI scripts: reviewer inspects test fixtures, negative controls, actual calls and expected failures; remove obsolete tests only if replaced with stronger observed behavior.
Acceptance categories: API contract, real drawing identity, permissions, geometry accuracy, batch partial results, undo/redo, COM retry/busy, lifecycle stop/restart, performance/capability coverage, recovery. CI (npm test, manifest regen, Python tests, add-in tests, five workflows) and real AutoCAD evidence recorded separately.
No blanket "PASS" from source regex assertions. If host is unavailable, status is BLOCKED_REAL_CAD_VALIDATION, not PASS.

## Risk and rollback
Maintain backup/copy for each authorized test drawing and its local metadata/result directory, record exact input file hash, anchor, bound drawing identity and command before mutation; never mutate the user's live active DWG automatically. Implementation commits checkpoint-scoped for selective revert; no hard reset, no force push. New mutation families default-off pending their own E2E gate; preserve previous stable tool-set behind fail-closed capability toggles. A failed checkpoint halts dependent changes, not unrelated accepted Job Packs. At each stable milestone: reviewer checks code+tests, CI passes, real AutoCAD smoke is accepted, Human approves release, then merge the milestone branch into main; archive it and start the next branch from updated main. Keep rollback evidence for both runtime and AppData metadata. main always contains the last accepted release, never an unreviewed experiment.

## Traceability / acceptance map
| User requirement | Owning Job Pack | Required evidence | Decision |
| --- | --- | --- | --- |
| Bulk selection of Grille and Grille Tag no longer errors | J01 | Reproducing exact exception; 1/10/100/500 mixed-object live CAD tests + unchanged ATT/XData invariants | Fixed only when root cause proven |
| TabSortV2-2 remains untouched | J01/J09 | Diff/source SHA compare to baseline | Hard no-change gate |
| Existing CAD functionality remains | J00/J03/J09 | All 41 baseline tool contracts + AutoCAD smoke | No regressions |
| Broader ordinary CAD actions | J04/J05A/J05B/J05C | Query, ATT, create and annotation consumer workflows | Functional coverage, not numeric quota |
| Advanced editing, Xref, metadata and topology | J06A/J06B/J06C | Domain-specific fixtures + host gate | Unsupported features explicit |
| Excel and Job SYSTEM safety | J02 | Real OOXML workbooks and permission/cleanup negative tests | No corrupt/misplaced writes |
| Measured latency improvement | J00/J07/J08A/J08B | Same-drawing p50/p95 + queue/RPC counts, crash/recovery | No correctness regression |
| Main remains source of truth | All milestones/J09 | One active branch per milestone, scoped commits, review and human-gated merge, then a fresh branch from main | No long-lived unmerged drift |

## Delivery milestones and dependencies
- M0a (early bugfix) = J00 minimal reproducible baseline + J01 demonstrated Grille/Tag selection defect and regression. User-approved live CAD smoke and independent release decision; do NOT wait for unrelated Excel hardening to close this milestone.
- M0b (SYSTEM safety) = J02, with its own permission + real workbook evidence and human-gated release. Its implementation may reuse J00 observability/test harness.
- M1 = J03 then J04: fail-closed manifest, handle lookup, reliable selection and batch read; release only after CAD read parity and security tests.
- M2a = J05A (Block/ATT update) and the Grille Tag consumer acceptance. Independently releasable when verified.
- M2b = J05B (basic geometry) and J05C (annotation), each with separate Job Pack sign-off; they need not wait for unrelated M2a experiments after shared dependencies pass.
- M3 = J06A (geometry/topology), J06B (namespaced metadata) and J06C (Xref/layout/export) independently and only where consumer demand/feasibility justifies; J07 latency low-risk after J03/J04 and measured baseline. Each may be merged as a proven, enabled-by-default-safe or default-off feature-gated milestone.
- M4 = J08A/B only when actual queue/lock benchmark justifies the change, then J09 final integrated replay and release decision.
- Use one active branch and one source of truth: accepted milestone → commit/evidence → Reviewer PASS + user-controlled AutoCAD smoke → explicit Human approval → merge main → retire work branch → start next branch from latest main. Do not stockpile future Job Pack commits on the branch being merged. Unaccepted work is never represented as production-ready.
- A release tag/doctor status applies to precisely the reviewed commit; after each milestone merge, compare full diff and run the five CI gates plus the affected real-host smoke. If AutoCAD cannot be run, retain a blocked host gate and do not claim release PASS.


## Operational stop/go decisions (revision 4)
| Decision | Trigger | Required disposition |
| --- | --- | --- |
| Grille root cause not reproducible | Only user report, no exact error/trace | ROOT_CAUSE_UNVERIFIED; read-only probe and user-assisted fixture capture, no speculative LISP edits |
| Real CAD host inaccessible | Offline CI PASS but R22.0 cannot be exercised | BLOCKED_REAL_CAD_VALIDATION for affected milestone, not release PASS |
| Tool risk metadata missing/drifted | Added manifest tool with no reviewed policy | CI fail closed; do not expose via named or generic gateway |
| Selection cursor stale | DWG revision/identity, query or TTL changed | Fail and require fresh snapshot, no inaccurate "complete" report |
| Workbook roundtrip unsupported | Unsupported OOXML features or active file lock | BLOCKED_INPUT, do not overwrite workbook |
| Python/helper boundary unverified | Untrusted code could run with full user OS privileges | Disable untrusted path; no sandbox claim |
| SYSTEM-only job attempts CAD re-entry | Claimed detach without enforced isolation | Reject/hold CAD lock and fail privilege boundary test |
| Latency improvement insignificant | Same host/fixture p95 unchanged or worsens | Keep simpler implementation; avoid risky queue rewrite |
| Live DWG or AppData differs after rollback | Anchor, metadata, ATT/XData mismatch | Stop release; recover disposable fixture and investigate |
