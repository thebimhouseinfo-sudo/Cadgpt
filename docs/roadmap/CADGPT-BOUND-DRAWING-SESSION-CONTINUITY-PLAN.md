---
title: CadGPT — Bound Drawing Continuity in an Active Add-in Session
document_type: DETAILED_IMPLEMENTATION_PLAN
status: CR_REVIEW_REQUIRED
review_status: NOT_REVIEWED
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
