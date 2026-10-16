# CLG Peno
## Identity
- id: clg-peno
- title: CLG Peno
- mode: reasoning
- status: testing
- class: workflow.user
- subclass: hvac-ceiling-penetration
- summary: Grille metadata or manual collection → geometry → peno data → AutoCAD Lisp draw.

## Goal
Create CLG Peno from measured grille center, width, height and rotation, zero offset. Do not infer dimensions from Neck Size or Face Size.

## Strict workflow — mandatory
- Execute EXACTLY Step CLGP-01, CLGP-02, CLGP-03 in order for a full START, and only the requested step(s) for a partial command.
- Do not autonomously invent, expand, interpret, or add substeps, checks, comparisons, CAD readbacks, post-processing, debugging, backup, history, reviews, or tests.
- Reasoning is authorized ONLY in Step CLGP-02 to process collected geometry into peno drawing data. Step CLGP-01 and CLGP-03 are deterministic tool execution with no additional reasoning.
- Each Lisp LOAD is invoked ONCE; its own LOAD/autorun response is the only execution result required. If the command returns success, proceed immediately. For CLGP_DRAW, success means LOAD succeeded and the Lisp's run log reports completion with failed=0; do not treat an explicit error/BLOCKED message as PASS.
- At a required manual collection, LOAD collector and STOP for the user to scan; continue Step CLGP-02 only after user says to continue. Otherwise do not pause between successful steps.
- If a requested step fails, report that error and STOP; do not invent fixes. Never alter engines or CAD beyond the actions expressly described in the three steps.
- Prioritize speed, accuracy and minimal tool calls. Do not repeat an already completed step just to inspect or reassure.

## Preconditions
- Work on the AutoCAD drawing ALREADY bound in this CadGPT work, never another tab/project. Call `job_runtime_prepare` to get this Job's canonical `job_root`, `runtime_root`, and `runtime/JOB_STEPS.md`; use `drawing_metadata_location` only to authorize the exact bound Drawing Anchor/root for stored-file access. Full DWG path and Drawing Anchor are required for metadata helper inputs. Do not guess AppData roots.
- Grille Tag result is the only metadata existence condition for CLGP-01 routing. Use `file_job_result_read` on this bound drawing's `grille-tag-result` to check the existing `grilles.json` and `index.json` (or file_list/file_read under the drawing_metadata_location-authorized current drawing root). This is a stored-file check, NOT live CAD MCP. Validate drawing_anchor and producer identity; do NOT fall back to Create System, inspect peno handles or browse unrelated projects. Missing GT result -> manual collector route.
- Use only these existing Job-owned engines: `lisp/CLGP_COLLECT.lsp`, `lisp/CLGP_FILL.lsp`, `lisp/CLGP_DRAW.lsp`, `tools/metadata_route.py`, `tools/prepare.py`. The three Lisp files are **registered in place** in User Lisp Registry, NOT copied/moved to `libraries/lisp`. Registered sources must resolve to matching absolute paths and source bytes inside this Job bundle.
- Grille handles identify the source entities for collecting geometry; peno outputs do NOT need handles or a drawn-map.
- Runtime scratch is scoped to the current Job and bound drawing: existing filenames are replaced per run; no mandatory history/archive/drawn-map. A previous `grilles-raw.txt` or `peno-plan.txt` cannot be reused for a different drawing: helpers validate source DWG, Drawing Anchor, source hashes/handle sets and measurement completeness. On a failed/unfinished run do not claim output success or delete evidence automatically. Track CLGP-01..03 in `runtime/JOB_STEPS.md`; this does not add an execution stage.

## Registered Job-internal Lisp — contract
- Registry ID `clg-peno-job-lisp.lisp.clgp.collect` -> `<job_root>/lisp/CLGP_COLLECT.lsp`: LOAD once to **define** interactive command `CLGP_COLLECT` and the measurement helpers. It does NOT auto-execute the manual selection command. In manual mode report readiness and wait for the user to run `CLGP_COLLECT`; on the metadata path LOAD it once for prerequisite measurement definitions only.
- Registry ID `clg-peno-job-lisp.lisp.clgp.fill` -> `<job_root>/lisp/CLGP_FILL.lsp`: LOAD once AFTER collector definitions and exact handle queue are prepared. It **autoruns** `CLGP_FILL`, measuring precisely queued valid grilles; DO NOT dispatch a second command. Require explicit successful log/count and no BLOCKED or AUTO_RUN_ERROR; do not accept mere LOAD success as data success.
- Registry ID `clg-peno-job-lisp.lisp.clgp.draw` -> `<job_root>/lisp/CLGP_DRAW.lsp`: LOAD once AFTER a validated plan; it **autoruns** `CLGP_DRAW`. Require `New=N, failed=0` and no BLOCKED/AUTO_RUN_FAILED; never dispatch it again after LOAD.
- Registry entries reference these original Job-owned Lisp files **in place**. They are indexed as Lisp capabilities but remain internal tools of CLG Peno. Never relocate, import to another Lisp Library, alter Lisp behavior merely to register it, or load an unverified duplicate. Wrong Registry path/source => `JOB_LISP_REGISTRY_MISMATCH` and STOP.
- The Job defaults HYBRID. Foreground work holds bound AutoCAD authority; optional `job_system_acquire` is only for executing the Job-owned Python FILE/SYSTEM helpers, with `tool_id=clg-peno`, and must be released using `job_system_release` **BEFORE every Lisp LOAD/CAD MCP call**. When another helper is required later, reacquire only after CAD work is complete. No CAD MCP calls inside a detached SYSTEM lease. Do not release the foreground drawing binding.
- Runtime STEP checklist: only mark each step PASS after that step's actual evidence. Do not start CLGP-02 after a manual LOAD alone (wait for collected raw), and do not report success after a BLOCKED autorun.

## Workflow
1. CLGP-01: Resolve bound Drawing Anchor and check this drawing's stored Grille Tag result. Absent → LOAD collector **definitions only**, report `CLGP_COLLECT` ready for user's manual scan and STOP; continue after user finishes collection. Present → snapshot verified Grille Tag result/index into this Job runtime, run metadata_route.py with ALL source grille handles to create queue, release SYSTEM lease, LOAD collector definitions then FILL once (FILL autoruns); finally run helper finalize after measured output exists.
2. CLGP-02: Reason only over measured/verified geometry and use prepare.py to generate and validate the peno-plan.txt for this exact DWG; zero clearance, no nominal-size guesses.
3. CLGP-03: Release any SYSTEM lease, LOAD internal CLGP_DRAW once on the bound drawing; accept only successful autorun (`failed=0`), report actual counts and END. No post-CAD scan.

## Step CLGP-01 — Collect grille geometry
**instruction**: Call `job_runtime_prepare` for the current Job and get exact runtime/JOB_STEPS, bound DWG identity and Drawing Anchor. Use `drawing_metadata_location` only for canonical bound metadata-root authorization; use non-CAD `file_job_result_read` (or authorized file_list/file_read) to inspect Grille Tag result existence. Do not select another project. Take exactly one of these routes:
- **Grille Tag ABSENT**: LOAD the in-place registered Job `lisp/CLGP_COLLECT.lsp` ONCE in foreground, which only defines interactive `CLGP_COLLECT`. It must NOT auto-run the manual selection command. Tell the user to run `CLGP_COLLECT` manually, then STOP. On a later explicit CONTINUE, first verify `runtime/grilles-raw.txt` belongs to this same DWG; then proceed to CLGP-02. No re-selection/reload unless required.
- **Grille Tag PRESENT**: Obtain current drawing's Grille Tag `grilles.json` AND `index.json`; verify drawing_anchor, job_id, grille count and source hashes, then place exact read-only source snapshots `grille-tag-source.json` and `grille-tag-index.json` into this Job runtime. Build a single helper input JSON in this same runtime using `grille_tag_snapshot_file=grille-tag-source.json`, both exact hashes, `source_paths`, `phase=route`, bound drawing_full_path and drawing_anchor. Run `tools/metadata_route.py` with `job_system_run_helper` under optional `clg-peno` SYSTEM lease; it produces a deterministic `metadata-missing-handles.txt` queue for EVERY Grille Tag handle. Release SYSTEM lease BEFORE CAD. LOAD `lisp/CLGP_COLLECT.lsp` ONCE (definitions only, do not execute manual collector); LOAD `lisp/CLGP_FILL.lsp` ONCE, which autoruns measuring exactly those queued handles into `runtime/metadata-fill.txt`. Require success count for ALL expected handles; BLOCKED/partial/error => STOP. Reacquire SYSTEM FILE lease, run `metadata_route.py` with `phase=finalize` and same verified snapshot identity, release lease before next CAD stage. Ensure final `grilles-metadata-ready.txt` and `metadata-ready.json` reflect all handles. Do not inspect unrelated metadata or perform additional CAD scans.
Manual and metadata route require only the tools above; never call CLGP_FILL manually after LOAD.
**inputs**: Grille Tag result, or manual scan when absent.
**preferred_tools**: job_runtime_prepare, drawing_metadata_location, file_job_result_read/file_list/file_read, file_create (exact source snapshots and input manifest), job_system_acquire/job_system_run_helper/job_system_release for helper phases, cad__cad_load_lisp_file only in foreground.
**success_criteria**: manual mode → collector definitions successfully loaded then wait for user; metadata mode → every source handle measured (FILL autorun), route finalize returns READY_FOR_ANALYSIS, verified full output present.
**failure_handling**: source missing => manual route; foreign/invalid Grille Tag data, incomplete geometry queue/fill, changed source hash or any BLOCKED/AUTO_RUN_ERROR => report exact error and STOP; preserve incomplete evidence, no unrelated fallback.
**output / evidence**: collected geometry file for Step CLGP-02.
**mutation_scope**: Job runtime and the existing temporary measurement objects used by CLGP_FILL only.

## Step CLGP-02 — Process geometry into peno data
**instruction**: Reason ONLY over Step CLGP-01 verified geometry, never infer dimensions from FACE/NECK SIZE. Run the existing `tools/prepare.py` under Job SYSTEM helper with the current bound full DWG path and `raw_filename=grilles-metadata-ready.txt` for metadata or `grilles-raw.txt` for completed manual scan. It validates every raw record's source_dwg, positive width/height, center and rotation; enforces zero margin, one plan record per grille handle; writes `peno-plan.txt` and plan manifest. Invoke only in an authorized `clg-peno` SYSTEM lease and release the lease BEFORE CLGP-03's CAD LOAD. Do not add CAD checks, auxiliary reasoning or post-run scans.
**inputs**: collected grille geometry from Step CLGP-01.
**preferred_tools**: file_read (optional exact source input hash), job_system_acquire, job_system_run_helper (Job-owned prepare.py), job_system_release.
**success_criteria**: peno-plan.txt has been produced by the helper successfully.
**failure_handling**: report the helper error and stop.
**output / evidence**: peno-plan.txt.
**mutation_scope**: Job runtime only.

## Step CLGP-03 — LOAD CLGP_DRAW and finish
**instruction**: Confirm optional SYSTEM helper lease has been released and the foreground bound drawing is still selected. Verify registered Job Lisp ID `clg-peno-job-lisp.lisp.clgp.draw` resolves IN PLACE to this Job's `lisp/CLGP_DRAW.lsp`. LOAD this file ONCE via `cad__cad_load_lisp_file`: it auto-runs `CLGP_DRAW` against the validated `runtime/peno-plan.txt`. Require actual `[CLGP] New=N, failed=0.` output, with no BLOCKED or AUTO_RUN_FAILED; a generic 'loaded/auto-run returned' message alone is NOT success. After successful drawing autorun, invoke `cad__acad_save_bound_document` exactly once on this bound drawing before reporting completion; require explicit save success or STOP with `DWG_SAVE_FAILED`. Report actual counts and finish. DO NOT dispatch CLGP_DRAW again, inspect CAD objects, compare handles, or run extra QA after success.
**inputs**: peno-plan.txt; target AutoCAD drawing.
**preferred_tools**: cad__cad_load_lisp_file, cad__acad_save_bound_document (after successful draw only).
**success_criteria**: correct Job-owned Lisp source loaded once; autorun reports New=N with failed=0 on CURRENT bound drawing; explicit successful bound-DWG SAVE result before final PASS.
**failure_handling**: report explicit Lisp error/BLOCKED/failed count and STOP; if SAVE fails or has uncertain outcome, report DWG_SAVE_FAILED or SAVE_UNCONFIRMED and STOP without automatic retry or claiming Job completion.
**output / evidence**: Lisp autorun completion message and bound-DWG SAVE tool success.
**mutation_scope**: CLGP_DRAW-generated peno blocks and layers only.

## Validation
- Source/Job validation is an authoring-only action, not an execution Step. Do not invoke validation, review, post-load checks or tests during a normal START unless explicitly requested.
- Before promote verify the three Lisp Registry entries resolve to each original Job-owned file, Job bundle hashes are unchanged for lisp/** and tools/**, validate the canonical 3-step Job contract and syntax of all three Lisp. Run data-only helper tests without CAD where possible; live CAD measurement/drawing requires separately authorized testing. A JOB.md-only contract correction can be promoted after passing draft validation without misrepresenting it as live CAD PASS; preserve status=testing and registry block until separately documented live evidence confirms collection, geometry, drawing and SAVE.
- Testing must use an authorized test execution context; a JOB.md status edit or authoring promotion does not override the Registry execution block. Do not promote to active or clear blocked_job_ids without actual accepted live test evidence.
