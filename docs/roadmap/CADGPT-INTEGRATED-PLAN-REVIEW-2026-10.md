# Planning review ledger — CadGPT Integrated Plan

Scope: docs/roadmap/CADGPT-INTEGRATED-MCP-HARDENING-PLAN-2026-10.md
Repository: thebimhouseinfo-sudo/Cadgpt
Review method: same-conversation role-separated Planner/Reviewer checklist with independent file reread and source contracts; **not** an externally independent CR agent or a persisted GSA Job Verification.
This is planning evidence only. No code or DWG was tested/changed.

## Round 1 — revision 1
Target document blob SHA: 0fb70e2f4a2b8087663c14174813a28ddfa6378e
Verdict: CHANGES_REQUIRED

- RV1 / IMPORTANT / Scope sizing: J05 mixes three distinct mutation surfaces (Block/ATT, geometry creation, annotation) with different contracts and test fixtures; J06 mixes geometry algorithms and xref/plot. Split into bounded independent Job Packs with separate deliverables/gates. A long-lived branch does not make a mega-Job acceptable.
- RV2 / IMPORTANT / Reactor root cause: bulk selection failure is not yet reproduced. Separate selection-only failure from command mutation/reactor emission, record exact AutoCAD error text and event trace, and forbid broad reactor rewrite before a minimal failing example. XData bug candidates (global XData removal and tag ownership) need explicit field-by-field regression.
- RV3 / IMPORTANT / Mutating gateway safety: named cad__ proxies and generic cad_invoke_manifest_tool must share a fail-closed risk registry, tool discovery contract, confirmation and immutable preview snapshot; otherwise adding a new tool to the manifest can silently widen destructive capability.
- RV4 / IMPORTANT / Host compatibility: the proposed optional .NET bridge needs a separate AutoCAD R22.0/net46 UI-thread/DocumentLock proof before any binding or packaging changes; unknown compatibility blocks only the affected capability, not the whole roadmap.
- RV5 / IMPORTANT / Feature rollout/coverage: 40–55 extra tools risk client surface bloat, latency and schema drift. Specify family-index discoverability, named-tool default vs explicit advanced gateway, deterministic manifest generation, and per-family acceptance with a required real consumer use case. Do not treat raw endpoint count as proof.
- RV6 / IMPORTANT / Real CAD acceptance: define preservation invariants with concrete pre/post handle+ATT+XData snapshots and authorized disposable DWG; measure selection-only separately from MOVE/COPY/ERASE. CI without AutoCAD cannot claim real host PASS.
- RV7 / MINOR / Branch release strategy: retain one integration branch (user preference) but ensure checkpoint evidence and baseline reconciliation, optional feature flags for new write tools, and final merge only after human release decision.

Route: Planner to repair revision 2, then reread and re-review exact blob.

## Round 2 — revision 2
Target document blob SHA: 7a808a0f2e791f6c7d23102f059eacd29455e490
Verdict: CHANGES_REQUIRED (2 remaining implementation sequencing issues)

- RV8 / IMPORTANT / main-source-of-truth drift: plan kept *all* implemented work unmerged until a single final J09 integration, despite 15 finite Job Packs. This makes the integration branch long-lived and diverging, directly counter to the project's recent lessons learned. Set human-gated per-milestone reviewed merge to main, one active work branch at any time, and prevent a partially accepted capability from becoming available by default.
- RV9 / IMPORTANT / urgent fix sequencing: M0 grouped J01 Grille selection repair with unrelated J02 SYSTEM/Excel and could delay the already reported CAD defect. Split M0 into M0a (J00 + root-cause J01 for early user acceptance) and M0b (J02). Both need their own smoke/rollback gate.

Route: Planner revision 3 then fresh plan reread/review; no production change.

## Round 3 — revision 3
Target document blob SHA: 31b4c1f494145b0caa7afffc67083483a5c951d3
Verdict: PASS (planning specification only; not a code/security test or live AutoCAD acceptance)

Review evidence:
- Explicit source evidence for 41 manifest tools, filter limits and manifest gateway.
- Every prior RV1–RV9 planning finding is mapped to a named pack/contract and explicit acceptance criterion.
- Two early release gates M0a/M0b avoid delaying urgent Grille selection defect behind Excel, with one active work branch and human-reviewed milestone merges to main.
- Isolated J05A/B/C, J06A/B/C, J08A/B avoid mega-Job scope and provide separately verifiable outcomes.
- User-stated no-change scope for TabSortV2-2 and source-SHA guard is explicit.
- Fail-closed authority of named proxy and generic manifest gateway, one-shot preview/confirmation, drawing identity, runtime compliance and actual .NET feasibility are addressed.
- Live CAD/COM behavior remains UNKNOWN until tested on authorized disposable DWG; current plan correctly requires BLOCKED_REAL_CAD_VALIDATION instead of inventing PASS.
- Real source code, .lsp files, production DWG and AutoCAD workspace are untouched by this planning loop.

Remaining execution risks (not review blockers):
1. Exact selection error stage is not yet known; test A/B/C scenarios before changing reactor.
2. Windows CAD/COM acceptance requires a running supported R22.0 host and captured evidence.
3. A Python helper is trusted code, not an OS sandbox; J02 must gate any untrusted execution.
4. Additional 40–55 CAD capabilities are a planning envelope, not a commitment to ship unneeded API clones; each family may remain BLOCKED by unsupported host semantics.
5. p95 improvement remains a measurable objective, not a guaranteed speedup.

Planning outcome: READY_FOR_IMPLEMENTATION_SCHEDULING after user instruction; source/main merge NOT AUTHORIZED by this plan review.

## Preliminary CR checklist on revision 4 — NOT an independent GSA Critic Verification
Target plan blob SHA: e75108717333075d14cc2e071e501d77e789f3f1
Status: CHANGES_REQUIRED (informal same-chat source review, not official GSA CR)

- CR-R4-01 / IMPORTANT: J04 and J06A both claimed nearest/intersection geometry endpoints, creating duplicated capability ownership and ambiguous maintenance/testing.
- CR-R4-02 / IMPORTANT: J05C Annotation incorrectly depended on J05B Geometry Creation although annotation can target existing DWG geometry.
- CR-R4-03 / IMPORTANT: GT:LinkGrilleAndTag may affect unrelated RegApp XData when processing -3 records. A source-pattern suspicion is NOT proof of loss. Require a dedicated red regression and conditional fix rather than coupling to the bulk-selection investigation.

## Planner repair — revision 5
Target plan blob SHA: efb3516e9fb25942d45455727c115be08a041826
Status: PLANNER_RESOLVED_PENDING_NEW_CR (no CR review result assigned to this revision yet)

| Finding | Disposition | Evidence to be obtained when implementing |
| --- | --- | --- |
| CR-R4-01 | J04 solely implements read-only cad_find_nearest/cad_find_intersections; J06A composes graph/clearance and separately gated advanced edits | Primitive query results never imply connectivity; graph trace requires edge provenance and disconnected-crossing counterexample |
| CR-R4-02 | J05C depends on J03/J04 only, with a pre-existing geometry fixture; J05B not required | Full annotation workflow runs when geometry-creation family is unavailable |
| CR-R4-03 | Separate J01X XData preservation Job Pack and M0x milestone; independently release after host verification, with no automatic LISP rewrite | Pre/post third-party RegApp XData, MEP_TAG_LINK, ATT and undo/redo snapshots for GT/c:CG/COPY/ERASE; if risk does not reproduce, NO_CHANGE_REQUIRED |

Planner consistency recheck: all 16 Job Pack headings present, no stale J05C-J05B dependency, no duplicated nearest/intersection ownership, TabSortV2-2 excluded, main and runtime untouched.
Human-requested next step is an independent Critic Review of exact revision-5 blob. Neither the revision-3 PASS nor the preliminary revision-4 findings constitute a verdict for revision 5.

## CR Revision 5 — preliminary source-bound findings (request: "cr kiểm lại")
Target plan blob SHA: efb3516e9fb25942d45455727c115be08a041826
Verdict: CHANGES_REQUIRED (conversation-level independent code/plan review; NOT an official persisted GSA CRITIC_REVIEW Verification)
- CR5-01 / IMPORTANT — the 41 existing manifest tools lack explicit risk/family/visibility labels, so immediately applying fail-closed could interrupt current production behavior.
- CR5-02 / IMPORTANT — CAD query, reading Editor/PICKFIRST selection and modifying Editor selection state are different safety contracts.
- CR5-03 / IMPORTANT — creating geometry/blocks/annotations after a timed-out successful COM call can duplicate entities if blindly retried.
- CR5-04 / MINOR — c:CG is a COPY-and-unlink-NEW-grilles operation, not a standalone link-clear command; tests must protect originals.

## Planner repair — revision 6
Target plan blob SHA: 66d5635d58e00bcce679a79103e55cf4d1820e61
Status: PLANNER_RESOLVED_AWAITING_NEW_CR (no official CR verdict for this blob)

| Finding | Implementation-plan owner and change | Mandatory implementation evidence | Disposition |
| --- | --- | --- | --- |
| CR5-01 | J03A: classify all 41 baseline tools, golden schema/behavior inventory, shadow decisions, reversible opt-in enforcement, fail-closed new tools; J03B central policy for named and gateway | 41-row policy, zero unexplained shadow mismatch, no loss of established tool access, unknown/internal denied, flag rollback, real host smoke | PLANNED |
| CR5-02 | J04-Q pure geometry query; J04-S read-only Editor selection snapshot; J04-E optional guarded state-changing Editor selection operation | Selected handles/state unchanged for read APIs; no reactor/objectModified callbacks; reject stale state; mutation default-off until net46/R22.0 host E2E | PLANNED |
| CR5-03 | J03C: durable operation-id/payload-hash journal and UNKNOWN_OUTCOME reconciliation; J05A/B/C consume it | Duplicate concurrent POST, lost reply, timeout/crash, undo/erase/reopen/Save As, conflict payload, partial batch; verified handle readback only | PLANNED |
| CR5-04 | J01X: explicit c:CG fixture = COPY then unlink new grille only; verify original tag/grille link remains and third-party XData untouched | Single/multiple grille, tags, aborted copy, original/copy handle and RegApp-by-RegApp snapshot, linked-tag owner check, undo/redo | PLANNED |

Consistency checks: 16/16 revision-6 plan assertions passed; no old "J05C depends J05B" text, no J04/J06A nearest/intersection duplication, no legacy c:CG-clear test, no change to TabSortV2-2.lsp scope.
This is PLANNER evidence, not test/AutoCAD proof. All implementation acceptance gates remain outstanding.
Fresh independent CR must bind to exact revision-6 blob; previous revision-3 PASS and revision-5 CHANGES_REQUIRED cannot be reused for revision 6.


## Planner→Reviewer Loop — Revision 7, Round 1
Target plan blob SHA: 17d8a39f0d9e0fee268a93178ecde79aff2f07f7
Status: CHANGES_REQUIRED (same-turn role-separated planning review; not official GSA Job Verification)
- RV7-01 / IMPORTANT / Operation identity contradiction. J03C1 says the journal lookup key may contain operation kind, while J03C2 promises that reusing the same operation_id for a different kind is rejected. A key separated by kind could allow two executions for the same ID; primary key must omit kind and store/check kind as immutable metadata. Evidence: J03C1 first bullet vs J03C2 last sentence.
- RV7-02 / IMPORTANT / Persistent journal authorization. J03C1 correctly removes transient Job/session ID from the lookup key, but a later unrelated Job that knows an ID may read previous result or claim/replay it unless journal ownership and authorized resume/delegation are specified. Keep stable identity separate from access control, authorize current lease/drawing and durable owner or explicit continuation capability; deny cross-Job replay without proof. Evidence: journal identity/rebind path and current CAD proxy lease/binding policy.
- RV7-03 / MINOR / Deterministic retry hash. A payload hash using *current* source state after mutation can differ on a retry, so the request hash must derive from original canonical caller preconditions, while actual CAD state is separately validated against recorded pre/post evidence. Evidence: J03C2 source preconditions and J03C1 reconciliation.
Route: Planner revision 8; review exact new blob. This planning-only review has no live AutoCAD evidence.


## Planner→Reviewer Loop — Revision 8, Round 2
Target plan blob SHA: 2ea27e892277e892a53b7c14556950b4b09c79d5
Verdict: PASS — planning specification only (same-turn Planner → role-separated Reviewer loop)
Review target: exact GitHub plan blob; previous Round-1 findings were compared only after examining the new source. Not an independently executed GSA Job Verification and not an AutoCAD smoke result.

- RV7-01 RESOLVED: stable unique key uses Drawing Anchor + operation_id; operation KIND is immutable record metadata and a mismatched KIND with same key causes conflict. No second lookup namespace per kind.
- RV7-02 RESOLVED: persistent identity is separate from access. Every journal read/reconcile requires current authorized CAD lease and durable owner or delegated continuation capability, with no existence disclosure to unauthorized callers; negative/revocation tests specified.
- RV7-03 RESOLVED: server hashes original validated effective request, not changed live DWG; physical state is checked separately against pre/post evidence; retry with same request cannot be justified as a new create.
- CR6-01/02/03 RESOLVED IN PLAN: cross-session stable journaling, legacy 41-tool migration including COPY/MIRROR v2 without signature break and legacy no automatic retry, and server-authoritative canonical SHA-256.
- PRESERVED: M0a Grille bulk-selection priority; J01X unrelated XData preservation; no TabSortV2-2.lsp edits; J04 read-only vs Editor state controls; 41-tool shadow migration and real AutoCAD host gates; single reviewed milestone branch then main as source of truth.
- APPROVAL LIMIT: PASS applies only to architecture/planning completeness of this exact blob. It does not certify real COM behavior, cross-process locks, journal implementation, Office workbook safety, or p95 latency. Each still needs implementation-level code+test review, five CI gates and accepted disposable-DWG E2E evidence; no production merge authorized by this planning review.

Review-loop result: ROUND1_CHANGES_REQUIRED → REVISION8_ROUND2_PASS. Exact plan blob must be re-reviewed after any edits; leave plan text unchanged to preserve this review target.


## Human-invoked CR — Revision 8
Target plan blob: 2ea27e892277e892a53b7c14556950b4b09c79d5
Verdict: CHANGES_REQUIRED — independent conversation-level source/plan critique, not a persisted GSA CRITIC_REVIEW Job Verification.
- CR8-01 / IMPORTANT: no distinction between a truly new DWG without a journal and a previously journaled drawing whose AppData history was lost. Missing journal cannot itself be evidence of a safe first execution.
- CR8-02 / IMPORTANT: J03C requires stable operation_id but did not assign responsibility for creating and persisting it before the first dispatch from Job orchestration, so regenerated IDs on restart could duplicate CAD entities.
- CR8-03 / MINOR: active plan sections retained older revision labels/ambiguous historical operation-kind wording.
Human requested Planner repair, not a production change or automatic release.

## Planner repair — Revision 9 (CR pending)
Exact updated plan blob: 903015342a1d064980731cd007d099c5b6ef727e
Status: PLANNER_RESOLVED_AWAITING_NEW_CR — 21/21 source-level plan consistency assertions met; NOT a new independent Reviewer/CR verdict.

| Finding | Owner and resolution | Implementation evidence required |
| --- | --- | --- |
| CR8-01 | J03C0 journal bootstrap adds persisted CAD DWG journal marker + AppData sidecar + separate host index; controlled two-phase registration, user-approved DWG save when applicable, explicit trusted virgin creation vs unknown pre-existing adoption; fail closed on partial/full loss | Valid/missing/corrupt marker-sidecar-index combinations, copied DWG, Save As, restored backup, unsaved marker, cross-machine move, interrupted bootstrap, loss of all metadata; no automatic replay of an unknown old intent |
| CR8-02 | J03C-CLIENT makes managed Job orchestrator persist one immutable operation_id + original request + action key before dispatch and reload it after stop/restart; separate read-only owner-authorized lookup; direct v2 caller must persist its own stable ID | Crash before persist, after persist before send, after COM before response, duplicate workers, changed plan/task IDs, Job A→B delegation, user STOP, explicit newly authorized action; no regenerated-id duplicate |
| CR8-03 | Revision 9 active header, operational stop/go table and CR8 mapping; older dispositions explicitly labeled archived/superseded, preserving historic record; active key excludes kind | Read active J03C0/J03C-CLIENT/J03C1/C2/C3, traceability and stop-go; no historical label posing as current authoritative state |

Additional boundary: if DWG marker, AppData and host registry are all lost, local software cannot prove the drawing was never journaled. This is UNKNOWN_PROVENANCE/manual reconciliation, not green "new drawing" initialization. No exactly-once guarantee across split DWG/AppData commits.

Unchanged scope: M0a Grille selection issue, independent J01X XData integrity, all 41 legacy tool contracts, no TabSortV2-2.lsp edits, no production DWG modification, human-approved milestone merges only.

Planning status: ready for fresh Critic Review of exact Revision-9 blob, not yet REVIEW_PASS or implementation-ready by virtue of this Planner update. No code/runtime/AutoLISP/main mutation.
