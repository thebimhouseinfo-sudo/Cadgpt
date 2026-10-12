---
title: CadGPT — Bound Drawing Continuity in an Active Add-in Session
document_type: DETAILED_IMPLEMENTATION_PLAN
status: CR_REVIEW_REQUIRED
review_status: CR_PASS_WITH_MINOR_FINDING
implementation_status: NOT_STARTED
priority: P0
source_repo: thebimhouseinfo-sudo/Cadgpt
source_baseline: adaf5b4b08f327c21354852e5e4a8dc1b013e8d7
working_branch: fix/bound-drawing-work-handoff-20261012
review_owner: Critic Reviewer
merge_allowed: false
---

# CadGPT — Fix Bound Drawing Context Loss in an Active Session

> **STATUS: CR_REVIEW_REQUIRED / CR REVIEW REQUIRE.** This document is a **planning draft**, not a CR-approved implementation or a confirmed root-cause analysis. **Do not implement, merge, deploy or mark PASS** until an independent Critic Reviewer reviews this plan, source-derived failure hypotheses and intended regression tests. Source and real AutoCAD host verification are separate checkpoints.
>
> **User-reported defect:** while continuously interacting with CadGPT in the AutoCAD add-in, the chat/Work loses access to the **already bound drawing**. The drawing may still be open and named in the panel. The defect must be investigated and fixed without attributing it to sleep, inactivity or an unconfirmed Node restart.
>
> Plan-only branch from \`main@adaf5b4b08f327c21354852e5e4a8dc1b013e8d7\`. This plan is deliberately limited to **drawing binding and Work-context continuity within an active session**. The unrelated tray self-heal/transport investigation is not permission to broaden the patch.

## 1. Scope, invariants and evidence rules

**Functional invariant:** once a user has bound one drawing in a live add-in session, normal requests, Job A→Job B, Job Builder→Custom Job, and Temp work in the **same logical session** must preserve the exact verified binding unless there is an actual explicit unbind, drawing close/reopen (different document lifetime), a new user-selected drawing, or a genuine end of the owning session.

- The **primary bound drawing is stable** across tab switches and across routine work transitions. Never auto-bind to the active tab or infer a DWG by display name.
- \`HYBRID\` is the default for every Work. An **explicit** \`FILE\`/\`CAD\` exception still obeys its tool-family boundary; the implementation must not silently permit FILE calls under CAD-only or CAD calls under FILE-only.
- Drawing identity means verified \`drawing_id\`, full path, **runtime_document_identity**, actual session/Work ownership and, separately where verified, Drawing Anchor. Do not fabricate identity from a retained add-in header label.
- A Job-only metadata read that uses an existing verified Drawing Anchor does not need a gratuitous live CAD scan. A request about **current live CAD state** must still verify live binding/document lifetime.
- Tool leases in flight must remain protected. A failed transition must not silently destroy a previously usable Work or leak its authority token to another session. Avoid new Job Runtime/Temp scheduler/auto-recovery mechanisms.
- Any missing proof stays \`UNCONFIRMED\`. Never label a suspected race or a test's forced schedule as the demonstrated cause of the user's incident.

**Explicit non-goals:** rewriting tray health thresholds; global acceptance of headerless MCP requests; changing timeout, app sleep/wake policy or license; blanket bypass of drawing validation; broadening metadata file write permissions; redesigning Job MTO rules; merging before CR.

## 2. Current source-grounded findings (not yet a definitive incident attribution)

| Ref | Exact source seam | Verified behavior / open question |
| --- | --- | --- |
| F1 | \`src/cadgpt/lib/work-registration.ts\`: \`createWorkRegistration\` around lines 225–263 | When the owner changes and prior work is not busy, the old registration is **deleted** and \`expirationHandler(priorId)\` is scheduled **without waiting** before the successor is created. There is no atomic staged handoff here. |
| F2 | \`src/cadgpt/tools/work-control.ts\`: \`cadgpt_work_start\` around lines 187–266 | Normal reuse happens only for the same \`ownerType\`, \`ownerId\`, \`executionPath\`. Otherwise creation precedes \`handoffSingleBoundDrawingForExecution\`, \`handoffVerifiedDrawingMetadataRoot\`, then explicit old cleanup. A cleanup scheduled earlier is not coordinated with handoff. |
| F3 | \`src/cadgpt/server-factory.ts\` and \`src/cadgpt/runtime/execution-cleanup.ts\` | \`setWorkExpirationHandler\` points to \`cleanupExecutionState\`; that function eventually clears execution-bound CAD contexts and metadata. **Hypothesis:** under an unfavorable async schedule, old cleanup can erase the only handoff source before it is copied. This is **not yet reproduced** by a controlled test. |
| F4 | \`src/cadgpt/session/drawing-binding.ts\` | Binding is keyed by execution ID. Single-drawing handoff copies only if the old map has exactly one entry. \`activateDrawingContext\` can invalidate a stale runtime document lifetime, correctly refusing to re-bind by name. These are intentional safety gates, not defects by themselves. |
| F5 | \`tests/job-hybrid-default.test.mjs\` | Happy-path HYBRID Job handoff succeeds; explicit \`job_nonhybrid_path: file\` intentionally gets **no CAD drawing handoff**. Need trace the user's actual path and whether an exception was explicitly requested, instead of declaring this behavior a bug. |
| F6 | Add-in header / \`BindingHeaderEvidence.cs\` and \`ChatView.xaml.cs\` | The panel can preserve a last confirmed drawing label over incomplete status. **Displayed name ≠ verified current Work drawing ownership.** Establish whether header is merely stale or Work really lost a previously valid binding. |
| F7 | \`src/cadgpt/lib/mcp-session-manager.ts\` | Transport detach may preserve logical Work state; an explicit logical-session disposal may clean it. Test context continuity across legitimate transport rotation separately. Do not assume every repeated MCP initialize means loss. |

**Incident root cause: UNCONFIRMED.** F1–F3 are credible race candidates; F5–F7 are alternative paths that require evidence. A detailed plan must not make one explanation certain until a failing test/runtime trace supports it.

## 3. A0 — Evidence and deterministic reproduction BEFORE any fix

Read and record exact \`main\` SHA and input path from add-in to tool, including:

- Add-in observed bound drawing name/path and local runtime document ID vs MCP \`drawing_binding_status\`/bound contexts; original and successor execution ID, generation, owner, requested execution path.
- Requested action and sequence (for example Job Builder → MTO, Create System → MTO, Temp → CAD); the precise tool that first returns \`BOUND_DRAWING_CONTEXT_UNAVAILABLE\` or \`NO_ACTIVE_WORK\`.
- \`cadgpt_work_start\` inputs, whether it reused/created Work and whether \`drawing_handoff\` / \`drawing_metadata_handoff\` was returned. Do not log authority tokens.
- \`createWorkRegistration\`, expiration-handler schedule/start/finish, \`handoffSingleBoundDrawingForExecution\`, \`cleanupExecutionState\` start/finish, \`resolveDrawingContext\` and \`activateDrawingContext\`, in order by monotonic operation sequence and execution IDs.
- Check whether the Work switched to explicitly requested FILE-only, had more than one drawing, the bound document actually closed/reopened, or the logical session was intentionally disposed.
- Correlate timestamps/session with available local logs without assuming sleep, Node restart, or a user interruption.

**Tests to write FIRST (failing when defect is reproduced):**

1. **R01 — Forced cleanup race:** bind exactly one verified drawing to Work A. Start Work B through the actual \`cadgpt_work_start\` callback and deterministically allow expiration cleanup of A to reach \`clearExecutionDrawingContexts(A)\` before handoff. Assert B must retain exactly that drawing. Current source is a credible candidate to fail; record observed result rather than claiming it upfront.
2. **R02 — Prepare failure:** force \`prepareFamilies(B)\` to throw after transition started. Assert intended rollback/diagnostic contract: original user-visible active work is not silently lost; no stale authority, orphan context, leaked lease or unintended CAD deactivate.
3. **R03 — Reuse:** same HYBRID Work owner/path; no new execution ID, no binding transfer, no extra cleanup, no additional CAD calls.
4. **R04 — Job chain:** drawing bind → Job A → Job B/MTO → read stored metadata under the correct verified Drawing Anchor → optional live CAD read. Keep the same document-lifetime identity, no guessed \`ActiveDocument\` and no forced full-drawing scan.
5. **R05 — Explicit FILE-only:** retain current family-deny policy and expected absence of CAD handoff; trace whether actual MTO workflow truly requested it and test a valid HYBRID selection separately.
6. **R06 — Multiple/closed/reopened drawings:** two possible bindings must not be guessed; document lifetime mismatch must fail closed with explicit reason.
7. **R07 — Active chat plus MCP transport rotation:** with original logical identity preserved, ensure Work and drawing remain accessible and distinct from transport ID. A changed logical identity must not inherit another session's drawing.
8. **R08 — Header continuity:** header may retain last confirmed DWG label while runtime reports unbound; distinguish display state from an actual binding proof. A real binding loss must be observable independently of header color.

Use existing test harness, mock CAD upstream where needed and **real functions/async scheduling**, not regex-only tests. Test failures must include before/after context counts and order. A source-only simulation is evidence of a possible interleaving, not a live AutoCAD incident attribution.

**A0 exit:** at least one repeatable failure matching the **lost binding in an active session**, or a documented \`UNCONFIRMED/REPRODUCTION_REQUIRED\` result with next evidence needed. Do not blindly implement a suspected race.

## 4. A1 — Transaction-safe Work handoff (conditional on A0 evidence)

If R01/R02 confirms destructive interleaving, change the Work lifecycle so the old binding cannot be deleted before a successor is ready:

1. **Prepare successor** without retiring A or starting A's asynchronous expiration cleanup. Keep old Work active until the handoff and required preparation are safe to commit. Reuse the existing \`createSuccessorWorkRegistration\` / commit-or-cancel pattern **where compatible**; do not fork a second registration model.
2. Require same logical session and single verified context for automatic handoff; copy drawing context to B only through existing validated handoff, preserve exact runtime document identity and metadata read-only boundary.
3. **Commit** active Work B only after preparation succeeds; **then** retire and clean up A exactly once. Ensure cleanup of A cannot delete B's transferred context or deactivate CAD while B retains an active CAD Work.
4. On failure, remove staged B and its staged context/authorization; keep A's current handle, binding and in-flight safety intact. Report the failure instead of silently rebinding to a different DWG.
5. If existing successor primitives cannot handle HYBRID→HYBRID Job A→B correctly, document the minimal adjustment to them and add direct tests. Do **not** weaken session boundaries or issue duplicate authority tokens.
6. Explicit FILE-only transitions remain allowed only by deliberate override and must not be treated as HYBRID; avoid accidental loss of the user's primary bound drawing in the add-in. Whether a separate session-level persistent drawing reference is needed must be decided by the reviewer from reproduced cases, not assumed.

**A1 exit:** R01–R06 PASS under forced interleavings, including rollback, and no new permission bypass.

## 5. A2 — Binding evidence and user-visible diagnostics (only what the bug needs)

- Add **structured continuity diagnostics** at boundary transitions, not heavyweight generic telemetry:
  \`transition_id\`, timestamp, safe logical-session fingerprint, previous/new execution ID and generation, owner/path, CAD context count, \`drawing_id\`, safe document-lifetime fingerprint, handoff result, cleanup phase, exact failure reason.
- Never log authority tokens, pairing secrets, raw drawing file contents or private chat text. Use the existing \`continuity-diagnostics.ts\` sanitization/fingerprinting conventions.
- Distinguish \`NO_WORK\`, \`DRAWING_NOT_BOUND_FOR_WORK\`, \`MULTIPLE_DRAWINGS_BOUND\`, \`BOUND_DRAWING_STALE\`, \`WORK_HANDOFF_FAILED\`, \`WORK_PREPARE_FAILED\`, \`SESSION_IDENTITY_MISMATCH\` at the correct layer. Preserve existing error codes for callers where compatibility requires; expose more precise structured cause instead of blanket red header.
- Add-in header remains driven by AutoCAD's real open/active tab state; a live Work error should show an actionable **Work binding mismatch** without claiming the bound DWG was closed. Avoid temporary health polling gaps changing its color.
- If instrumentation disproves F1–F3 and shows another path, update CR and implementation plan **before** changing unrelated code.

**A2 exit:** reproduction gives an unambiguous phase/cause code and can be distinguished from transport-only detach, stale DWG lifetime and intentional unbind.

## 6. A3 — Regression, performance and real AutoCAD verification

**Source verification** on the implementation branch: \`npm run build\`, \`npm test\`, applicable Lisp syntax checks if Lisp changed, and GitHub Actions Core CI/Registry Contract/Authoring Integrity/Runtime Roadmap Gate/Local Acceptance Contract as applicable. Always report exact tested commit SHA and actual pass/fail.

**Executable regression matrix:**

| ID | Work/case | Acceptance |
| --- | --- | --- |
| T01 | Add-in bound → Temp HYBRID → Job HYBRID → CAD action | One exact DWG identity available after each transition |
| T02 | Job A → Job B/MTO, rapid calls, forced cleanup timing | No transient zero-context and no wrong-document fallback |
| T03 | Job B preparation fails | Consistent original Work and binding; no old-authority use by B |
| T04 | Same Work reused 100 times | No new Work, no cleanup, no extra CAD activation |
| T05 | Another tab active, same bound DWG open | Header orange as designed; commands still target bound DWG |
| T06 | Bound DWG closed and reopened under same name | \`BOUND_DRAWING_STALE\`, explicit rebind required |
| T07 | Two bindings or ambiguous identity | No automatic handoff guessed |
| T08 | Explicit FILE-only and CAD-only work | Existing family gates still deny unauthorized tools |
| T09 | MCP transport rotation with same logical chat | Work/binding persist when logical session retained |
| T10 | Lost logical identity/new conversation | No borrowing another session's binding |
| T11 | Existing verified metadata after handoff | Correct Drawing Anchor root; no unnecessary CAD wakeup |
| T12 | Header says bound but Work binding missing | Diagnostic reports Work/binding mismatch, not fake DWG closed |

**Performance:** record number of \`drawing_list\` / \`drawing_bind\` / \`acad_list_open_documents\`, new Work allocations and CAD backend activations per scenario. Handoff alone should make **zero extra CAD calls**; do not add frequent polling or rescan as a workaround.

**Windows AutoCAD HOST checkpoint — PASS_RETEST_REQUIRED until observed:** keep one DWG bound while chatting continuously in the add-in; execute real Job/Temp transitions, MTO metadata read and CAD operation; switch tabs without changing primary binding; validate header state, exact DWG lifetime, no surprise rebind/restart. Provide actual trace/log and screenshots where helpful. Source tests can PASS independently of this checkpoint.

## 7. Critic Review gate and delivery rules

**CURRENT STATUS: \`CR_REVIEW_REQUIRED\` — no CR PASS has occurred for this plan.**

Critic Reviewer must **independently** check all of the following **before Coder begins**:

- Is each claimed source behavior accurate? Distinguish async race **possibility** vs demonstrated failure; do not mark a contrived invalid-workflow test as product defect.
- Does staged transition preserve single-binding semantics, Job/System ownership, current leases, explicit FILE-only exception and bounded Drawing Anchor permissions?
- Can the mock actually force the alleged race in **production entrypoints**, rather than reproducing a different synthetic code path?
- Does failure rollback prevent both context loss and unauthorized double ownership? Does cleanup run exactly once?
- Does any change increase latency, wake CAD without need, introduce a redundant Job Runtime/Temp engine, or weaken safety?
- Are live transport/Node restarts being blamed without case-specific proof? Do not use those as a substitute for diagnosing the bound drawing.
- Are tests executable and are host-only tasks explicitly \`PASS_RETEST_REQUIRED\`?

Review outcomes:
- **FAIL / CHANGES_REQUIRED:** Planner revises **this file on the same branch**, Reviewer/CR repeats until planning PASS. Do not patch product source during planning.
- **PASS:** update the status explicitly to \`CR_REVIEW_PASS\` with review reference, then hand off **A0 → A1 (only if reproduction supports it) → A2 → A3** to Coder.
- **BLOCKED:** mark exact missing evidence; retain \`CR_REVIEW_REQUIRED\` rather than imagining proof or rewriting unrelated lifecycle.
- Do not merge implementation into \`main\` until source regression PASS and appropriate release decision; host result remains separately marked.

**Delivery of this plan itself:** commit only this Markdown document to \`fix/bound-drawing-work-handoff-20261012\`; do not modify source, change runtime defaults, merge or claim the incident has been fixed.

---

## 8. Planner revision 3 — integrated CR findings and internal review loop (2026-10-12)

**Status: PLANNER_INTERNAL_REVIEW; independent CR re-review pending.** This section supersedes A0–A3 wherever they are incomplete, without treating the reported incident root cause as proven. Do not change source, merge or mark CR PASS from this planning change. Preserve the original P0 active-session no-sleep/no-interruption scenario.

### 8.1 Evidence classification and ownership model

Four independent states must be tracked: (1) stable primary drawing identity in the **same logical add-in session**, including the original verified `runtime_document_identity` and separately verified Drawing Anchor; (2) current Work and capability authority, including execution ID, owner and execution path; (3) MCP transport/upstream health; and (4) last-confirmed add-in header display. Header name does not establish live backend Work binding. A FILE-only Work cannot call CAD even if the primary identity is remembered. A new conversation cannot borrow another logical session's drawing.

Document the exact path through `cadgpt_work_start`, `createWorkRegistration`, `createSuccessorWorkRegistration`, `commitSuccessorWorkRegistration`, `activateCadWorkspace`, `releasePriorJobAuthorityForStart`, `retireIdleJobWorkForExecution`, `releaseSessionWork`, `cleanupExecutionState`, MCP logical disposal, `drawingBindingStatus` and `activateDrawingContext`. For each: trigger, previous/next owner and execution, whether it revokes authority, whether it drops binding/metadata, whether it awaits or races cleanup, in-flight lease guards and whether scope is within or across sessions. Distinguish intentional old-Job cross-session terminalization from accidental primary drawing loss.

Do not infer a user-incident cause from forced scheduling alone. Record an actual source-entrypoint test outcome or `UNCONFIRMED / REPRODUCTION_REQUIRED`. Python `document_service.list_open_documents()` propagates ordinary COM/enumeration exceptions; there is not yet evidence that those exceptions become a successful empty list.

### 8.2 CRITICAL CR-01 — Transaction-safe successor and rollback

Current `createWorkRegistration` deletes A and schedules asynchronous expiration cleanup before the Work B handoff attempted by `cadgpt_work_start`. The implementation must define a single authorization/active-Work commit point:

1. Validate same logical session, current owner, nonbusy leases, desired execution path and source context; stage B with an inaccessible authority, without revoking A.
2. Copy exactly one verified drawing binding and its *read-only* verified metadata root to staged B only where permitted. Prevent guessing on multiple bindings, cross-session transfers and path-only matching.
3. Prepare required tool families; failure cancels B and its staged metadata/context, while A remains active, valid and callable.
4. Commit B as the sole active Work in one serialized operation with stale-generation and competing-transition checks. Revoke A immediately at commit; only then queue idempotent cleanup of A.
5. Ensure late/double cleanup A cannot clear B binding, revoke B or deactivate a backend B still uses. No unauthorized double ownership across any await.

Existing `createSuccessorWorkRegistration` is **FILE→HYBRID with unchanged owner only**. It cannot directly implement HYBRID Job A→HYBRID Job B with changed owner. Design the *minimal* shared staged-registration extension (or precisely justify another approach), preserving token uniqueness, lease checks, owner constraints and permission boundaries. Do not silently repurpose the existing upgrade without adapting its preconditions and tests.

### 8.3 CRITICAL CR-02 — Execution-owned cleanup and backend isolation

`cleanupExecutionState(executionId)` derives loaded families from a runtime-wide snapshot; this is not itself proof of the retiring execution's ownership. Audit every cleanup action against exact execution-owned resources. In particular, Human Power cleanup can call `cadUpstream.deactivate()`; require ordered mode reset and explicit successor/in-flight CAD protection. CAD backend shutdown must depend on actual remaining CAD ownership/leases, not just an old work's cleanup path. A cleanup is idempotent and does not delete successor maps or metadata. Test delayed cleanup, repeated cleanup, transition error, session end, and Human Power reset.

### 8.4 CRITICAL CR-03 — Negative DWG observation is not automatically confirmed closure

`drawingBindingStatus` and `activateDrawingContext` presently delete drawing context on a single absence in an otherwise successful `acad_list_open_documents` result. Separate `AVAILABLE`, `OBSERVATION_UNKNOWN` (transport/COM), `OBSERVED_ABSENT` (successful but possibly incomplete list), `CONFIRMED_CLOSED`, and `CONFIRMED_IDENTITY_MISMATCH`. Define positive evidence for destructive invalidation. Do not turn COM failures into empty lists, do not mask a proven close/reopen identity mismatch, do not auto-bind to `ActiveDocument` or same filename. Verify any confirmation policy using bounded/event-driven evidence instead of constant expensive CAD rescans. Until provenance is established, do not claim that incomplete listing caused the live incident.

### 8.5 IMPORTANT CR-04, CR-05, CR-06 — Paths, transitions and persistent identity

Cover all Work creation/retirement/disposal entrypoints, including Job A→B, Builder→Custom Job, Direct Job, Temp, workspace activation and cross-session Job terminalization. Coordinate race guards across entrypoints, not only inside the `cadgpt_work_start` callback. A truly ended logical session revokes rights; a transport detach with retained logical identity does not.

An explicitly requested FILE-only/CAD-only exception retains its original tool-family denial. Decide between (A) an immutable, non-executable **session-scoped primary drawing reference** or (B) a protected Work-scoped continuity reference, after A0 tests; choose one minimal design only. With FILE-only, preserve the user's selected identity for future authorized HYBRID work, but grant **zero CAD privilege** to the FILE Work. Future CAD action must revalidate original document lifetime before execution. No implicit rebinding across different logical sessions.

### 8.6 Ordered revision milestones and test gates

**A0 — Audit and reproduce, before modification.** Build entrypoint and ownership matrix above; add deterministic tests on real exported entrypoints (with controlled promises), report actual before/after registration/context counts, observed response, tool lease, metadata root and backend phase. First confirm a fail that matches active-session context loss or state `UNCONFIRMED` with diagnostic evidence required. Do not implement speculative fixes.

**A1 — Atomic transition when justified by A0.** Implement the common stage/commit/rollback boundary; expand successor support only as demonstrated; test competing transitions, late cleanup and preparation failure.

**A2 — Binding observation and cleanup isolation.** Implement only proven reliability changes; distinguish observation uncertainty and verified DWG lifetime change; structured minimal logs with safe fingerprints and cause codes. Header keeps AutoCAD open/active rules and reports Work mismatch independently, not an invented DWG close.

**A3 — Source regressions and host acceptance.** Record exact tested SHA for build, tests, relevant CI. Windows AutoCAD live checkpoint stays `PASS_RETEST_REQUIRED` until observed on a disposable DWG with uninterrupted add-in use. Do not use the user's production drawing as a QA fixture; no merge/deploy based solely on mock PASS.

**Mandatory new executable tests beyond R01–R08 / T01–T12:**

| ID | Reproduction / negative control | Required behavior |
| --- | --- | --- |
| R09 | Successful but incomplete drawing enumeration; separately COM/transport error | Preserve non-executable identity pending evidence, no false close; distinct error reasons |
| R10 | Delayed cleanup A runs after committed successor B | B binding, metadata and CAD access unaffected |
| R11 | Double cleanup A | Idempotent, no B teardown or unauthorized upstream stop |
| R12 | Changed-owner HYBRID Job A→Job B on actual entrypoint | Atomic active authority, exact binding, safe rollback |
| R13 | Explicit FILE-only→authorized HYBRID | Original identity can be verified; FILE never receives CAD permission |
| R14 | `prepareFamilies(B)` failure | Valid A retained, staged B has no authority/orphan |
| R15 | Cleanup concurrently with in-flight successor CAD call / Human Power reset | Respect leases and backend ownership; no unrelated deactivate |
| R16 | Logging across Work race, identity anomaly and transport rotation | Unambiguous redacted reason; no tokens, private DWG data or fabricated incident cause |

**CR gate:** Independent Critic Reviewer must re-read and review the **new blob SHA**, verify CR-01 through CR-06 are addressed, and provide PASS or CHANGES_REQUIRED. This planner revision is not itself CR approval. Continue planning loop before any Coder work.

### 8.7 Internal review round 1 — findings and repairs

The Planner inspected revision 2 against current source contracts and the six independent CR findings. **Round 1 result: CHANGES_REQUIRED**, with these plan defects repaired in this revision:

| Self-review finding | Defect in revision 2 | Revision 3 repair |
| --- | --- | --- |
| IR-01 | A0–A3 main body and appended section 8 could be interpreted as competing instructions | Section 8 is the **controlling revision** for every overlapping requirement; sections 1–7 remain historical rationale/test inputs, not an alternate implementation route. |
| IR-02 | A0 permits UNCONFIRMED while A1 text might encourage a speculative patch | **No reproduction means no source fix.** A0 may conclude UNCONFIRMED only with exact missing evidence, then stop for diagnostics/CR plan revision. |
| IR-03 | Successor staging may be mistaken for a callable second authorization | Staged token is not callable or current, and B cannot run protected tools before atomic commit. |
| IR-04 | Session-scoped identity option could look like implicit authority | Retained identity is only read-only continuity evidence. CAD execution still requires current authorized Work and live lifetime revalidation. |
| IR-05 | Absence from a successful enumeration could be incorrectly treated as proven COM fault | Treat a successful-but-incomplete enumeration and an exception as **different negative controls**; neither alone proves user incident attribution. |
| IR-06 | Runtime-level cleanup might be treated as execution-owned merely due to argument | Demand exact per-execution resource ownership proof, active lease check and safe global-backend shutdown ordering. |
| IR-07 | Tests lack an explicit falsification case for the central race | Force the alleged A cleanup **before** handoff via the real `cadgpt_work_start` entrypoint; capture whether old context actually disappears, whether handoff is null, and whether the next CAD action fails. A passing race test falsifies that mechanism; investigate alternatives. |

**Precedence:** Section 8.1–8.7 takes precedence over older F4 interpretation, A1 handoff ordering, and all earlier R01/R02 acceptance statements if inconsistent. No plan revision is CR-approved until independent CR verifies the exact blob.

**Mandatory stop rules:** (1) Do not fix based only on hypothesis; (2) Do not mark host PASS from mock tests; (3) No automatic rebind to a same-name DWG or another chat; (4) No permissions broadened merely to retain identity; (5) No code/merge/deploy before CR approves the revised plan and the user authorizes implementation.

**Completion of internal loop:** A self-review may be marked PASS only after another independent-in-process Planner pass verifies these repairs against code and the written acceptance matrix. The result and checked blob SHA must be recorded under section 8.8 before handoff to Critic Reviewer.

### 8.8 Internal review round 2 — PASS (planning only)

**Checked input:** revision 3 after internal repair, base blob `ae3b9b600cc03a4e8ed83912fab51e13df95ef7e` (commit `69634274c2f6dc7dcaf7faa24203faf7c386f248`). In this round, Planner detected and repaired one remaining evidence-tracking defect: the CR-04, CR-05, CR-06 heading lacked individually traceable IDs. This is a plan labeling change, not a claim that production tests ran.

**Plan checklist:** CR-01 through CR-06 explicitly tracked; R01–R16 + T01–T18 specified; staged/commit/rollback authority; execution-owned cleanup and lease protection; successful-but-incomplete listing vs service exception; FILE-only permission boundary and remembered non-executable identity; cross-session no-adoption; A0 no-reproduction stop; no sleep assumptions; source tests separate from Windows host checkpoint. **Internal plan review PASS**. Live root cause **UNCONFIRMED**. Independent CR still **PENDING**. No product source edits, merge, deploy, or implementation authorization.

### 8.9 Standing Planner internal-review protocol (CadGPT)

For every future CadGPT Planner draft/revision, *before* presenting the plan to the user or to CR: review the full latest draft against source evidence, constraints, security, testability and prior findings; record self-review findings; revise the same plan; repeat until a documented INTERNAL_PASS or explicitly describe a genuine blocker. Persist the reviewed plan, verify its readback and reference its exact blob SHA. Internal PASS must **never** be represented as independent CR PASS or live/CI test PASS. Do not stop merely after the first revision or commit.

---

## 9. Planner Revision 4 — CR-R3 findings, authoritative amendment

**Status:** PLANNER INTERNAL PASS; independent CR not yet passed. This section is controlling wherever prior revisions differ. No product code mutation or incident root-cause claim.

### 9.1 CR-R3-01 / CRITICAL — Staged authorization must be uncallable

**Source evidence:** `createSuccessorWorkRegistration` inserts a staged successor in `registrations` before commit, while `validateWorkHandle` currently checks registration/token/session/epoch and `closing`, but does **not** require `activeBySession.get(sessionKey) === executionId`. Therefore a merely staged record may pass validation if its token is known. Treat this as an independently demonstrated *source authorization gate gap*, not proof that the observed user incident exploited it.

**Mandatory design:**
1. Define explicit `STAGED` vs `ACTIVE` vs `RETIRED` registration states (or an equivalent single-authoritative predicate). Only the current committed `ACTIVE` registration may acquire/use a Work ToolLease; both `validateWorkHandle` and the actual lease acquisition boundary must reject STAGED. Exception: narrowly identified internal commit/cancel operations explicitly validating a staged token using a distinct non-tool-capability API.
2. Do not rely on token secrecy or UI omission. A valid stolen/copied staged token must fail protected CAD, FILE and hybrid tool calls, including direct and gateway invocation and potential preexisting lease continuations.
3. Commit must be linearizable with current-generation/session ownership checks, nonbusy in-flight lease conditions and stale commit rejection. A cannot remain independently callable after B becomes active; B must be unusable before commit.
4. Review all existing callers of `validateWorkHandle`, including stage/commit APIs, to avoid breaking an authorized internal staging handshake. A staged cancellation must not revoke A.

**Negative controls (R17):** fabricate a correct B staged handle including authority token; attempt CAD/FILE/registry and tool lease acquisition; all denied with `WORK_NOT_ACTIVE` or compatibility-preserving explicit status. After commit, A denied and B accepted; on prepare rollback, A accepted and B rejected. Test both Work and lease wrappers through production entrypoints, no regex-only assertions.

### 9.2 CR-R3-02 / IMPORTANT — Prepare failure and reversible runtime state

**Source evidence:** `prepareFamilies` is invoked after Work replacement in current `cadgpt_work_start`; preparation can mutate the server's dynamic tool registrations, loaded-family markers and runtime/cad activation. The plan must not claim those changes are always transactionally undoable.

**Preparation side-effect inventory must precede modification:** classify `prepareFamilies` effects as (a) ephemeral/no shared mutation, (b) append-only and safe under failure/retry (e.g. idempotent tool registrations with the exact same authority wrapper), (c) reversible execution-owned resources with a deterministic compensating action, or (d) unsafe/irreversible shared mutation. For (d), refactor into safe preflight or defer until after commit only if it preserves rollback semantics; never claim complete rollback without evidence.

**Transaction contract:** while B is staged, side effects must not change the active Work A's tool surface, capabilities, CAD upstream or session observer; B's registrations are inert. On failure, revoke B and clean B-owned metadata/context exactly once. If a shared append-only tool registration remains, it must be safe, scoped by runtime authority and reusable; report it as retained idempotent state rather than falsely claiming rollback. If an effect cannot be proven safe, stop with `PREPARE_SIDE_EFFECT_UNSAFE` without retiring A. Ensure the source's existing `registeredSurfaceByServer` / `loadedByServer` and global CAD Upstream behaviors are included in this inventory.

**Negative controls (R18):** throw before prepare, after first family registration, after second family registration, after CAD activation, and during cleanup/cancellation; in every scenario test that A remains valid, B cannot call any protected tool, retries do not duplicate registrations/privileges, no wrong CAD deactivate and no orphan permissions. Test real `prepareFamilies` interaction behind injected failure points, not a mock that only throws before side effects.

### 9.3 CR-R3-03 / IMPORTANT — Primary drawing persistence decision gate

Before implementation, A0 must collect evidence for each scenario and choose the **narrowest architecture** that passes it:

| Decision condition | Outcome |
| --- | --- |
| Every valid same-session Work/Job transition, including explicit FILE-only→HYBRID, is covered by an existing protected read-only reference without a gap during cleanup | Prefer **Work-scoped preserved continuity reference**; do not introduce a session registry. |
| A0 demonstrates real same-session transition legitimately retires the only Work or passes through FILE-only with no safe Work-scoped source, despite DWG remaining open | Consider **session-scoped non-executable primary drawing identity**, strictly tied to verified add-in logical-session identity and cleared on explicit unbind/session disposal. |
| Neither approach proves lifetime/ownership safety or tests show ambiguous multiple drawings/cross-session risk | Stop with `ARCHITECTURE_DECISION_BLOCKED` and request a revised plan; do not silently choose a broad shared registry. |

Regardless of option: immutable primary identity is **not authorization**, not proof of current host liveness and not a license to infer by name/active tab. CAD tool use requires committed CAD-capable Work, ToolLease and live `runtime_document_identity` revalidation. Drawing Anchor metadata read remains subject to established read-only scope and current session ownership.

**Negative controls (R19):** Work A→B, Builder→Job, Temp→Job, explicit FILE-only→HYBRID, drawing close/reopen under same filename, two bound drawings, app session disposed, MCP transport rotation with same logical identity, different conversation identity, CAD-only/FILE-only tool-denial, stale/forged anchor and source-empty gap. Prove exactly one primary reference per logical add-in session without user-selected rebind unless an authorized identity change actually occurred.

### 9.4 Internal review/CR gate

Review the current full plan, including the old F1–F7 hypotheses and this controlling section, for contradictions. **A0 may exit UNCONFIRMED for evidence collection, not permission to implement any speculative fix.** Do not use source-only simulations as incident proof. Existing CR-01–06 and CR-R3-01–03, R01–R19 and T01–T18 must all trace to an observable test and explicit authority boundary. Keep the original Windows AutoCAD active continuous-use host checkpoint as `PASS_RETEST_REQUIRED`.

Planner must iterate internal findings and amendments until explicit INTERNAL_PASS, commit and read back the exact reviewed blob, then invite *independent* CR. The new revision does not inherit Revision 3 INTERNAL_PASS or any CR PASS.

### 9.5 Planner internal review loop — Revision 4

**Round 1: CHANGES_REQUIRED → corrected in §9.1–9.3.** Source review found that the staged-registration token can pass current `validateWorkHandle`, so the plan must gate both work validation and ToolLease, while exempting narrowly scoped internal commit/cancel APIs. Review also identified that `prepareFamilies` side effects may outlive a throw, and that the binding-ownership architecture could otherwise be selected without a decision gate. Repairs and real-entrypoint negative controls R17–R19 are now explicit.

**Round 2: INTERNAL_PASS (plan-level only).** Checked draft blob `304d5adea11df50142cfa53e954231cd9be79485` against: CR-R3-01–03, earlier CR-01–06, Work authorization and lease guard, staged/commit/cancel lifecycle, preparation side-effect inventory, failure injection, binding ownership decision matrix, FILE/CAD family-denial, unrelated-session isolation, original no-sleep defect, evidence-first stop rules, host-only checkpoint and no source writes. No remaining planning contradiction was found in these specified requirements. **This is not test execution, confirmed incident cause, independent CR PASS or permission to implement.** The saved version including this record remains `CR_REVIEW_REQUIRED` pending independent review.

---

## 10. Planner finalization — Revision 4 CR disposition (2026-10-12)

**Independent CR conclusion communicated by reviewer:** `PASS WITH FINDINGS` for the technical plan at **commit `70958b37f60a79f473f8e2f7c7d4355e9d0fc0ad`, blob `99c0a48bf2193ddf6cb507701216e2139b8d0053`**. No unresolved CRITICAL or IMPORTANT planning finding. Remaining MINOR: the internal self-review input SHA belonged to the pre-final draft, not the final reviewed blob. This note records that distinction rather than misrepresenting the earlier self-review as having checked the final file.

**Planner decision:** retain the approved Revision 4 technical design (§9) **unchanged**. Resolve MINOR through source-of-truth identification: independently reviewed target blob = `99c0a48bf2193ddf6cb507701216e2139b8d0053`; prior internal draft blob = `304d5adea11df50142cfa53e954231cd9be79485`. The finalized documentation commit will have its own SHA and is *not* automatically independently CR-reviewed. Status `CR_PASS_WITH_MINOR_FINDING` describes the reviewed technical plan; subsequent content modifications require fresh review as appropriate.

**Approved execution boundary:** A0 investigation, instrumentation proposals and deterministic reproduction only, after explicit implementation instruction. **No speculative A1/A2 source patch** without evidence identifying the causal code path, followed by appropriate review. A3 Windows AutoCAD host checkpoint remains `PASS_RETEST_REQUIRED` and may not be simulated into PASS. No production DWG QA, no automatic rebind by name, no broader transport/tray rewrite, no merge/deploy implied.

**Standing internal Planner loop:** every substantive plan revision must undergo self-review → findings → repair → re-review until documented internal PASS, with exact reviewed input blob and final readback tracked distinctly. Independent CR verdict remains distinct from self-review.
