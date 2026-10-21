# CadGPT V5 — WP0 Dependency Map

**Branch:** `feature/core-function-v5` only. **State:** source-survey checkpoint, not a CAD execution acceptance.
**Authority:** `CADGPT_CORE_FUNCTION_V5_BRANCH_PLAN.md` and `CADGPT_V5_DETAILED_IMPLEMENTATION_PLAN.md`.

## End-to-end execution ownership

| Entry | Ownership and dependency | V5 direction |
|---|---|---|
| `tools/work-control.ts` and `lib/work-registration.ts` | session Work owner/generation, per-call ToolLease, bound drawing continuity | Preserve real session identity and host authority. Distinguish Builder target from active Job ownership |
| `tools/filesystem.ts` | `currentReadableRoots/currentWritableRoots`; generic data/workspace; Job runtime; draft exception | Use execution-derived canonical owned roots for source edits; never whitelist whole libraries |
| `lib/path-security.ts` | absolute mutation resolver, lexical + canonical path, nearest existing parent | Preserve junction/symlink containment and exact source path checks |
| `lib/appdata.ts` | AppData managed libraries, Job/Lisp drafts, drawing results | Add Temp Job root; final reusable authoring in managed owned folder |
| `tools/jobs.ts` | discover/execute; `job_draft_new`, `job_checkout`, `job_draft_validate`, `job_promote_draft` | Stage adapters; direct authoring after WP1; no hard gates at RUN |
| `tools/lisp-workspace.ts` | Lisp draft checkout/promote lifecycle | Replace with targeted owned Lisp authoring, preserve registered IDs |
| `runtime/job-runtime.ts` | `prepareJobRuntimeForExecution`, Step statuses, result handoff | Retain authentic per-run progress and Drawing Anchor |
| `runtime/system-lease.ts` + `tools/job-system-helper.ts` | SYSTEM lease/runner with source-hash and Python `-I` | Keep true helper execution safety, eliminate unnecessary user-visible acquire/release after ownership integrated |
| `tools/cad-proxy.ts` | CAD host lock and bound Lisp load/command ownership | Add owned Temp Lisp paths only, never ActiveDocument fallback |
| `tools/job-result-access.ts`, `tools/job-result-patch.ts` | stored result reads and narrow writes under verified anchor | Preserve; Temp result names human-provided if result persists |
| `tools/registry.ts`, `tools/user-assets.ts` | discover and register reusable capabilities | Registry as publication, not RUN prerequisite |
| `tools/control.ts`, `server-factory.ts`, `lib/quickstart.ts` | cg/* surfaces, tool registration | Add `cg/cleartempjob`, keep thin routing |
| `lib/job-local-compat.ts` | compatibility epoch + warning | Diagnostic only; no workflow blocker |

## Dependency and mutation sequence

1. Work/session authority is validated at tool boundary.
2. Owner-scope resolver determines exactly one authorized source/result namespace; **Builder authoring and Job execution have different grants**.
3. Path-security canonicalizes and checks path and parent; file scheduler serializes same-file mutations.
4. Python helper runs in its owner-controlled process/input scope; CAD operations enter the verified bound host lock.
5. Result writes target own Drawing Anchor namespace; Save targets exact bound DWG.
6. On DONE/STOP, only owned scratch and capability references are releasable; never another Job or user-named result.

## Interfaces that must not be deleted early

- Existing Job IDs, `JOB.md`, `JOB_STEPS.md` and legacy direct Python Job entry points.
- Stable MCP tool names for file, CAD, Job runtime, registry, import/export and Lisp LOAD.
- Drawing anchor identity, verified binding, file canonicalization, source-hash checks for helper execution.
- Job cross-chat handoff and independent file/analysis work.

## Regression coverage to retain and revise

- `tests/reasoning-job-storage-write-scope.test.mjs`, `tests/job-owned-lisp-path.test.mjs`, `tests/job-result-generic-bypass.test.mjs`: no cross-owner write.
- `tests/job-runtime.test.mjs`, `tests/job-steps-lifecycle.test.mjs`: real steps, no extra gates.
- `tests/job-system-lease.test.mjs`, `tests/job-transition.test.mjs`: per-Job independence.
- `tests/drawing-persistence.test.mjs`, `tests/job-sequential-drawing-handoff.test.mjs`: bound drawing and stable anchor.
- `tests/lisp-loader-error-contract.test.mjs`: real LOAD verification vs transport acceptance.
- `tests/job-bundle-lifecycle.test.mjs`, `tests/direct-job-lifecycle.test.mjs`: revise only when in-place authoring supersedes old route.

**WP0 assessment:** Main maintenance added minimal Temp Job files after this V5 branch point. Do not merge main. Implement according to V5 directly on this branch.

**Next work:** WP1 canonical owned-source resolver and direct Builder source-write path; preserve current source/runtime unchanged until exact ownership context is available.
