# CadGPT — Reliable Worker Harness Upgrade
## GOAL

Turn CadGPT into a **reliable, high-quality technical worker, not a consulting agent**: it understands the assigned task, executes the approved workflow in order, reasons only where the workflow asks it to, uses the right executor, continues automatically on PASS, and stops with the real error on FAIL.

**Observable success:** fewer unnecessary reasoning turns and CAD MCP calls; no unsolicited workflow additions, duplicate confirmations, arbitrary workarounds, or false success; stable Saved Jobs and correct drawing binding. Accuracy and correct scope take priority over superficial speed.

**Hard constraints:** one GPT Web model; two execution harnesses (Operator and Builder) sharing the **existing** CadGPT runtime; **no second Workflow Engine or local agents**; maintain the existing Job Runtime, WorkRegistration, Drawing Binding, permissions and SYSTEM leases. This is a development plan, not authorization to alter current Saved Jobs or application code.

**Status:** PLAN ONLY — original revision received independent CR FAIL (three findings); this revised plan resolves the documented findings and is subject to current-revision planning review. Independent CR is human-invoked and is not auto-repeated. Implementation, merge and deployment are not authorized by saving or reviewing this plan.

## 1. Product contract and authority

- **Operator = execute:** automatically selected for *registered/promoted Saved Jobs*. Read the current promoted JOB.md, use its selected branch and per-job JOB_STEPS.md checklist. Do not redesign, add checks, replan, modify packages, improvise recovery, or substitute lower-level tools after a failure.
- **Builder = develop:** automatically selected for new/refined Saved Jobs, Lisp/dynamic Lisp, CAD MCP/add-in/runtime/knowledge development, and one-off Temp/Disposable Jobs. May debug and review implementations, but **must not add business steps or change an approved workflow**.
- **Direct command = direct execution:** an already registered simple tool/command needs neither a new Job nor the full Builder lifecycle.
- **User = workflow authority:** discusses requirements first and explicitly approves workflow-changing implementation. Running a registered Saved Job is itself execution intent; do not request another general approval.
- **Runtime = infrastructure safety:** enforce drawing/Work identity, tool-family/work authorization, file boundaries, source hashes, lease/lifecycle and real tool-result errors. **Do not build a duplicate business-step scheduler**.
- **Current JOB.md is authoritative for Operator; approved workflow baseline is authoritative during Builder authoring.** An unpromoted discussion cannot silently replace an installed JOB.md.

## 2. Executor-first, reasoning-on-demand contract

Each new/refined Reasoning JOB.md step must specify:
`step_id`, `goal`, `input`, `action`, `executor`, `allowed_tools`, `reasoning_level`, `reasoning_scope`, `output`, `pass_condition`, `on_pass`, `on_fail`; add `on_wait` **only** if the workflow genuinely needs user/CAD interaction. Include forbidden actions when ambiguity could cause drift. Use existing Markdown Job structure rather than introducing a mandatory YAML parser.

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

## 3. Lisp-first, Hybrid Engine + Data

**Default design preference for operations affecting AutoCAD: AutoLISP first.** Use CAD MCP as the authenticated, drawing-bound control plane for necessary Lisp load/run and explicit reads; avoid hundreds of per-entity MCP calls when one supported Lisp batch suffices.

- **Lisp engine:** stable, tested implementation for collect/select/hide/unhide, geometry, blocks, ATT, layer and batch updates.
- **Dynamic data:** JSON/CSV/Lisp data prepared from deterministic Python or a narrowly scoped GPT reasoning result. Engine reads the data; model changes data rather than mutating engine code on every run.
- **Python:** deterministic file, mapping and calculation work that does not require CAD transaction context; prefer direct/fixed execution when the **complete job** is deterministic. For a Python step inside a Reasoning JOB.md, **do not call `job_run_direct` as a per-step helper**: it dispatches an entire Direct Job and may release prior Job authority. The existing `job_system_run_helper` requires an active Job-owned SYSTEM lease, hash-pinned `tools/**` script and JSON input under the owning Job runtime; inspect its availability/lifecycle compatibility at Phase 0. If no approved, usable per-step path exists, record a bounded implementation gap and fail closed rather than inventing a route.
- **Existing source reuse:** keep a proven Lisp unchanged where it already accepts external data. If truly necessary, Builder may create a Job-owned dynamic derivative by copying the working source and patching only approved dynamic sections using existing hash/syntax checks. Avoid speculative wrappers and wholesale rewrite.
- **Compatibility:** never auto-rewrite installed Lisp or change existing job bundles as part of this architectural rollout; conversion to Engine+Data is selective and evidence-based.

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
- `src/cadgpt/lib/job-capability-index.ts` already implements lazy Job capability indexing; reuse it, do not rebuild it.
- `docs/roadmap/CADGPT-ORCHESTRATOR-V2-IMPLEMENTATION-DETAIL.md` and GSA Job J-6B01 cover adjacent orchestration/capability changes. Reconcile against current main and the ongoing owning work before creating implementation tasks; **do not supersede/restart J-6B01 without a separately authorized plan change**.

**Still to verify** (not claimed implemented): explicit NONE/LOW/SCOPED step contracts in Builder, reliable baseline fidelity review, routed Operator/Builder behavior under real GPT Web, tool-call trace behavior (vs text-only tests), compatibility for installed legacy Jobs, and realistic end-to-end Lisp Engine+Data examples. The existence of prompt instructions is not proof that the model follows them.

## 6. Implementation plan

## Phase 0 — Evidence-based baseline and integration decision
### GOAL
Find only real missing behavior, preserve stable systems and prevent duplicate implementation of Orchestrator V2.

**Tasks**
1. Freeze current HEAD, map impacted files, tests and live production behaviors; compare current `main` with V2 roadmaps and already completed code.
2. Classify each requirement KEEP / MODIFY / ADD / DEFER. Trace owner, source entrypoint, observed contract, evidence and risk; coordinate with ongoing J-6B01 where scopes overlap.
3. Determine exactly which backward-compatible rules are sufficient vs which installed Job contracts would require explicit migration.
4. **Executor feasibility matrix (CR1):** for each proposed NONE/Python/Lisp step type, identify its actually callable registered tool, necessary work authorization/SYSTEM lease, asset hash, drawing identity, inputs/outputs, lifecycle impact and FAIL behavior. Verify `job_system_run_helper`'s lease restrictions and `job_run_direct`'s whole-Job transition semantics; forbid using `job_run_direct` as a per-step helper. Where no valid per-step call path exists, mark BLOCKED/ADD and design the smallest later approved fix — never assert capability by naming Python alone.
5. **Canonical contract reconciliation (CR2):** map each required JOB.md `## Validation`, allowed `viable alternative tools`, and `on_fail` branch to the Strict Execution rules. Preserve approved final validation and preauthorized alternatives; prohibit inferred retry/fallback after a tool failure.

**Exit/PASS:** bounded gap-and-dependency matrix including per-step executor/lease/lifecycle feasibility and Final Validation/alternative-route compatibility; no unreviewed duplication or changed Saved Job; source/test evidence (not claims of runtime PASS).

## Phase 1 — Builder contract and approved-baseline fidelity
### GOAL
Make Builder author a precise executor-first workflow that cannot silently drift from user-approved business steps.

**Tasks**
1. Amend existing `jobcreate`/JOB authoring guidance with per-step executor, NONE/LOW/SCOPED, input/output, constraints and PASS/FAIL/WAIT/NEXT in human-readable Markdown.
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
1. Document Builder's AutoLISP-first and deterministic Python selection policy; use an existing fixed/batch capability where appropriate.
2. Define a minimal Engine+Data input/output contract, including validated drawing identity, data schema/version, load/run result and failure reporting. Reuse only the Phase 0-verified per-step executor with correct authority and no unexpected Job transition.
3. Demonstrate on a safe representative Job/workload without changing permanent packages until approved. Preserve currently registered Lisp semantics.
4. Compare equivalent workflows on tool-call counts and verified outputs; reject rewrites that add complexity or lose correctness.

**Exit/PASS:** reproducible before/after batch example; Engine unchanged where possible; measured fewer redundant calls without false claims about latency.

## Phase 4 — Regression, real-host acceptance and handoff
### GOAL
Prove reliability and compatibility, not just presence of contract fields or passing string assertions.

**Tasks**
1. Run existing build/unit suites from `package.json`, preserve source-diagnostic errors and current workflow paths; never invent CI PASS.
2. Add behavioral tests for PASS→NEXT, FAIL→STOP, WAIT, no workaround, approved pre-action tool alternatives, explicit on_fail recovery, mandatory Final Validation without phantom scans, per-step Python helper lease/identity, no `job_run_direct` misuse, low/scoped reasoning boundaries, wrong drawing, Lisp load result and relevant output validation.
3. Validate current Saved Job compatibility, Temp/Direct commands, Job A→B handoff, SYSTEM lease and AutoCAD binding invariants.
4. Use real GPT Web and user-operated AutoCAD acceptance for scenarios that mocks cannot prove. Compare latency/tool calls on equivalent workload and report unverified host-only outcomes explicitly.

**Exit/PASS:** evidence-backed regressions green; real-host cases marked PASS, FAIL or PENDING truthfully; no change to promoted Job business rules.

## 7. Release boundaries / non-goals

- Do **not** add an independent Workflow Engine, step scheduler, second model or local Operator process.
- Do **not** automatically edit, migrate, re-promote or reinterpret existing Saved Jobs and Lisp.
- Do **not** replace Job Registry, Job Runtime, WorkRegistration, existing lease and authorization.
- Do **not** enlarge workflow with generic confirmations, readbacks, audits, retries or speculative recovery.
- Do **not** silently change ongoing V2 scope, J-6B01 lifecycle, current drawing binding rules, or Human Power rules.
- Do **not** equate syntax, structural Markdown checks, text-only policy tests or model self-report with actual behavioral correctness.
- Do **not** merge/deploy this proposal until independently reviewed and the user explicitly authorizes implementation.

## 8. Final acceptance examples

1. **Saved Job:** load actual promoted JOB.md; deterministic collect step calls prescribed executor; tool returns PASS → move next without asking; scoped GPT maps only supplied MEP data; batch Lisp writes CAD; report actual result.
2. **Error:** Lisp load reports `loaded=false`; operator reports original failure and pending steps, stops; no manual APPLOAD, alternative CAD MCP calls, CAD rescan, Job restart or false PASS.
3. **Builder:** user approves four business steps; generated JOB.md contains those four steps with explicit executor/reasoning/outcomes and no hidden fifth step; reviewer may separately nominate improvements without inserting them.
4. **Hybrid:** a deterministic file transform uses Python while one source-backed Lisp performs bulk CAD operations; model does not individually mutate hundreds of objects.
5. **Compatibility:** old Job and Direct Job remain executable under their existing source contracts; new policy does not require unapproved mutation.

**Success principle:** *Worker first. Reason only where needed. Execute the prescribed tools. No unsolicited consulting.*
