# CadGPT Integrated Implementation Plan — Draft revision 1
Date: 2026-10-10
Canonical baseline: main @ 8e21ef3ae3bd4b9102aeb8f09531a06638ee9f2f
Status: PLANNING_REVIEW_PENDING; planning-only, no runtime mutation.

## Objective
Harden the existing single-bound-drawing CadGPT, reproduce/fix the bulk Grille + Grille Tag selection failure, grow CAD MCP from the current 41-manifest-tool baseline into useful broad 2D/CAD/HVAC coverage, and improve demonstrated latency without breaking real AutoCAD workflows.

## Scope boundaries
- One source repo: thebimhouseinfo-sudo/Cadgpt. main is the sole production source of truth. Use one named implementation integration branch, with checkpoint-specific commits, tests, artifacts and review; do not merge a failed checkpoint or scatter changes over unmerged branches.
- AutoCAD R22.0 (2018) + legacy .NET 4.6-compatible add-in remains a supported acceptance target.
- Preserve the single primary binding and no add-in idle timeout; preserve drawing anchor identity, explicit rebind, header colors, managed Jobs, SYSTEM/CAD lease separation, job result directories and user data.
- Preserve Tag ownership by two-way XData/handles; SIZE (neck size) distinct from optional FACE_SIZE and MODEL (invisible); no TAG_NUMBER-only auto-sync.
- Do not edit TabSortV2-2.lsp. Change only proven Grille/Grille Tag-related Lisp faults; do not mass-refactor the TBH Toolkit.
- Do not clone the entire AutoCAD API, expose arbitrary command strings, or grant unrestricted Python shell access. No speculative rewrites of transport or add-in.
- This plan is not an instruction to manipulate a production DWG. Live E2E requires a disposable copy and user-controlled host.

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
This roadmap contains separate finite implementation Jobs, not a single mega-Job. One integration branch may hold reviewed checkpoint commits; preserve committed, traceable progress with no parallel uncontrolled branch divergence. Each Job is independently closable with evidence; the branch is merged only after integrated regression, real host acceptance, and final human approval. If production main advances, reconcile and re-test instead of force-pushing or resetting unrelated work.

J00 BASELINE / TEST HARNESS (dependency for all):
- Capture tool manifest, drawing+add-in version and fixed datasets without revealing client designs.
- Instrument transport queue, CAD host queue, upstream connect/RPC, activation, handle lookup and Job helper elapsed. Correlation ID, tool name, counts, status only; no complete file paths/private data/arguments.
- Create deterministic COM mocks and real AutoCAD fixture suite with recorded baseline p50/p95. Explicitly distinguish mocked CI from live results. Verify tests themselves: negative controls and intentional test defect.
- Exit: measurements reproducible with hardware/config notes; five CI gates PASS; no production behavior change.

J01 GRILLE SELECTION DEFECT (high-priority independent bounded Job after J00):
- Reproduce in disposable DWG at scales 1/10/100/500 mixed grille/tag/text/duct objects, with selection-only vs MOVE/COPY/ERASE, selection via pickfirst/window/crossing, after GT/TG, on two drawings, reopened DWG; capture exact error text, command, reactor events and offending handle.
- Inspect MEP Properties.lsp callback and per-drawing reactor lifecycle; TG global selected entity cleanup; Ensure* ATTDEF/ATTSYNC; dual XData links, clone/delete/undo/redo, missing backlink; evaluate global reactor lock on exceptions.
- Fix only demonstrated failure; if callback writes during unsafe database notification, queue handle-based updates and commit only at a safe command boundary, guarded against re-entry and identity drift. Do not defer when it would silently drop manual AIR_FLOW updates; prove scheduling.
- Ensure XData edits preserve unrelated registered apps and copied grilles cannot rewrite original tags. Preserve all existing grille fields, including manual FLEX_DUCT_SIZE priority.
- Exit: no selection/modify exceptions or data corruption on mixed 500 objects; correct sync and links after undo/reopen; tests include real COM/CAD behavior, not solely regex.

J02 SYSTEM SECURITY / EXCEL (before MTO automation or broad writes):
- Review and bind helper source trust to promoted Job bundle identity and checked source hash, rather than caller-chosen hash alone. Restrict draft execution to authorized development context. Document Python's OS permission boundary; separate Windows sandbox feasibility if OS isolation is required.
- Read/copy/write XLSX atomically where possible, verify OOXML with actual workbooks, formulas/styles/merged/hidden ATT-like columns preserved by openpyxl helper; guard concurrent writers and locked Excel files without deleting original first.
- Boundary tests: cross-job traversal, symlink, malicious/invalid ZIP, size limits, file locked, interrupted write, hash conflict, readback, wrong interpreter, timeout/child cleanup.
- Exit: workbook fixtures valid and unchanged or correctly modified; no unapproved Job helper; no accidental data loss.

J03 CAD MCP FOUNDATION (dependency for MCP expansion):
- Fast _find_entity: doc.HandleToObject first plus type/erased/space/lifetime validation; controlled fallback only with explicit reason. COM enumeration failure must report incomplete result, not silently skip it.
- Shared typed schemas for points WCS/UCS/OCS, distance/angle units, handle sets, bounds, pagination and batch outcome. Keep bound drawing and live identity verified.
- Add tool manifest risk/visibility metadata and *identical* authorization on named cad__ proxy and cad_invoke_manifest_tool gateway; internal tools remain private. Generated manifest and runtime schema parity tests.
- Choose the best service adapter via proof-of-concept: prefer stable Python COM; .NET Editor/Transaction bridge only if host-only selection/transaction needs it. AutoCAD 2018/net46 support must be proven before adoption.
- Exit: batch lookup parity, missing-vs-incomplete errors, no gateway bypass; existing 41 tools regression PASS.

J04 MCP QUERY / SELECTION / BATCH READ (first expansion slice):
- Proposed capabilities: cad_query_entities; cad_select_by_region (window/crossing/polygon); cad_selection_snapshot (including editor preselection if available); cad_get_entities_batch; cad_get_blocks_batch; cad_read_attributes_batch; cad_get_geometry_metrics; cad_get_bounding_boxes; cad_find_nearest; cad_find_intersections; cad_query_spatial_relation.
- Paginated results, query limits, incomplete/COM-busy explicit errors. Selection snapshot keyed to bound drawing lifetime and handles, TTL/invalidation rules; no stale PICKFIRST reliance in reactors. Batch responses include matched, returned, skipped, errors, next cursor, fully_scanned.
- Exit: 1/100/1000/5000-object fixture queries comparable to AutoCAD selection and no silent truncation; measurable speedups versus individual reads.

J05 MCP STANDARD WRITE / BLOCK / ATT / GEOMETRY (second expansion slice; depends J02–J04):
- Block: insert; read/edit ATTRIB batches; dynamic property inspection/update; definition preview, optional sync with scope; maintain copied grille XData identity.
- Geometry creation: line, 2D/3D polyline, rectangle, circle, arc, ellipse, point, spline; entity layer/style; returned new handles + postconditions.
- Annotation: text, mtext, dimension, multileader, hatch, table; edit text/attributes with clear units, styles and undo.
- Shared write contract: inspect → dry-run preview → explicit bounded execute for high-risk mutations → readback; for multi-entity updates report partial failures without pretending all operations were atomic.
- Exit: representative 2D layout and grille attribute job possible without ad-hoc LISP; no cross-drawing mutations; undo/redo and retained attributes proven.

J06 MCP ADVANCED COVERAGE (third slice, independently gated):
- polyline vertices, offset, array, trim/extend, fillet/chamfer; xdata/extension dictionary namespaced read/write; geometric/topological connection and clearance query; layout, viewport, xref inspect/reload and PDF export.
- .NET bridge only for operations validated infeasible/unsafe over COM; explicitly define transaction/DocumentLock host scheduling and failure rollback semantics before building it.
- Risk-tier coverage: preview/confirmation for delete/explode/destructive xref operations, no arbitrary command string.
- Exit: tool coverage matrix for actual job scenarios; high-risk gates pass, user signs off any unsupported commands (not fake stubs).

J07 LATENCY LOW-RISK (after baseline, J03, J04):
- Remove redundant upstream listTools discovery, deduplicate already-active drawing activation without trusting stale tab state; compare RPC counts and latency.
- Batch reads/updates to avoid O(m*n) lookups and base64 bulk transport when helper runs locally.
- Exit: p50/p95 recorded for same test fixture, no binding/anchor drift; ideally 20% p95 improvement on affected paths, but correctness is mandatory.

J08 JOB LIFECYCLE AND QUEUE CONCURRENCY (highest risk; optional if latency evidence justifies):
- Separate confirmed SYSTEM-only Direct/Reasoning processing from CAD host lock while preserving lock for actual CAD actions. Prove Job A SYSTEM and Job B CAD coexist, Stop→New, crash/restart and lease cleanup.
- Transport queue: measure postTail delay first; preserve ordered initialize/recovery/bind/stop and SDK response correctness; concurrency only for approved, disjoint requests with tests, otherwise retain queue.
- Exit: no cross-job writes, deadlock, lost work/lease or header/session reconnect regression, and demonstrated net latency benefit. No speculative whole-transport rewrite.

J09 INTEGRATION / RELEASE:
- Test on a disposable copy of actual user DWG with AutoCAD R22.0 and real add-in: drawing anchor persists, correct binding/mismatch, sleep/wake, header color, startup hidden, first/second Job, selection 500 grilles+tags, GT/TG/GRR and MEP fields, actual Excel schedule copy/update, new MCP tool workflows.
- Check manifest generation, Python 3.11/3.14, Windows tests, all five CI workflows, docs, command discoverability, rollback and test script review. Tag release only after human acceptance.
- Exit: attached evidence of real DWG smoke, latency before/after, zero critical regressions and rollback instructions.

## Proposed capability coverage / prioritization
Available now (reuse rather than duplicate): entity/block/layer read, generic transforms, line/arc update, sandboxed LISP and guarded delete (41 manifest entries including internal).
P0 before broad exposure: spatial/selection snapshot, bulk entity/block/ATT read, block insert/ATT mutation, bounding/measurement, geometry primitives, batch safety.
P1: annotation, advanced geometry edits, dynamic blocks, XData/extension dictionary and topology.
P2: xref/layout/viewport/plot and rare advanced API actions.
Target 40–55 additional *useful* capability endpoints spread over J04–J06, number not a success metric; count only fully implemented/tested tools with manifest schemas, supported host behavior and an observed consumer workflow.

## Test and review contract
Per Job: evidence-driven red test/negative control → smallest implementation → correctness test → relevant security boundary tests → code and test-script review at designated checkpoint → benchmark where applicable → disposition and commit.
Acceptance categories: API contract, real drawing identity, permissions, geometry accuracy, batch partial results, undo/redo, COM retry/busy, lifecycle stop/restart, performance/capability coverage, recovery. CI (npm test, manifest regen, Python tests, add-in tests, five workflows) and real AutoCAD evidence recorded separately.
No blanket "PASS" from source regex assertions. If host is unavailable, status is BLOCKED_REAL_CAD_VALIDATION, not PASS.

## Risk and rollback
Maintain backup/copy for each live acceptance drawing, record anchor and command before mutation; never mutate the user's live active DWG automatically. Implementation commits checkpoint-scoped for selective revert; no hard reset, no force push. A failed checkpoint halts dependent changes. main unchanged until integrated review and explicit merge authorization.
