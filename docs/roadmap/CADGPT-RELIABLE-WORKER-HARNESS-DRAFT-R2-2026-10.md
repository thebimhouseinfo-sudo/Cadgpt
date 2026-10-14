# CadGPT — Reliable CAD Assistant / Harness Refinement Draft
## GOAL

Make the **existing CadGPT a reliable, fast, user-directed CAD Technical Assistant**. **User assigns the work and chooses when; CadGPT uses existing capabilities to do it accurately and quickly, then reports the real result.** CadGPT is **not an Automator** that directs project timing/dependencies, and **not an Advisor** that replaces execution with unsolicited consulting. Reason only as much as the assigned task or approved Job step actually requires.

**Observable success:** correct and quick requested execution; fewer redundant tool calls, reasoning turns, confirmations and workarounds; truthful tool errors; existing Saved Jobs and binding remain stable. **One bound drawing per AutoCAD/CadGPT host is shared by multiple concurrent ChatGPT chats**, each running an independent Work/Job when its own resources allow. Chat A running FILE/Python MTO must not block Chat B's CAD Create System or Chat C's Builder work.

**Implementation decision rule: KEEP → REFINE → FIX (evidence-backed) → BUILD ONLY IF NECESSARY.** Avoid over-reasoning, over-engineering, over-checking and unapproved workflow changes. A plan review must explicitly reject complexity added solely because CadGPT *could* automate something.

**Hard constraints:** one GPT Web model; refine the **existing** Job/Orchestrator harness instructions toward Operator and Builder behavior (their full separation is a goal to verify, not presumed implemented); no second Workflow Engine, Job Scheduler, Job Clash Manager, Capability Registry, local agent or new per-step runtime. Preserve existing Job Runtime, WorkRegistration, effective Registry (CAD MCP, SYSTEM MCP, LISP), permissions, ToolLeases and SYSTEM leases. This is a **planning-only** revision; no source, promoted Job, DWG, merge or deployment authorization.

**Status:** DRAFT R4 — source-aligned revisions after Planner RL round 1; complete self-review recorded below, **not** an independent CR. Prior R2 independent CR verdict is **not** inherited. Existing production behavior must be proved, not inferred from plan language.

**Draft lineage:** Prepared from `docs/roadmap/CADGPT-RELIABLE-WORKER-HARNESS-PLAN-2026-10.md` at source commit `72e45519678dd5724e969eab8c882dc783633790`. Independent CR source for original revision: GSA Verification `01a13601-03d6-766d-828e-a257c4d85532` (FAIL with three findings). The new draft closes those findings at the planning-text level; external execution behavior is still unverified.

**Ownership boundary:** The older GSA planning Job `J-5DF2` remains tied to its older approved revision and is **not** silently rewritten, superseded or treated as proof that this new draft is reviewed. The ongoing Orchestrator V2 Job `J-6B01` also remains unchanged.

## 1. Product contract and authority

**Assistant operating loop:** User asks → CadGPT executes with the smallest applicable existing capability → returns result or actual error. If a genuinely essential detail is missing, ask only for that detail. Do not decide design is “ready”, independently schedule MTO after Create System, delay work for project-level data freshness, audit the entire DWG or give a lecture on what user should do next.

- **User directs WHAT and WHEN.** User understands their semi-automated engineering workflow. MTO before design completion can produce incomplete quantities; CadGPT does not become a design-completion gatekeeper. A promoted Job's *explicit* preconditions remain binding.
- **Operator = execute registered/promoted Saved Jobs**: read current JOB.md, follow selected approved branch and Job Steps. No redesign, invented checks, repetitive approvals, alternate route after failure or unrelated CAD scans.
- **Builder = build on explicit user approval**: create/refine Jobs, Lisp (including Dynamic Lisp), tools and Temp/Disposable tasks. Proposals are NOMINATIONS until approved; Builder does not insert extra business steps. Writing source, promoting and merging are separate approvals.
- **Direct registered command = direct execution**: no artificial Job creation or Builder planning when a usable registered capability exists.
- **Runtime = technical safety only**: enforce Work/session identity, single bound drawing, permission/file ownership, genuine tool results and dispatch order. Existing Job step checklist is not a second business workflow engine.
- **Operator/Builder harness = behavioral emphasis, not two model processes.** For execution, current promoted JOB.md is authoritative; for authoring, the user-approved baseline is authoritative.
- **Multiple chats are expected, not a clash to be managed.** Each chat has its own session/Work; all share the *same verified host drawing*. Each Job owns its files/results; a different Job may read but not modify them. Different Job IDs operate independently. The **same Job** can retain its existing exclusive runtime root: do not quietly redesign persistent Job files to permit duplicate same-Job runs.
- **Only shared CAD ingress is serialized**, using the existing host queue if it already serves that purpose. FILE/Python/GPT work must not be placed in a host-wide waiting line. Technical action ordering is distinct from model-invented project task dependency.

**Three non-negotiable real-product scenarios from `diagnostics/cad/ERROR_LOG.md`:** bound-CAD “vẽ lại” means work on the DWG rather than image generation; repeated CAD-state questions read live CAD rather than reuse chat context; Internal Direct Job error is reported rather than bypassed with invented lower-level tools.

## 2. Executor-first, reasoning-on-demand contract

For a new/refined Reasoning JOB.md, **make only the meaningful approved steps executable and unambiguous**: their goal/action, required inputs/outputs, chosen executor, reasoning boundary and PASS/FAIL/NEXT; WAIT and recovery only when actually needed. Existing Markdown structure and mandatory Final Validation stay authoritative. Do **not** impose a long field inventory, new YAML parser or boilerplate on every step merely to satisfy planning formality.

- **NONE — No reasoning, just execute.** Prefer deterministic Lisp for AutoCAD work or Python for file/algorithmic work **only when the exact per-step executor is proven callable within the active Job authority**. Builder specifies the registered tool, asset SHA, input/output locations, drawing identity and lease requirements, if any. Operator dispatches only that executor and reads its actual success/failure output; it must not plan or calculate the step with GPT. An unavailable executor is a STOP/PLAN GAP, never permission to fall back to ad hoc model execution.
- **LOW — Minimal bounded reasoning.** Make only a named choice from declared inputs/options within this step, then execute the specified tool. No independent data hunt or alternative workflow.
- **SCOPED — Deep reasoning within explicit boundaries.** Reason as deeply as needed for the *named domain decision* (e.g. MEP relationship/mapping) from authorized inputs. Output a specified data artifact; do not expand CAD scans, rules, tools or other steps.

**Model reasoning is not a substitute for tool execution.** If a step has a deterministic, tested executor, Builder should not make GPT perform the same calculations. Do not force a complex algorithm into Lisp/Python when scoped model analysis is demonstrably the better tool.

### Step outcome rules

- **PASS:** step's declared evidence/output condition is satisfied by real tool/data results; mark the checklist item PASS, then proceed to the specified NEXT step without asking user.
- **FAIL:** actual error, denied authority, failed required postcondition or invalid result; mark FAIL; report original code/message and unexecuted steps; STOP. Only a recovery path **explicitly declared in the approved Job's on_fail clause** may run. A viable alternative tool may be selected **before execution** only if the approved step authorizes it and its stated preconditions hold; alternative availability does **not** authorize a retry/switch **after failure** without an explicit on_fail route. Never invoke a different tool, restart a Job, rescan CAD, bypass permissions or enable Human Power as a model-invented workaround.
- **WAIT:** explicit user/CAD action is outstanding; keep current step pending and resume only according to the declared condition. WAIT is neither PASS nor FAIL and is not a generic confirmation stage.
- **Tool success versus step success:** Lisp `loaded=true` verifies *load*, not necessarily the later execution/update. `loaded=false`, CAD tool error, wrong drawing or incomplete output cannot be marked PASS. Never invent a readback operation that the step or platform does not require.
- **Final Validation (mandatory existing JOB.md section):** retain the existing `## Validation`/`## Final Validation` authoring requirement. It defines the user-approved final output/evidence acceptance, **not** a license for model-invented extra CAD readbacks or new execution stages. If final validation requires a specific action, it must be explicitly authorized by the approved workflow; otherwise evaluate evidence already produced by declared steps and tool/platform checks. Final Validation FAIL blocks Job success.
- **Model checklist is advisory sequencing, not a security boundary.** Existing runtime/tool safeguards stay authoritative. Do not claim complete per-step tool enforcement without demonstrated code support.

### Example: saved Grille Tag job (illustrative, not a change to its installed definition)

| Step | Executor / reasoning | Required result | PASS → | FAIL → |
| --- | --- | --- | --- | --- |
| 1. Read Create System metadata | FILE/Python, NONE | Correct existing metadata resolved for the verified bound drawing | Step 2 | STOP, source error; no CAD rescan |
| 2. Create grille mapping | GPT Web, SCOPED: grille-to-equipment relationship, air type and approved numbering only | Mapping data satisfying the declared schema | Step 3 | STOP and identify unresolved evidence; no invented classification |
| 3. Apply mapping | AutoLISP batch, NONE | Updater reports completed ATT writes per approved output | FINISH | STOP, retain original Lisp/tool error; no one-entity MCP fallback |

Do not silently retrofit this illustrative example onto the currently promoted Grille Tag JOB.md.

## 3. Reuse-first executors, Engine + Data as a technique

**Default preference for sizable AutoCAD changes: reuse proven batch AutoLISP rather than hundreds of entity MCP calls.** CAD MCP remains the approved bound-drawing tool ingress; Python/FILE tools handle deterministic data/files; GPT reasons only for the particular technical decision requested.

**Dynamic Lisp is a *preferred technique*, NOT a distinct tool/runtime**: when appropriate, split a stable `engine.lsp` (reusable algorithm) from a varying `data.lsp` (task inputs). The existing FILE/SYSTEM tools create/read data and existing CAD MCP load/run executes Lisp; no `job_dynamic_lisp_run`, new registry, second Engine or mandatory migration is justified by this pattern. Data can be JSON/CSV or another accepted format if an existing engine already supports it. **Do not split Lisp that already works well without benefit.**

- **Reuse source:** when Job B needs a Lisp capability from Job A, prefer direct load/use of Job A's registered file **read-only**, if the current loader and invocation contract permit it. Copy to Job B only if necessary to modify/independently version it; Job B never writes Job A's source.
- **Registry categories:** effective Registry already catalogs **CAD MCP, SYSTEM MCP and LISP** capabilities (along with Job metadata). Borrow a *capability*, not another chat's Work, ToolLease or Job execution. For registered Job-exposed MCP capabilities, use a unique **Job ID + capability ID** namespace; actual source currently implements `custom:<job-id>:<command>` for a restricted zero-arg standalone-Lisp export, **not** a general Job-owned MCP export. Inspect actual export requirements and only extend the existing registry/index minimally if a real approved Job needs it.
- **Job-owned files:** own runtime/result writable; other Jobs' metadata/results read-only. Keep explicit, user-approved exceptional patch/human power routes separate rather than interpreting generic sharing as write permission.
- **Python inside Reasoning Job:** an executor must truly be callable with valid SYSTEM lease, Job-owned helper/data and lifecycle; `job_run_direct` runs a whole Direct Job, not a per-step helper. Reuse `job_system_run_helper` only when authority and lifecycle are valid, else record a narrow gap, not an ad hoc Python runner.
- **Builder may patch an existing Job-owned Lisp derivative only when necessary**, respecting current source hash/syntax checks and user-approved change. Stable Engine + Data is a preference, not permission for code rewrite.
- **Tool contract truth:** `loaded=true` proves load, `queued=true` proves dispatch, not completed CAD execution. Use only declared Job/tool evidence; do not invent after-action inspections.

## 4. Builder workflow baseline and review discipline

**DISCUSS → APPROVE → IMPLEMENT → REVIEW → TEST → PROMOTE (when requested).** Discussion does not authorize writing implementation/source. Approval must bind a specific workflow and its meaningful user choices.

Approved Workflow Baseline includes overall Job goal, ordered meaningful steps, per-step goal, executor, input/output, reasoning scope, allowed tools, PASS/FAIL/WAIT/NEXT, user interactions, mutation limits and explicitly approved recovery. Preserve an immutable comparison source or exact hash for a particular revision; do not trust an assistant's paraphrase as the baseline.

Builder must compare the final JOB.md against that baseline, including **hidden substeps**, implicit audit/readback, retries, confirmations, fallback tools and business-rule changes. Structural validation alone cannot prove semantic fidelity: use an auditable comparison/diff plus human approval for any material ambiguity. Do not propose an unreliable regex-based semantic gate as complete enforcement.

- **Implementation defect:** broken Lisp/Python, incorrect schema, missing approved action, wrong permission or error handling → Builder may fix and automatically continue review loop within the agreed implementation.
- **Workflow improvement:** extra verification, data scan, retry, confirmation, recovery, new step or altered business mapping → record separately as **NOMINATION**, not a defect blocking compliance with the agreed baseline, and do not implement until user approval.
- **CR/Reviewer:** judge fidelity against approved goals and realistic runtime capability. No scope inflation through iterative review.
- **Legacy Saved Jobs:** existing canonical JOB.md remains valid. A new field/policy must have a documented compatibility mode; only migrate affected Jobs with proven necessity and user-approved business changes, using the current local-compatibility mechanism.
- **Required validation vs improvised checks:** the canonical `## Validation` section must remain; Builder binds its acceptance criteria to existing approved outputs, adding no silent checking steps. Existing `viable alternative tools` declarations are permitted **only** under approved pre-action selection conditions or explicit `on_fail` branching; they are never blanket permission for post-error workaround. Tests must exercise allowed preselected alternative, forbidden post-failure switch, explicitly approved recovery and Final Validation without extra CAD inspection.

## 5. Brownfield baseline and overlapping plans

**Existing, preserve/reuse:**
- `knowledge/cad/ORCHESTRATOR_HARNESS.md` already distinguishes Saved Job, Builder and one-off Temp route and HYBRID work.
- `knowledge/cad/WORKFLOW_EXECUTION_HARNESS.md` already prohibits unsolicited reads, workflow changes and workarounds for established Jobs.
- `knowledge/jobs/REASONING_HARNESS.md` already uses promoted JOB.md + per-run JOB_STEPS.md and stops on real tool failure.
- `src/cadgpt/runtime/job-runtime.ts` explicitly says JOB_STEPS.md is *a checklist, not a workflow engine*.
- `src/cadgpt/tools/jobs.ts` validates Markdown Job structure, retrieves promoted workflow source + SHA and supports Direct Python Jobs; structural validation does not show approved-baseline semantic fidelity.
- `src/cadgpt/lib/work-registration.ts` enforces work/tool-family boundaries, not a proved strict whitelist for each individual reasoning step.
- `src/cadgpt/lib/job-capability-index.ts` already implements lazy Job capability indexing for **reviewed standalone zero-arg Lisp exports** with `custom:<job-id>:<command>` IDs; do not claim it exposes arbitrary Job MCP tools.
- `docs/roadmap/CADGPT-ORCHESTRATOR-V2-IMPLEMENTATION-DETAIL.md` and GSA Job J-6B01 cover adjacent orchestration/capability changes. Reconcile against current main and the ongoing owning work before creating implementation tasks; **do not supersede/restart J-6B01 without a separately authorized plan change**.

**Source review (main `b174ca41800bf017e3c11c296c2113d09cd6da8d`, 2026-10-14; no live host run):**
- `src/cadgpt/runtime/cad-scheduler.ts`: **existing per-host Promise FIFO** (`withCadHostLock`) wraps CAD MCP proxy calls. **KEEP**, test two chats at the actual CAD ingress before altering it. `mcp-session-manager.ts::enqueue` instead queues per transport/session; do not mistake that for a host-wide CAD queue.
- `src/cadgpt/lib/work-registration.ts`: `activeBySession`, `registrations` and ToolLeases are session/Work scoped. `mcp-session-manager.ts` supports distinct logical conversation identities. Keep per-chat control and stop; do not merge their auth/session identities.
- `src/cadgpt/session/drawing-binding.ts`: binding `contexts` is currently keyed by **execution**, with only same-session handoff support. `server-factory.ts::activateCadWorkspace` creates an execution-bound drawing. **Gap to verify/REFINE:** share a *single authoritative verified host-bound drawing* across independently admitted chats; keep each chat's Work/drawing access checks. No per-chat change of the host binding, no auto rebind to active tab, no stale-document retarget.
- `src/cadgpt/runtime/job-runtime.ts`: `executionByJobRoot` enforces **same Job root** exclusion (`JOB_RUNTIME_BUSY`), not global Job exclusion. `src/cadgpt/runtime/system-lease.ts` keys per SYSTEM `tool_id`/Job ID. **KEEP** separate Job A/B execution and same-Job file ownership; do not build per-run directories by default.
- `src/cadgpt/tools/filesystem.ts` enforces Job-owned writable runtime/result roots and read access to approved managed roots; preserve; `file_job_result_patch` has an exceptional, approval-scoped flow, not normal cross-Job write.
- `src/cadgpt/tools/registry.ts` composes internal MCP/system entries, bundled/user Lisp/Jobs and exported capabilities; `job-capability-index.ts` currently implements standalone Lisp export only. Reuse; an unrestricted Job MCP exporter is **not** proven present.
- `src/cadgpt/runtime/cad-upstream.ts` nominally reuses one Python MCP process across ordinary execution IDs, but has context/Human-Power reset paths. `execution-cleanup.ts` already checks `!hasActiveCadWork()` before sleeping CAD backend; **KEEP and test**, rather than adding a replacement connection supervisor. `lisp_service.py::run_lisp_command` returns `queued`. Verify concurrent chat dispatch/cleanup and queued command overlap before any limited code change; do not claim the FIFO waits for actual Lisp completion.
- `src/cadgpt/lib/addin-control.ts` panel pairing/status is session-specific; preserve one Add-in chat UI if desired, while allowing other independently admitted browser chats to attach to the same host drawing. `runtimes/cad-mcp/services/document_service.py` presently labels returned host as `autocad`; `config.py` exposes a `CAD_HOST=vinacad` default. Before a host-specific patch, verify the actual target software and queue host key; do not infer that these configuration names alone prove a collision.

**Still to verify:** real two-chat admission/binding/stop behavior; possible global CAD deactivation when one chat ends; concurrent same/different-Job traces; cross-chat Lisp command ownership/source state; Builder/Operator real GPT behavior; compatibility for current Saved Jobs. No claim of live PASS.

**Other owner:** `docs/roadmap/CADGPT-SOURCE-RELIABILITY-REPAIR-PLAN-2026-10.md` on `plan/cadgpt-source-reliability-repair-20261014` covers source defects (JS replacement, COM incomplete reads, filesystem etc.). **Do not copy its bugfix implementation into this harness draft**. Coordinate only shared behavioral acceptance and verified failures.

## 6. Draft implementation plan (requires separate execution approval)

**Source-aligned minimal change map — proposals to validate, not code approval**

| Component | Action | Narrow repair condition |
| --- | --- | --- |
| `src/cadgpt/session/drawing-binding.ts` | **REFINE** | Replace the assumption that each Work independently owns the physical binding with verified *attach-to-one-host-bound-DWG* semantics; keep per-chat drawing access and the runtime document identity/stale guard. Preserve single-drawing selection. |
| `src/cadgpt/server-factory.ts`, `tools/cad-launcher.ts` | **REFINE only on proven join gap** | Second @cg chat joins the current bound DWG; never evicts Chat A, auto-selects another DWG or creates an extra host binding. Existing Add-in binding remains the user-authoritative selection. |
| `src/cadgpt/tools/work-control.ts`, `lib/work-registration.ts` | **KEEP** | Reuse independent session/Work authority and same-chat handoff; patch only a demonstrated lifecycle or session ownership rejection under two-chat test. |
| `src/cadgpt/runtime/cad-scheduler.ts`, `tools/cad-proxy.ts` | **KEEP / small targeted routing fix if required** | Existing host FIFO is already present; prove all requested CAD ingress uses the same canonical host queue key. Do not add a second FIFO or job-wide lock. |
| `src/cadgpt/runtime/cad-upstream.ts`, `runtime/execution-cleanup.ts`, `lib/addin-control.ts` | **KEEP unless test FAIL** | Normal Work context reuse, `hasActiveCadWork()` cleanup guard, Add-in observer and Human Power exceptions remain; test cross-chat stop/close first. |
| `runtime/job-runtime.ts`, `runtime/system-lease.ts`, `tools/filesystem.ts` | **KEEP** | Job IDs/root ownership and per-Job writable scopes already exist; different Jobs parallel, same Job root still exclusive. No per-run directory redesign. |
| `tools/registry.ts`, `lib/job-capability-index.ts`, existing Lisp loader | **KEEP / narrow extension only for approved missing export** | Reuse effective Registry, namespaced Job exports and direct-read-only or copied Lisp. Do not assert arbitrary exported MCP capability support without source evidence. |
| `knowledge/cad/*`, `knowledge/jobs/*` and Builder guidance | **REFINE** | Remove over-reasoning/advisor/workaround prompts and keep approved Job steps authoritative; do not add a new semantic enforcement runtime. |
| Independent source-reliability repair plan | **SEPARATE** | Fix only confirmed source defects under its own owner/review; don't scope-creep the harness plan. |

## Phase 0 — Evidence-based baseline and integration decision
### GOAL
Find only real missing behavior, preserve stable systems and prevent duplicate implementation of Orchestrator V2.

**Tasks**
1. Freeze current HEAD, map impacted files, tests and live production behaviors; compare current `main` with V2 roadmaps and already completed code.
2. Classify each requirement KEEP / MODIFY / ADD / DEFER. Trace owner, source entrypoint, observed contract, evidence and risk; coordinate with ongoing J-6B01 where scopes overlap.
3. Determine exactly which backward-compatible rules are sufficient vs which installed Job contracts would require explicit migration.
4. **Executor feasibility matrix (CR1):** for each proposed NONE/Python/Lisp step type, identify its actually callable registered tool, necessary work authorization/SYSTEM lease, asset hash, drawing identity, inputs/outputs, lifecycle impact and FAIL behavior. Verify `job_system_run_helper`'s lease restrictions and `job_run_direct`'s whole-Job transition semantics; forbid using `job_run_direct` as a per-step helper. Where no valid per-step call path exists, mark BLOCKED/ADD and design the smallest later approved fix — never assert capability by naming Python alone.
5. **Canonical contract reconciliation (CR2):** map each required JOB.md `## Validation`, allowed `viable alternative tools`, and `on_fail` branch to the Strict Execution rules. Preserve approved final validation and preauthorized alternatives; prohibit inferred retry/fallback after a tool failure.
6. **Multi-chat source trace:** establish exact shared host-bound drawing owner/status and session attach behavior, verify separate Job A/B roots, existing CAD FIFO scope, CAD upstream shutdown/stop behavior, direct Lisp command state and Registry export limits. Prefer a no-new-component change list. Distinguish already working behavior from actual missing paths.
7. **Product-scope audit:** every proposed action must satisfy ASSISTANT (user directs, tool executes). Mark automator/advisor mechanisms DEFER or REMOVE (Job dependency scheduler, design-readiness checks, data-freshness gates, background project workflow planner, separate job-clash manager).

**Exit/PASS:** source-backed KEEP/REFINE/FIX/ADD/DEFER matrix, including real multi-chat limitations, per-step executor/lease feasibility and Final Validation/alternative-route compatibility; no unreviewed duplication or changed Saved Job. Mark host-only claims PENDING.

## Phase 1 — Builder contract and approved-baseline fidelity
### GOAL
Make Builder author a precise executor-first workflow that cannot silently drift from user-approved business steps.

**Tasks**
1. Refine existing `jobcreate`/JOB authoring guidance with only necessary executor, reasoning scope and PASS/FAIL/NEXT details in human-readable Markdown; no new required parser/schema or gratuitous fields.
2. Add a small approval-baseline representation and an observable compare/review step before promotion; do not claim automatic semantic completeness.
3. Keep Nomination separate from actionable defects in Planner/Builder review; detect extra nested checks/retries and unapproved workflow change.
4. Provide compatibility for old JOB.md and guard existing promotion/Job local-compatibility machinery.
5. Bind Final Validation to explicitly approved output/evidence; distinguish permitted pre-action viable alternatives from retries only allowed by explicit on_fail contract.

**Exit/PASS:** positive/negative authoring tests incl. hidden substep, unsolicited user confirmation, permitted preselected alternative, forbidden post-FAIL fallback, and contractual Final Validation; legitimate old Job remains loadable; no surprise promotion/migration.

## Phase 2 — Operator checklist execution behavior
### GOAL
Have the GPT Web Operator behave as a skilled worker: run exactly the registered Job steps, continue on evidence-backed PASS, stop accurately on FAIL.

**Tasks**
1. Tighten **existing** Strict Custom Job and Reasoning Harness instructions at execution entry; avoid contradictory global prompts, redundant loading and extra reasoning loops.
2. Ensure the chosen step action, executor, outcome and NEXT/STOP/WAIT are explicit in the existing checklist. Treat checklist as model guidance, not separate engine.
3. Reuse platform guards for tool errors, incorrect drawing binding, permissions, and source version; add only targeted enforcement when a demonstrable bypass requires it.
4. Simulate tool-call traces for deterministic, low/scoped reasoning, FAIL, WAIT, permitted preselected alternative, explicit on_fail recovery, forbidden post-error workaround and approved Final Validation; run GPT Web host observation where feasible.

**Exit/PASS:** on real or simulated failures, no incorrect PASS or out-of-contract fallback; legal NEXT continues without redundant user prompt; do not claim pure prompt tests prove absolute enforcement.

## Phase 3 — Selective Lisp-first and Engine+Data template
### GOAL
Reduce CAD MCP calls and model involvement without rewriting proven LISP or breaking existing jobs.

**Tasks**
1. Document Builder's AutoLISP-first reuse and deterministic Python selection preference; use an existing registered batch capability where appropriate, but never force Engine+Data restructuring.
2. Demonstrate optional `engine.lsp` + `data.lsp` from existing file/write and Lisp load/run capabilities; no new Tool, Registry or Runtime. For any engine already consuming JSON/CSV, keep that interface instead. Reuse verified Job authority and correct real tool-result status.
3. Demonstrate on a safe representative Job/workload without changing permanent packages until approved. Check reuse of directly borrowed read-only Lisp versus copied Job-owned derivative only when necessary; preserve registered Lisp semantics.
4. Compare equivalent workflows on tool-call counts and verified outputs; reject rewrites that add complexity or lose correctness.

**Exit/PASS:** reproducible before/after batch example; Engine unchanged where possible; measured fewer redundant calls without false claims about latency.

## Phase 4 — One bound drawing / many concurrent chats (minimal refinement)
### GOAL
Allow independently admitted ChatGPT chats to use the **same single host-bound DWG** and run different Jobs simultaneously, without sharing Work identity, writing each other's files or inventing a concurrency manager.

**Tasks**
1. Map actual Add-in host binding and execution-scoped `contexts`. **KEEP** one authoritative host DWG identity (Drawing Anchor + runtime document lifetime), explicit user-controlled bind/rebind, existing header semantics (normal / closed-yellow / inactive-tab-orange). On another chat's @cg admission, attach to the **already bound** host drawing after validation. Never choose a second DWG, infer from active tab, or revoke Chat A merely because Chat B starts.
2. Preserve independent per-chat admission, WorkRegistration, ToolLease, Job Runtime and `cg/stop`. Stop/close Chat A must not invalidate Chat B nor deactivate shared CAD MCP while another authorized chat uses it; closing the *bound DWG* invalidates all users of that DWG with accurate status. Preserve same-chat Work handoff and session continuity.
3. **KEEP current per-host FIFO `withCadHostLock`**. Confirm every relevant CAD command/read/load, including special/direct paths, passes through the existing host ingress in one comparable host ID. Queue only CAD dispatch; never lock entire Jobs or FILE/GPT/Python. If a source bypass is reproduced, fix the narrow ingress routing; don't duplicate scheduler. An async `queued` response is dispatch acknowledgement, not completed command.
4. **KEEP Job-owned files**: Job A writes its own runtime/results, Job B may read them but never mutate them through ordinary Job execution. Job A MTO (FILE/Excel) + Job B Create System (CAD/JSON) + Chat C Builder writing its own files run independently. **User, not CadGPT, decides whether design/metadata is ready for MTO.** Existing `JOB_RUNTIME_BUSY` for **two simultaneous runs of the same Job ID/root** may remain; do not add per-run Job directory or global Job-clash detection.
5. Capability borrowing uses existing **CAD MCP, SYSTEM MCP and LISP Registry categories**: Job-scoped exported MCP capability IDs must be unique by Job ID/name when such exports actually exist; reuse verified index/registry if necessary, no separate Registry. Reuse Lisp directly read-only when valid, copy only when a separate editable version is required; invoke within calling Chat's own Work authority, without “borrowing” another chat's ToolLease.
6. Recheck CAD upstream ordinary-context reuse vs Human Power/reset paths, Add-in pairing/session observer status, and stale binding recovery with two browser chats and Add-in chat. Verify the actual AutoCAD R22.0 production target and whether the optional VinaCAD-related config has any operational effect; do not generalize a host-specific COM/SendCommand result. Include a harmless same-name Lisp command test if command ownership collisions are suspected, without introducing a name manager. Fix only demonstrated breaks. No project/design dependency or freshness logic.

**Exit/PASS:** user can run MTO in Chat A while Create System accesses CAD in Chat B and Builder works in Chat C; one bound DWG throughout, independently scoped results/stops, no global `JOB_RUNTIME_BUSY` for different Jobs, no duplicated or interleaved CAD command submissions, and no extra manager. **Real-host behavior remains PENDING until tested.**

## Phase 5 — Regression, real-host acceptance and handoff
### GOAL
Prove reliable Assistant behavior, multi-chat compatibility and minimal changes on the real host, not just passing prompt or contract assertions.

**Tasks**
1. Run existing build/unit suites from actual `package.json`, preserve actual error evidence and current workflow paths; never invent CI PASS.
2. Exercise Operator PASS→NEXT, FAIL→STOP, WAIT, no workaround, pre-approved alternative, explicit `on_fail`, mandatory Final Validation without invented scans, legitimate Python helper authority, wrong drawing, Lisp load vs queued/run outcome and unchanged legacy Saved Job behavior.
3. **Real ERROR_LOG behavior:** (a) bound-CAD “vẽ lại” uses AutoCAD instead of image generation; (b) repeated CAD count/status question reads current CAD rather than previous conversation; (c) Internal Direct Job failure reports actual failure without model-created low-level Lisp workaround. No standalone Advisor answer substituted for requested action.
4. **Concurrent chat matrix:** A=MTO FILE+Excel, B=Create System CAD+JSON, C=Builder FILE/Lisp authoring; both A and B operate at the same time. Validate independent stop/close, same-Job conflict remains scoped, deliberate bound drawing close/reopen, second chat join, source provenance and read-only cross-Job access. Two CAD requests queue in order using existing FIFO with truthfully reported dispatch/completion.
5. Compare same-task tool-call count/reasoning/latency, source changes and effect on current Add-in header, sleep/wake, anchor, Job A→B. Use user-authorized disposable AutoCAD fixture; distinguish offline test from actual host PASS. Reviewer checks proposed fix necessity and tests (including a negative control). No workflow redesign hidden in a reliability fix.

**Exit/PASS:** needed fixes supported by evidence, no regressions, truthful PENDING for host-only cases, and no change to promoted Job business rules without explicit approval.

## 7. Release boundaries / non-goals

- Do **not** add an independent Workflow Engine, step scheduler, second model, local Operator process, Job Clash Manager, design-completion controller or project-level Automator.
- Do **not** automatically edit, migrate, re-promote or reinterpret existing Saved Jobs and Lisp.
- Do **not** replace Job Registry, Job Runtime, WorkRegistration, existing lease and authorization; **reuse** current CAD Host FIFO rather than constructing a new queue.
- Do **not** enlarge workflow with generic confirmations, readbacks, audits, retries or speculative recovery.
- Do **not** silently change ongoing V2 scope, J-6B01 lifecycle or Human Power rules. Proposed multi-chat **changes the binding access model only after an approved, tested source diff**: one host drawing remains authoritative and the user still explicitly controls rebind.
- Do **not** equate syntax, structural Markdown checks, text-only policy tests or model self-report with actual behavioral correctness.
- Do **not** merge/deploy this proposal until independently reviewed and the user explicitly authorizes implementation.

## 8. Final acceptance examples

1. **Saved Job:** load actual promoted JOB.md; deterministic collect step calls prescribed executor; tool returns PASS → move next without asking; scoped GPT maps only supplied MEP data; batch Lisp writes CAD; report actual result.
2. **Error:** Lisp load reports `loaded=false`; operator reports original failure and pending steps, stops; no manual APPLOAD, alternative CAD MCP calls, CAD rescan, Job restart or false PASS.
3. **Builder:** user approves four business steps; generated JOB.md contains those four steps with explicit executor/reasoning/outcomes and no hidden fifth step; reviewer may separately nominate improvements without inserting them.
4. **Hybrid:** a deterministic file transform uses Python while one source-backed Lisp performs bulk CAD operations; model does not individually mutate hundreds of objects.
5. **Compatibility:** old Job and Direct Job remain executable under their existing source contracts; new policy does not require unapproved mutation.
6. **Real incidents:** user asks “vẽ lại” while bound → CAD action, not image; asks current CAD count twice → fresh CAD read; Direct Job fails → report actual error, not improvised workaround.
7. **Multi-chat:** A=MTO processing Excel, B=Create System reading CAD/writing its own JSON, C=Builder writing Lisp simultaneously, all attached to ONE bound DWG; independent stop; only actual CAD requests go through the existing host FIFO; same Job root remains exclusive.

**Success principle:** *User assigns the work. CadGPT helps execute it fast and accurately. Report the real outcome; do not act as an Automator or unsolicited Advisor.*

## 9. Self-review scope and gates (Planner RL)

**Round 1 — CHANGES_REQUIRED (resolved in R4):** (RL-01) original “existing Operator/Builder harnesses” phrasing could imply the target split was already complete; clarified as behavioral goal subject to evidence. (RL-02) missing minimal source ownership map risked a vague “build more” interpretation; added KEEP/REFINE mapping to actual paths. (RL-03) global CAD shutdown was treated as an open gap despite an existing `hasActiveCadWork()` guard; corrected to KEEP/test, and host version/config reality added. No extra workflow functionality introduced.

**Round 2 — Planner self-review PASS (plan-text only, 2026-10-14).** Entire draft audited section-by-section against the eight gates below. Check results: **A PASS** (user-directed Assistant, no Automator/Advisor); **B PASS** (existing CAD FIFO, WorkRegistration, per-Job runtime/file fences/Registry reused; additions conditional); **C PASS** (one host DWG, multiple independent chats, same-Job root guard, only CAD ingress queued); **D PASS** (CR1 helper authority and `job_run_direct` limitation; CR2 Final Validation and tool alternatives unchanged); **E PASS** (separate J-6B01 and source-repair ownership); **F PASS** (6 phases each with GOAL and bounded exit); **G PASS** (3 real ERROR_LOG behavior cases in Phase 5); **H PASS** (plan-only, no implementation/merge/independent CR claim). The source was read, **not executed**; two-chat AutoCAD R22.0 tests, tool trace behavior and hardware-specific timing remain **PENDING_REAL_HOST**, not plan-text failures. **No further self-review finding** under the approved scope.

The full draft must be checked against: (A) **Assistant product GOAL**; (B) source-backed KEEP/REFINE versus speculative BUILD; (C) drawing single-host / multi-chat isolation, CAD FIFO scope and same-Job ownership; (D) all prior R2 CR1/CR2 repairs on executor authority and Validation/fallbacks; (E) no duplicate scope with J-6B01 or the independent source reliability repair plan; (F) each Phase has its own GOAL and a measurable, non-invented exit; (G) scenarios from actual ERROR_LOG; (H) no source edits/merge/CR PASS claim. Planner may fix **plan text only** to satisfy this loop; a new independent CR must be explicitly requested rather than self-certified.
