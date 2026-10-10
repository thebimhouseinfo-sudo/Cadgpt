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
