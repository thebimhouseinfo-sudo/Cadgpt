# CadGPT — Provisional milestones after M1 capability setup

## P0 status override — reopened after source-journey failure evidence (2026-10-21)

The previous P0 source-only closure was invalidated by multiple Human-reported real workflow bugs. **M0/P0 currently REOPENED**, not a completed prerequisite to coding. See [`PHASE0_FLOW_EXECUTION_SIMULATION_R4.md`](./PHASE0_FLOW_EXECUTION_SIMULATION_R4.md) for five flow diagrams and 24 modeled scenarios, plus pending native end-to-end replays. Keep M1 Coder/Tester skills configured; future milestones cannot treat R4 as native PASS or silently code from the old J-0E2C scope.


Status: HUMAN-REQUESTED TEMPORARY MILESTONE PLAN (2026-10-21). **Not an automatic mutation of existing READY J-07C5 topology.** These milestones are evidence-oriented GSA development coordination, NOT runtime permission gates for a CadGPT customer.

## Binding and phase logic
Approved Criteria: `CRITERIA.md` blob `d43f32b179a46007efb663591d260925f3cbbe06`. Detailed Plan: `IMPLEMENTATION_PLAN.md`. Current reviewed Job J-07C5 owns T1–T8 and branch `feature/core-function-v5`.

| Milestone | Objective and dependency | Provisional acceptance |
|---|---|---|
| **M0 — Source & native observation** | Current architecture, user journey diagrams, actual gate triggers, caller→guard→consumer evidence. First phase; source study may precede Bootstrap only as scoped research. | Versioned source evidence register, AS-IS workflows including failure cases, native gaps distinctly UNVERIFIED. |
| **M1 — Coder + Tester Add-ins & Knowledge** | Prepare domain-specific skills and evidence/test methods for subsequent diagnosis/repair, based on M0 known workstreams; complete *before source code work*. | Coder skill + Tester skill + shared domain knowledge written/read back and linked in AGENTS.md, generic GSA harness still precedence; test runner/native host capability truth recorded without fake PASS. |
| **M2 — Evidence-based TO-BE** | After sufficient M0: decide KEEP/SIMPLIFY/CHANGE/REMOVE vs Criteria, map each genuine issue to one owning T2–T6. | Reviewed, scope-bounded actual change list and TO-BE, no speculative patch decisions. |
| **M3 — Focused source corrections** | After M1/M2: each owning subsystem fixes only confirmed deviation, then immediate focused tests. | Changed source review, actual test evidence, no new CadGPT customer workflow gate. |
| **M4 — Integration checks** | After actual M3 diffs. | Build/regression evidence bound to exact source; no blanket reimplement step. |
| **M5 — Native AutoCAD acceptance** | Real copied DWG, multi-chat/Jobs/Lisp/Anchor/Save; after relevant code checks. | User-visible PASS/FAIL/UNVERIFIED, independent Human stable/release decision. |

## Human bootstrap intent
Human explicitly requested: complete M1 and set provisional milestones, then treat this as enough **planning** to consider Bootstrap successful and redo M0 in more depth. GSA's real Bootstrap evidence check is authoritative for GSA execution; do not claim READY or code authority on this sentence alone. Actual Human execution approval must be independently grounded and role/task capability evidence verified; native test availability remains UNVERIFIED until a successful host call.

## Capability reality
- Coder domain skill and Tester domain skill created in `SKILLS/` under this Project Memory; shared knowledge `KNOWLEDGE/CADGPT_DOMAIN_BOUNDARIES.md`.
- GSA generic Coder/Test harness exist and can be loaded for source investigation; native Windows AutoCAD tools **not yet demonstrated functional** from this chat.
- Optional role add-ins are guidance, not grants; source changes still require a valid attributed Run under configured development branch and ordinary GSA authorization.
