# CadGPT Job Rules

## Human Power interaction

Human Power is a CadGPT **execution-level emergency capability**, not Job state.

A Job does not become a bypassed/flagged Job merely because Human Power was used while diagnosing or repairing CadGPT during that execution. If a platform blocker interrupts Job authoring/testing, the human may explicitly enable Human Power for the current work execution, repair the CadGPT/runtime issue, then continue the same Job. Human Power automatically ends with that work execution or may be stopped explicitly.

Source-code changes made under Human Power are recorded in the managed Human Power error log with the original error context, expected behavior, fix description, target file and before/after hashes.

Normal Job validation, real execution, user acceptance and promotion requirements still apply to the Job result.

## Purpose

A **Job** in CadGPT is a small, repeatable CAD workflow: a known sequence of steps executed under one explicit CadGPT WorkRegistration to produce a concrete result.

A Job is not an AI agent and does not own a chat session. One Job execution may own one or several opaque drawing contexts. If more than one drawing is bound, CAD operations must identify the intended `drawing_id`; no Job may inherit or guess another chat/execution's drawing target.

## Core Principle

A Job defines:

- **what must be done**
- **how many steps are required**
- **what instruction applies to each step**
- **which tools/executors are available in each step**
- **what output/postcondition each step must produce**
- **how success is validated before moving on**
- **what failure behavior applies**
- **what final result the Job must produce and validate**

The Job describes the workflow. The executor for each step may differ while preserving the same business semantics.

A step may:

- run an existing AutoLISP capability from the User Registry;
- call CAD MCP tools directly;
- inspect structured CAD data;
- read managed user assets inside CadGPT AppData;
- call the `write-lisp` Skill to patch/create AutoLISP in the AppData workspace;
- read another managed Job when the workflow explicitly needs it;
- write Job working data only inside the active Job's `runtime/**`;
- publish final drawing-scoped results only inside the Job result location returned by CadGPT.

A step must **not** directly edit permanent `appdata/libraries/**` source/assets with generic file tools. During an active Job runtime, generic file mutation is narrowed to that Job's runtime/result roots instead of the broad authoring workspace.

## Job vs Skill vs Tool

- **Job** = repeatable CAD workflow / unit of work
- **Skill** = reusable expert capability used by Jobs, for example `write-lisp` or `jobcreate`
- **Tool** = concrete execution mechanism, for example CAD MCP query, CAD MCP command execution, or managed file read/edit
- **Harness** = quality gate used by a Skill or Job validation process

## Default Job Work capability

A Job always starts with `execution_path=hybrid` (CAD + FILE/SYSTEM)
regardless of whether its current step only needs CAD tools or only SYSTEM
tools. CadGPT enforces this at `cadgpt_work_start`, including calls from older
clients that still pass `execution_path=file` or `cad`. This is a Work capability
default, **not** permission to run every tool at every Job step: the step's
allowed tools, active Work credentials, sandbox, result ownership and CAD
drawing binding remain mandatory. HYBRID registers both tool families lazily;
it does not itself activate CAD MCP or automatically choose an AutoCAD drawing.

Only the small minority of explicitly designated non-HYBRID Jobs may pass
`job_nonhybrid_path=file` or `job_nonhybrid_path=cad` to
`cadgpt_work_start`. Never infer an exception from available tools or the
first/current step. Non-Job Work types keep their requested execution path.

On a Job switch in the same logical chat, HYBRID Work can inherit exactly
one previously verified bound drawing identity, retaining its AutoCAD
runtime-document ID. Zero or multiple bound drawings require an explicit bind.
A reused binding is revalidated at the first CAD action, so a closed and
reopened same-name DWG is not silently adopted. No cross-session binding
inheritance or expansion of drawing-result write authority is permitted.

## Job execution modes

CadGPT has two execution modes:

- **Reasoning Job** — User Registry `.md` workflows use the canonical structured workflow contract and `REASONING_HARNESS.md`.
- **Direct Job** — dispatched by `job_run_direct` with no model planning between internal operations. User Registry Direct Jobs are reviewed deterministic `.py` entrypoints. CadGPT may also ship a small explicit set of **official Internal Direct Jobs** implemented by bounded built-in executors.

User-authored Jobs use the managed draft → validate → real test → user acceptance → promote lifecycle. Official Internal Jobs version with CadGPT, are read-only product capabilities, never live in User AppData, and cannot be overridden by a User Registry id. A Direct Job is never exempt from drawing-targeting, authority, evidence, or final validation rules.

When a Direct Job runs with one bound drawing, CadGPT serializes the child process under that drawing host lock and provides exact target identity through `CADGPT_DRAWING_ID`, `CADGPT_DRAWING_NAME`, `CADGPT_DRAWING_PATH`, `CADGPT_DRAWING_HOST`, and `CADGPT_DRAWING_RUNTIME_IDENTITY`. Direct Job code must use that explicit identity and must not guess or inherit AutoCAD `ActiveDocument`.

Direct Job execution uses `<job-root>/runtime` as process CWD. CadGPT also provides `CADGPT_JOB_ROOT` for permanent package-relative assets, `CADGPT_JOB_RUNTIME_ROOT` for raw/intermediate scratch, and `CADGPT_JOB_RESULT_ROOT` when a drawing-scoped final-result namespace is available. A Direct Job must not rely on the old script-directory CWD to find permanent helpers.

## Required Job Structure

Reasoning Jobs must define identity, goal, preconditions, ordered steps, per-step tool/executor scope, success criteria, failure handling, outputs/postconditions, and final validation. Direct Jobs encode their workflow in Python, but still require an explicit goal, controlled inputs, deterministic target handling, failure behavior, and real final validation before promotion.

Each step should define:

- `id`
- `instruction`
- `inputs`
- `available_tools` / explicit executor scope
- optional `preferred_tools`
- optional viable alternatives when semantics remain equivalent
- `success_criteria`
- `failure_handling`
- `output` / postcondition / evidence
- mutation scope when the step changes state

The exact file format may evolve; these semantics are required.

## Tool Scoping

Each step must expose/use only the capabilities needed for that step. Do not give every step access to every CadGPT tool by default.

Tool alternatives are allowed only when they satisfy the same step contract and do not silently change business semantics.

## Storage and Ownership

Job **specification, rules, schema, authoring guidance, and runtime contract** are CadGPT internal knowledge and version with CadGPT.

User-created/imported Jobs are user assets. Reusable promoted User Jobs live in managed Job Libraries under:

```text
appdata/libraries/jobs/<library-id>/**
```

Working authoring/refinement copies live under:

```text
appdata/workspace/job-draft/**
```

Every Job source mutation uses an explicit absolute canonical filesystem path under that approved draft root. Relative paths and ambient process CWD never authorize a write.

Official Internal Jobs do not use this storage path. They remain in CadGPT install/source resources and are registered by the Internal Registry.

In packaged builds the same virtual AppData paths map to the user's CadGPT AppData directory.

External folders selected by the user are import sources only. CadGPT never writes back to those source folders. Import copies a library into AppData; subsequent execution/editing uses managed AppData assets.

Permanent managed Job libraries are read-only to generic file tools. Existing reusable Jobs are refined through:

```text
job_get
→ job_checkout
→ workspace draft edit
→ job_draft_validate
→ approved real test
→ final validation
→ explicit user acceptance
→ job_promote_draft
→ managed Job Library + User Registry
```

New Jobs begin in `appdata/workspace/job-draft/**` only after the `jobcreate` planning approval gate and become reusable only through `job_promote_draft`.

A reusable User Job package owns its private executable assets and its current-run scratch space:

```text
<job-root>/
├─ JOB.md | <job-name>.py
├─ lisp/
├─ dynamic-lisp/
├─ tools/
└─ runtime/
```

The first four entries are permanent Job definition/executable assets. `runtime/**` is different: it is mutable working/recovery state owned by that Job and never retained as permanent Job history. Reasoning Jobs preserve existing runtime bytes across relaunch so interrupted raw queues can resume; successful processing must delete completed raw/intermediate files explicitly. Direct Jobs keep deterministic clean-scratch semantics and reset runtime at dispatch. Raw inputs collected during execution, temporary inventories, mappings, intermediate JSON/CSV and other working files belong there.

`runtime/**` is never part of the promoted Job bundle, never copied by checkout/promotion and never included in the permanent bundle hash. Changing `runtime/**` therefore cannot create a Job version/conflict. `dynamic-lisp/**`, despite its name, is a persistent executable derivative and is **not** scratch runtime.

## Reasoning Job data isolation — two writable destinations

This rule applies to **User Reasoning Jobs (JOB.md)** and their FILE/SYSTEM
tool calls. Direct Python Jobs continue to use their existing fixed executor
contract; this rule does not introduce a new Direct Job sandbox or migration.

Each reusable Job has its **own** managed folder
`appdata/libraries/jobs/<library-id>/<job-name>/`. During an execution,
the following is the complete data-writing policy:

| Purpose | Authorized location | Access |
| --- | --- | --- |
| Collected raw, CSV/JSON intermediates, progress `JOB_STEPS.md`, working and debug data | `<this-job-root>/runtime/**` | READ/WRITE |
| Final drawing-specific Job product | **exact** folder returned by `drawing_job_result_location`: `drawings/<verified-anchor>/jobs/<job-name>-result/**` | READ/WRITE only after authorization |
| Other Job packages, runtimes and results; global data/workspace; user-supplied inputs | Only those paths granted by normal read-only tool authority | READ ONLY, never write/edit/delete |
| Parent of Drawing Anchor results, other Job result folders, drawing knowledge/system/metadata | Normal authorized read only | NEVER WRITE |

`job_runtime_prepare` MUST happen before any Reasoning Job working-data
mutation. Always copy/convert imported data into `runtime/**` for working
transforms; never modify an input in its original location. No stage may
construct its own drawing-root or choose an alternate result folder. Call
`drawing_job_result_location` before publishing final output and use the
exact authorized path it returns. External folders are never writable merely
because the Job has permission to read them.

This FILE/SYSTEM write restriction is enforced by runtime tool scopes, not
just markdown advice. Completing `job_runtime_finish` does NOT restore
generic workspace, data, or drawing-root write permission within that Work.
A Job-owned dynamic Lisp in `dynamic-lisp/**` is a persistent *program
asset*, modified only through controlled `job_dynamic_lisp_prepare/patch`
and authoring/promotion gates; it is NEVER an extra raw/result-output root.
Likewise, `jobcreate` may edit separate drafts via its explicit authority,
not through Reasoning Job output permissions. No Human Power/alternative
tool workaround may silently bypass these Job storage rules.

## Local Custom Job compatibility signal

CadGPT uses `JOB_LOCAL_COMPAT_EPOCH` as a lightweight signal that
a source behavior change may require already-installed User Jobs in AppData
to be checked or repaired. It is **not** a Job-system version. Contract
epoch **2** covers HYBRID by default, `runtime/JOB_STEPS.md`, current
`JOB.md` retrieval, correct branch-entry checks and original platform/Lisp
error reporting. Any future source change that affects how existing Custom
Jobs are executed MUST update the versioned Job behavior documents and
the local compatibility instructions; do not hide behavior changes only in
CadGPT implementation source. Bump the epoch for incompatible changes.
The small source-contract fingerprint catches subsequent changes to these
documents even if the epoch was not bumped.

Before normal User Job create/run/update work, CadGPT performs the O(1)
`job_local_compat_status` check (epoch + fingerprint against the local
checked marker). On mismatch, visibly notify the user and request a
`jobcreate` CONTRACT UPDATE scan of actual User Job definitions. Do not
quietly start an outdated User Job or assume a CadGPT core update has also
replaced its permanent AppData `JOB.md`. When there is no mismatch, do
not enumerate or inspect Job packages. Any unresolved pending actions
from an earlier scan must still be displayed to the user without
rerunning a full scan every time.

When they differ, `jobcreate` enters **CONTRACT UPDATE** mode:

```text
job_local_compat_status
→ job_list User Jobs
→ job_get each local package only now
→ detect current-contract violations
→ checkout/fix/test/promote only affected Jobs
→ report changed / unchanged / blocked items
→ job_local_compat_mark_checked
```

The updater uses the normal Job authoring authority. It must not enable Human Power, bypass a Registry/platform gate or silently broaden ownership. If a local correction is valid but an external registration/policy action is blocked, keep the safe local result when possible and report the exact remaining action. Pending external actions are recorded with the report but do not force a full deep scan on every later Job call.

## Choosing the Executor for a Step

Use the most suitable executor that preserves the step semantics.

### Existing LISP
Use a registered Lisp capability when reusable AutoLISP already performs the required work reliably and its registry semantics are sufficiently reviewed for the intended use.

### Job-owned internal helper assets
When a Job needs code that exists only to implement that Job, the helper is part of the Job package rather than a shared CadGPT capability.

Canonical private helper ownership is:

```text
<job-root>/lisp/*.lsp      # private AutoLISP
<job-root>/tools/**        # other private helper/script/assets
```

Private Job helpers are declared/resolved by the owning Job only. They are not independent global/user Registry capabilities. A Job-owned internal Lisp helper:

- is authored, versioned, tested, checked out and promoted with its owning Job;
- is declared locally by the Job contract so the Job can resolve and load it;
- is loaded on demand only when that Job requires it;
- is not added to the global/user Lisp Registry;
- is not discoverable as an independent reusable Lisp capability;
- must not be moved into a shared Lisp Library merely to bypass missing Job-bundle tooling.

The same ownership rule applies to `tools/**`: checkout, validation hashing and promotion preserve those assets with the Job, but they are not separately registered globally.

This differs from a Job-owned dynamic derivative: an internal helper is authored specifically for the Job, while a dynamic derivative is seeded from a registered proven Lisp and then changes only declared dynamic sections.

If current runtime authoring/promotion/loading cannot preserve a required Job-owned helper inside the Job bundle, that is a platform blocker. Do not replace the intended ownership model with a registry workaround.

### Drawing-scoped persistent Job products
Job source/assets and Job runtime products have different ownership.

CadGPT ensures a durable `drawing_anchor` whenever a drawing is successfully bound. The execution-scoped runtime `drawing_id` remains separate and must never be used as persistent identity.

When a Job needs a final persistent result for the bound drawing, drawing identity/root resolution remains owned by CadGPT. For first-time CAD/HYBRID work, the Job uses `drawing_job_result_location`; this tool re-validates the Drawing Anchor and returns the Job namespace. For a **sequential FILE-only Job B** in the same CadGPT conversation, `cadgpt_work_start` inherits only the single *previously CAD-verified* drawing metadata root as read-only; `job_runtime_prepare` then automatically prepares B's own result namespace and returns `drawing_result.absolute_path`. B may read A's result and update only B's result without reopening `@cg` or acquiring CAD tools. If there is no earlier verified root or multiple roots are ambiguous, inheritance fails closed and a normal CAD drawing bind is still required. The returned Job namespace is:

```text
<tool-provided-drawing-root>/
└─ jobs/
   └─ <job-name>-result/
```

The Job must never construct `%LOCALAPPDATA%\CadGPT\drawings\<drawing_anchor>\` itself. It writes only final/persistent Job products to the returned `<job-name>-result` directory. Raw inputs, inventories, mappings, intermediate JSON/CSV, debug files and other working data stay in `<job-root>/runtime/**`.

The `drawing_metadata_location` primitive remains the canonical owner of drawing-root validation, creation, authorization and empty-root cleanup for non-Job callers and internal composition. Job result cleanup removes an empty `<job-name>-result` (and empty `jobs/`) before drawing-root cleanup; a non-empty result is retained. Jobs must not infer further drawing-storage layout or derive a replacement identity from filename/path, runtime `drawing_id`, ActiveDocument, work/session identity, or their own Job folder.

### Job-owned dynamic Lisp derivative
When a Job needs the **same proven Lisp logic with changing data/ranges/sections**, prefer a persistent derivative owned by that Job:

```text
registered working Lisp source
→ seed once into <job>/dynamic-lisp/**
→ on later runs reuse that same Job copy
→ exact-replace only declared dynamic section(s)
→ syntax validate
→ verified load
→ run original command
```

Use `job_dynamic_lisp_prepare` to make the initial byte-for-byte copy or reuse the existing copy. Use `job_dynamic_lisp_patch` for hash-guarded exact replacements. The patch may add/remove rows or sections when the Job input requires it, but code outside the declared dynamic area must remain unchanged.

Do **not** solve this case by generating an adapter/wrapper that feeds or shadows the old command. Do **not** recopy the source on every run. A changed upstream source is reported as provenance drift; it does not silently overwrite the Job-owned derivative.

### `write-lisp` Skill
Use when required AutoLISP does not exist, is insufficient, is broken, or requires a controlled patch. Work happens in AppData workspace; imported source folders and permanent managed libraries are not edited by generic file tools.

### CAD MCP Direct Tools
Use when the operation is small, explicit, and better performed directly than by creating Lisp automation.

### Structured Reasoning
Use when a decision must be made from structured CAD data, explicit rules, mappings, or diagnostics.

## `write-lisp` Integration Rule

`write-lisp` is a system Skill, not a Job. A Job may call it from any step that requires AutoLISP creation or modification. The Job returns to the interrupted step after the applicable Lisp validation/test/promotion gate succeeds.

## `jobcreate` Integration Rule

`jobcreate` owns Job authoring/refinement. It does not define a second Job semantic model; it implements this canonical contract.

Permanent Job promotion is allowed only after:

- the draft passes `job_draft_validate`;
- the intended real execution/test path has actually been exercised;
- final result/postcondition has been verified;
- required test/final-validation evidence is available;
- the user explicitly accepts the tested reusable Job.

`job_promote_draft` performs the permanent managed-library write and User Registry synchronization.

## Validation

Every Job must define final validation against the actual drawing/result. Command dispatch alone is not success.

`job_draft_validate` validates the source according to its mode:

- reasoning `JOB.md`: canonical workflow structure;
- direct `.py`: Python syntax using the configured CadGPT Python runtime.

Passing source validation does not prove runtime behavior. A valid `.md` or `.py` file is still only a draft until its intended workflow has been tested and the final result verified.

## Failure Rules

Jobs fail explicitly rather than silently guessing:

- missing evidence -> unresolved state;
- ambiguous mapping -> unresolved/unmapped;
- missing automation -> call `write-lisp` only if allowed by the approved step plan;
- CAD MCP unavailable -> stop CAD-dependent execution;
- validation failure -> do not report Job success;
- missing business/domain rule -> ask/resolve; do not invent a plausible default.

## Naming and Location

A concrete reusable **User Job** normally lives under one managed library:

```text
Reasoning: appdata/libraries/jobs/<library-id>/<job-name>/JOB.md
Direct:    appdata/libraries/jobs/<library-id>/<job-name>/<job-name>.py
```

Supporting reusable definition assets live beside the Job entrypoint when they belong only to that Job. This includes `<job-root>/lisp/**`, `<job-root>/dynamic-lisp/**` and `<job-root>/tools/**`. Current-run working/recovery data lives in `<job-root>/runtime/**` and is excluded from the permanent bundle/hash. Reasoning Jobs preserve pending runtime data across relaunch; Direct Jobs reset runtime on each dispatch.

Shared reusable AutoLISP logic belongs to a managed Lisp Library. A **Job-owned dynamic derivative** is the explicit exception and lives under:

```text
appdata/libraries/jobs/<library-id>/<job-name>/dynamic-lisp/*.lsp
```

It must originate from a registered working Lisp source, retain provenance, reuse the persisted Job copy on later executions, and mutate only declared dynamic data/sections through the controlled Job dynamic-Lisp path. It is not separately registered as a shared Lisp capability.

## Transitional Jobs

Migrated transitional Jobs may predate the full canonical per-step structure. Their transitional status must remain explicit. They should not be treated as fully `jobcreate`-validated reusable workflows until checked out, normalized, tested and promoted through the current lifecycle.

## Non-Goals

A Job is not a chat session, AI persona, autonomous agent, generic coding environment, or wrapper around one fixed tool. It is a repeatable constrained CAD workflow specification executed under the current CadGPT session/drawing context.
