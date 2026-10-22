Status: APPROVED

<!-- Bootstrap approval metadata: reflects existing Human approval in GSA on 2026-10-21; formatting addition approved in this setup conversation. All original GSA content follows unchanged. No new product approval or requirements change. -->

# Project Criteria — CadGPT

Status: APPROVED — Human decision 2026-10-21, after documented Technical Advisor consultation
Project ID: 01a0d70c-9683-7324-9d3d-a8231a93c63b
Source: https://github.com/thebimhouseinfo-sudo/Cadgpt
Source-derived baseline: `docs/roadmap/CADGPT_CORE_FUNCTION_V5_BRANCH_PLAN.md` and `docs/roadmap/CADGPT_V5_DETAILED_IMPLEMENTATION_PLAN.md` on `feature/core-function-v5`.
Authority: Human GOAL and explicit product decisions prevail; code, tests and historical checkpoints are evidence, not product requirements.

## GOAL
**PROPOSED FOR HUMAN APPROVAL.** CadGPT is an AI Chat Assistant add-in for CAD. Its main workspace and principal output is the user's drawing (currently DWG in AutoCAD), not a separate standalone deliverable. It lets a Human direct an AI assistant using reusable Job workflows and Lisp tools, keeps the Human in control, and prioritizes faithful execution of user intent over unnecessary AI creativity or autonomy. In the initial CadGPT phase, ChatGPT remains the sole reasoning/planning brain; CadGPT is the add-in, communication, drawing/file/capability bridge, and domain knowledge surface. In the later CAI phase, the AI chat/API provider may vary, but CadGPT/CAI still does not add a second planner.

## WHY / Intended outcome
- A CAD user should work directly in one ChatGPT/CadGPT conversation without needing to manually orchestrate low-level tool leases or draft/promote/test cycles for every change.
- CAD modifications, Jobs and results must apply only to the correct drawing and authorized owner.
- Successful work must mean actual AutoCAD operation and persisted drawing/result evidence, not merely passing source tests.

## Product architecture and operating modes (Human clarification, 2026-10-21)
- **CAD Add-in:** embeds the AI chat interface inside the user's CAD software workspace. AutoCAD is the current host; potential future CAD hosts are product direction, not current implementation scope.
- **CAD MCP:** exposes actual CAD capabilities to the AI, including Jobs, Lisp and drawing operations.
- **Plugin + Tunnel (CadGPT phase):** current transport/connectivity between ChatGPT and the local CAD drawing/runtime; the channel itself is not an AI planner. Tunnel must not be assumed mandatory in CAI's future direct API mode.
- **Knowledge:** domain/workflow and CAD authoring knowledge to help the AI assist in the user's professional context.
- **Drawing Workspace mode:** one drawing is the working context; the user can quickly open and connect multiple independent chat sessions to that same DWG, each able to request its own Job. Non-CAD work may progress concurrently; actual commands/Lisp sent to the same AutoCAD drawing are serialized at the CAD host execution boundary.
- **Standalone mode:** no bound drawing is needed to brainstorm, prepare and author Lisp, or develop Job workflows; it does not grant implicit DWG mutation authority.
- **Human-assist principle:** the aim is to support rather than replace the CAD worker. Only enough initiative and creativity to complete the assigned scope; the real drawing and the Human's requirements are the acceptance anchor.

## Product evolution — CadGPT Phase 1 → CAI (Human clarification, 2026-10-21)
- **Phase 1 — CadGPT:** the first delivery focuses on the AutoCAD drawing assistant with ChatGPT, its CAD Add-in, CAD MCP, Job/Lisp capability packages, Knowledge, and existing Plugin + Tunnel transport. Continue delivering and stabilizing the current CAD workflow.
- **Future product — CAI (CAD AI), strictly after CadGPT stabilization:** CadGPT is the foundation for a broader CAD AI assistant. **Do not start CAI development until CadGPT's core capabilities and real-world AutoCAD workflows are stable and accepted by the Human.** Only then expand to at least **Claude Chat** alongside ChatGPT; this is future product direction, not a claim of current provider support.
- **Future connection mode — direct API:** allow CAI to communicate with an AI service through a **direct API integration without the Plugin/Tunnel path**. Plugin/Tunnel and direct API are connection options rather than new intelligence layers; choose according to the eventual client architecture and supported integration capabilities.
- **Invariant across phases:** the selected AI client/model supplies reasoning; CAI connects it to the CAD workspace, tools, Jobs, Lisp and Knowledge. Preserve the Human-assist and drawing-centric UX, real CAD-host command sequencing, minimal justified gates, and existing Job/Lisp ownership rules.
- **Stability prerequisite — not an artificial gate:** first demonstrate CadGPT works reliably in sustained real AutoCAD use: connection/binding, multiple chats, Job/Lisp execution, safe serialized CAD commands, expected drawing changes and Save, and correct source ownership. Human decides when CadGPT is sufficiently stable to begin CAI; do not invent a numeric SLA, separate certification pipeline or new blocking rituals.
- **Do not pre-build an imaginary platform:** CAI design, Claude Chat integration, API-direct work and other future expansion must remain postponed while CadGPT stabilization is unfinished. The exact Claude Chat integration route, direct-API service/provider, authentication and deployment details belong to the later CAI phase.
- **Boundary:** this future roadmap note does not authorize current CadGPT V5 source changes, migration, release or production deployment.

## UX principle — uninterrupted user workflow (Human correction, 2026-10-21)
- **Primary outcome:** the user connects, opens additional chat sessions, calls Jobs, creates/edits Jobs or Lisp, and continues work on the DWG naturally and smoothly, without being stopped by the application's internal procedures. Fast and stable operation is the default behavior, not an exception granted after passing gates.
- **Invisible internal logic:** technical controls should be handled behind the scenes wherever possible. The user must not be burdened with approval steps, reconnection ceremonies, setup cycles or progress-blocking checks that are not demonstrably necessary for the task.
- **Reasonable preventive assumptions are allowed:** a gate need not wait for a failure to happen. Anticipating a real and plausible user/workflow situation is valid, including a known limitation of AutoCAD or a credible way that editing could accidentally affect established source. The assumption must be grounded in how this product is actually used, not an improbable chain of invented events.
- **Every gate must have a concrete justification at design time:** clearly state (1) which real-world situation can trigger it, (2) why that situation is plausible in the supported CadGPT/AutoCAD workflow, (3) what damage/error the gate prevents, and (4) why this is the least obstructive effective mechanism. Evidence may be an observed defect, an established host constraint, or a credible, explainable foreseeable use case; a prior incident/reproduction is **not mandatory**.
- **Reject unjustified gates:** if the situation has no realistic basis, the protection has no clear effect, or the same goal can be met transparently without blocking the user, omit or simplify the gate. Never use generic "security best practice" alone as justification.
- **Minimize impact of justified controls:** commands/Lisp targeting the same AutoCAD drawing must run sequentially because that is an established host limitation; independent chat/Job preparation and processing remain concurrent. The explicit Human command `cg/update` protects editing one saved Job/Lisp against a realistic accidental overwrite; normal reading, new authoring and Job execution are unaffected.
- **Control only the relevant operation:** a host constraint that requires serial CAD commands does not justify locking an entire Job/chat/workspace. Solve the underlying problem with the smallest practical scope instead of adding unrelated permission, approval or test stages.
- **UX acceptance:** multiple chats connect and work smoothly on one drawing; Jobs start and advance without unnecessary interruption; Builder creates or updates source through the simple existing workflow; confirmed CAD-host conflicts are handled transparently without blocking unrelated work.

## Operator and Builder — fixed role boundary (Human clarification, 2026-10-21)
- **Operator:** only executes Jobs. Reasoning is limited strictly to the allowed reasoning steps/decisions stated in that Job's `JOB.md`; it must not invent new workflow steps, modify source or act as Builder.
- **Builder:** owns tool/workflow authoring and repair with exactly three domain skills described below. Builder may use Knowledge as domain support; Builder reasoning/creativity for brainstorming is distinct from Operator authority.
- **Builder skill 1 — Brainstorm:** open-ended creative exploration, combined with Knowledge, to advise the user, propose approaches, and nominate a suitable workflow for a new Job. Brainstorm output is a proposal, not permission to mutate drawings.
- **Builder skill 2 — Create Job:** a standardized process to gather required information, define workflow/Job steps, create and edit a Job, and register/publish the Job when appropriate and authorized. Registration is a supported authoring action, not a new mandatory gate before a legitimate first run.
- **Builder skill 3 — Write Lisp:** a standard authoring skill combined with Lisp and CAD Knowledge to write correct AutoLISP/Visual LISP, check for errors and repair detected defects **before** loading into the drawing. The self-check is part of responsible authoring, not an additional mandatory live test/promotion stage; actual drawing execution remains bound to the proper workspace.

## Builder — internal MCP development capability (Human clarification, 2026-10-21)
- During **internal CadGPT development**, Builder also has a restricted engineering capability to **write and repair CAD MCP tools/runtime** to accelerate internal tool development and maintenance.
- This is **development-only authority**, separate from the three Builder domain skills (Brainstorm, Create Job, Write Lisp). It is not part of the Operator's Job execution authority and must not grant runtime Jobs permission to modify MCP source.
- When shipping a distributable/customer production build, this MCP development capability must be **removed or effectively disabled and not exposed** via shipped plugin/tool discovery, CAD MCP, add-in, or public execution routes. Merely hiding a UI entry without blocking invocation is insufficient.
- Release acceptance requires evidence that ordinary end users and production AI sessions cannot discover or invoke MCP source-edit/repair operations. Internal development may retain them in an appropriately restricted development build.
- The exact release-time method (remove versus disable) is an implementation choice; either must satisfy the non-exposure/non-invocation product requirement.

## Speed-first operation and minimal source protection (Human clarification, 2026-10-21)
- **User continuity is the default:** justified preventative gates are allowed when tied to a plausible real-world use case or known technical constraint; they do not require a failure to have happened already. Each gate must have an explicit purpose and a minimally intrusive implementation. Neither speculative edge cases without realistic grounding nor generic security/review/approval/revalidation/staging/test/promotion rituals warrant blocking routine work.
- **Read is unrestricted within already-accessible Job/Lisp libraries:** Builder may freely inspect existing Jobs, Lisp, skills and related Knowledge to understand, compare, reuse, debug and prepare workflows. Reading a source file does not require `cg/update` and never grants write access.
- **Small required guard:** saved, working reusable Job and Lisp source is protected against accidental edits. The one canonical manual unlock is the **exact command `cg/update`** issued by the Human. This command covers both existing Job and existing Lisp source; it is not a generic permission to edit the whole library.
- `cg/update` identifies one intended existing Job/Lisp target (reuse an explicitly known selection or ask only for the missing target). **All other Job/Lisp sources remain readable but read-only.** Builder obtains write scope only for the explicitly designated target; no cross-Job/library or unrelated skill/MCP-source write follows from it.
- A natural-language request such as "sửa Job", "update Lisp", "fix this tool", a quotation containing `cg/update`, or an AI-suggested command **must not trigger this edit unlock**. The actual explicit command must be invoked by the Human.
- The unlock is limited to the intended update operation and is not carried into unrelated operations, Operator Jobs, other chat windows or future sessions. It does not require extra Human approval dialogues after the command and target are clear.
- **New authoring is not updating:** Builder may prepare/create a new Job, Lisp or Temp source within its already-authorized folders without `cg/update`; normal Job/Operator execution and Lisp LOAD are not blocked by this guard.
- **Dynamic Lisp Data is operational input:** writing run-specific Data within the Job-authorized runtime is not an Engine/Lisp source edit and does not require `cg/update`. Stable Engine code remains protected.
- Existing working skill/knowledge assets should not be silently rewritten as a side effect of normal chat or Job execution. The `cg/update` command governs saved **Job and Lisp** source only; it does not implicitly authorize skill, Knowledge or CAD MCP source changes.
- **Migration note:** current source documentation may still use `cg/jobupdate` for Job. Planner must update the command route/criteria-dependent documentation and tests to the single `cg/update` behavior when source implementation is authorized; no claim that code already changed.

## Dynamic Lisp — Engine + Data (Human clarification, 2026-10-21)
- A Dynamic Lisp consists of **exactly two conceptual files**: **Engine** (stable reusable execution logic) and **Data** (data consumed by that Engine).
- **Engine:** does not change between drawing-specific executions. Do not rewrite the Engine to inject new drawing data; any deliberate code maintenance is distinct from routine Dynamic Lisp runs.
- **Data:** AI reads/reasons over information collected from the current bound drawing and generates the appropriate Data file for that execution, as permitted by the owning Job's `JOB.md`. **The file may be AutoLISP, JSON or any other practical format.** AI nominates the most suitable format for the intended Engine and workflow; no universal format is mandated.
- **Workflow:** collect relevant drawing facts → AI processes data within its assigned authority → create/update the run's Data file → use unchanged Engine to execute those instructions/data in the bound drawing.
- **Format selection is contextual, not fixed by the platform:** AI nominates a suitable Data representation (for example Lisp, JSON, or another appropriate format); the chosen Engine must actually support consuming it. The specific schema and Engine–Data contract are determined by the Job/Lisp design rather than by a globally enforced extension or new testing gate.
- Data generation must observe the Job's owner-scoped runtime/result permissions and must not change other Jobs' source or results.

## DWG modification — preferred execution path and minimal tool calls (Human clarification, 2026-10-21)
- **Flexible Builder nomination, not a fixed hierarchy:** Dynamic Lisp, Lisp, Macro and Direct Tools are tool families to choose among, **not mandatory steps or an enforced ranking**. Builder reasons about the real task, existing suitable tools, reliability, preparation overhead, quantity/complexity of entities and total end-to-end execution time; it nominates the method that best meets the user's request.
- **CAD-local bulk processing is a strong efficiency heuristic:** when work involves many entities or repetitive operations, prefer an available **Dynamic Lisp Engine** or suitable Lisp to perform work in AutoCAD rather than making one MCP call per entity. This is conditional on actual suitability and overall cost, not an obligation to create a Dynamic Lisp Engine.
- **Minimize end-to-end latency and round trips:** count collection, authoring, Data preparation, LOAD, execution, verification and result reporting. Direct Tools or a Macro may be optimal for small/simple tasks; an ordinary Lisp may be better than creating a new Engine. Avoid a needless tool-type escalation or a new gate.
- **Role boundaries remain unchanged:** Operator selects only among methods/steps permitted by the owning `JOB.md`; only Builder performs open-ended tool nomination/authoring. Respect drawing binding, source ownership and required CAD Host command serialization.
- **Practical decision guidance:** `KNOWLEDGE/CAD_TOOL_SELECTION_GUIDE.md` in this Project Memory contains nonbinding examples and reasoning heuristics for Builder. It does not add a new runtime gate or make the four families a prescribed execution sequence.

## WHAT — product behavior
1. **Drawing binding:** in Drawing Workspace mode, one Work binds one explicit Drawing Anchor; binding never silently jumps to another drawing. The stable Anchor remains identity across path/name/copy/Save As. CAD facts used for execution come from the live bound drawing, not chat history.
2. **Reasoning/roles:** Operator only executes the approved `JOB.md` steps, with reasoning restricted to what that Job permits, and reports tool failures. Builder authors, repairs and registers Job/Lisp/Temp source through Brainstorm, Create Job and Write Lisp skills. Neither role creates an additional autonomous planner.
3. **Job autonomy and host order:** different Jobs may progress independently; one active execution per same Job ID. Commands affecting the same AutoCAD host are serialized, not all file/analysis work globally locked. CAD → SYSTEM → CAD transitions must retain Job context.
4. **Source & Registry:** Builder authors new Job/Lisp directly in final owned folders. Editing an **existing saved Job or Lisp** requires the exact Human-issued `cg/update` command and an explicit target. Natural-language edit requests cannot activate existing-source write authority. The previous `cg/jobupdate` is to be superseded by this one canonical command during implementation; it must not remain a separate bypass after migration. Explicit Promote remains available for discovery metadata, but editing already-authorized source does not require renewed registration, SHA proof or mandatory draft/checkout/test/promote.
5. **File ownership:** Builder may read existing Jobs/Lisp across accessible managed libraries without an edit unlock; `cg/update` limits edits to the one selected saved Job or Lisp. During execution, each Job can write only its own authorized runtime/data and bound Drawing Anchor result folder, may read/borrow other Job capabilities, and may never modify another Job's source/runtime/results. No broad library write permission.
6. **Temporary Jobs:** use unique AppData Temp directories and need no mandatory JOB.md/registration. Explicit cleanup must not remove active Temp Jobs or durable named results. Reusable Temp Lisp may be published independently on explicit request.
7. **Lifecycle:** `cg/jobstop` stops only the selected Job at a safe boundary; it must not stop the entire Work, unbind the drawing, kill AutoCAD or disconnect CAD MCP. Re-running a finished/stopped Job is permitted.
8. **Persistence:** Job runtime scratch is disposable/overwritten per run; failure diagnostics are retained until safely replaced, while timestamped results persist according to each Job contract. Changes to the DWG require a real Save after the last mutating operation, and Save failure must not be reported as DONE.
9. **UX/runtime:** smooth work is the overriding UX goal: fast connection, quick additional chat sessions on one DWG, stable sustained operation and frictionless Job creation/execution. Prefer a small number of high-value CAD calls and local Engine-side bulk processing over repeated tool calls per entity. Internal safeguards stay unobtrusive. A prospective gate is permitted when its triggering real-world situation and benefit can be explained and the restriction is minimal; no need to wait for the incident to occur. Serialize CAD-host commands/Lisp only as needed by the host without blocking unrelated work. Do not launch AutoCAD implicitly, invent timeouts that mask errors, or replay uncertain non-idempotent CAD writes.

## Current use / scale
- Current: Windows AutoCAD user environment with ChatGPT, CadGPT add-in, MCP, custom Lisp and Jobs; independent Job workflows around one bound drawing.
- **Committed future direction (deferred):** only after CadGPT is stable and Human accepts the core workflow, evolve into **CAI (CAD AI)** supporting Claude Chat and a direct AI API connection without tunnel. Until that point, focus implementation on CadGPT stability; this does not alter current V5 execution obligations.
- Commercial multi-tenant requirements, API provider contracts, authentication, licensing, gateway design and other scale assumptions remain **CHUA_CHOT**. No enterprise RBAC, quota gateway or SaaS architecture may be inferred as an immediate V5 requirement.

## Non-goals / forbidden drift
- No second reasoning agent, background self-planner, mandatory fake CAD simulation, separate Job TEST or draft/checkout stage.
- No whole-Job/global file lock beyond actual owner/host safety, no automatic Promote or arbitrary compatibility/security gate lacking a credible real-world situation and explicit purpose. Keep the narrowly scoped `cg/update` source-edit protection.
- No automatic merge/rebase V5 into `main`, no silent force push or production deployment.
- No MCP source-authoring/repair developer capability exposed or callable in the shipped customer build.
- No cross-project RevitGPT changes under this CadGPT project.
- Do not start CAI multi-provider/API-direct implementation before real-world CadGPT stability and Human acceptance; do not use future CAI scope as a V5 bootstrap blocker or justification for speculative adapters/security gates.

## Acceptance — proposed measurable product outcomes
- Real controlled AutoCAD execution on a copied nonproduction DWG demonstrates stable bound Anchor, legitimate CAD/FILE operations and no cross-drawing edits.
- A new Job or Lisp can be authored promptly, while changes to an existing saved Job or Lisp require Human's exact `cg/update` and only the selected target can be edited. Natural-language requests do not unlock source writes; Job execution, authorized Dynamic Lisp Data creation and ordinary LOAD remain fast without redundant gates. Explicit Promote remains usable but non-blocking.
- Different Jobs can run independently; duplicate same-Job start is rejected; Job stop/restart and CAD → SYSTEM → CAD work without losing binding.
- Temp Lisp LOAD/RUN, selected Lisp publication, runtime cleanup and persistent Drawing Anchor results work without unauthorized writes.
- A Dynamic Lisp executes drawing-specific Data through the same unmodified Engine. Data can be Lisp, JSON or another appropriate AI-nominated format supported by that Engine; the Operator generates Data only where `JOB.md` authorizes that reasoning.
- Builder flexibly nominates Dynamic Lisp, Lisp, Macro or Direct Tools by actual suitability, existing capabilities and total end-to-end latency; for repeated/multi-entity work, it preferentially uses efficient local CAD/Engine processing over excessive MCP round trips, but no tool order is mandatory or blocking.
- Builder's Write Lisp workflow catches and repairs diagnosable AutoLISP/Visual LISP errors before actual drawing LOAD, without imposing a separate mandatory CAD test gate.
- Standalone mode can prepare Lisp and Jobs without an active DWG; Drawing Workspace mode permits quick stable connection of multiple independent chat sessions to the same DWG, with simultaneous independent Job progress and queueing only of commands/Lisp that actually use the AutoCAD host.
- Last DWG mutation is actually saved; failed Save prevents DONE; known existing Jobs and toolkit functionality remain compatible.
- Development builds permit authorized Builder MCP tool development, whereas a release build demonstrably removes or blocks exposure and invocation of MCP source-write/repair functionality.
- Relevant source build/regression tests pass and native CAD outcomes are recorded separately as PASS/FAIL/UNVERIFIED. Source CI PASS alone is not native CAD PASS.

## Branch/release boundaries
- Development: `feature/core-function-v5`, independent of `main`.
- Release target: `main` only after distinct Human acceptance, comparison of main-only maintenance and rollback safety. This Criteria draft does not authorize a release.

## Observed source inconsistencies for later Plan/Reviewer
- README retains historical draft/checkout requirements conflicting with V5 proposed behavior; this is not new Human Criteria.
- Native gate scenario about two parallel executions of the same reusable package conflicts with the later detailed V5 one-active-execution-per-Job-ID decision. Reconcile the test document to the Human goal during planning; do not inflate the product with a new concurrency architecture.

## Approval
- Human decision: APPROVE — Human explicitly said `Chốt criteria` after the initial Technical Advisor advice and flexible tool-choice clarification on 2026-10-21.
- Technical Advisor: ADVISED — actual Human-visible consultation in this conversation before Human approval.
ADVISOR SIGNED: ADVISED | BASELINE=856c1a857458812f303e6eef533c424b0e3f60d6 | SCOPE=Initial CadGPT Criteria; CAI deferred until CadGPT is stable; flexible Builder tool selection; minimal justified gates | ADVICE_REF=2026-10-21 Human-visible Technical Advisor advice; baseline 856c1a857458812f303e6eef533c424b0e3f60d6
- Advice scope covers initial product Criteria, CadGPT stability before CAI, Builder/Operator role boundaries, Dynamic Lisp, real AutoCAD host constraints, and choice of methods by contextual reasoning (not fixed tool sequence).
- This acknowledgement is evidence of advice delivery only; Human approval is independent.
