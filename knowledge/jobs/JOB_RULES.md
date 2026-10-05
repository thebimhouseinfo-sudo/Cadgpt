# CadGPT Job Rules

## Human Power interaction

Human Power is a CadGPT **execution-level emergency capability**, not Job state.

A Job does not become a bypassed/flagged Job merely because Human Power was used while diagnosing or repairing CadGPT during that execution. If a platform blocker interrupts Job authoring/testing, the human may explicitly enable Human Power for the current work execution, repair the CadGPT/runtime issue, then continue the same Job. Human Power automatically ends with that work execution or may be stopped explicitly.

Source-code changes made under Human Power are recorded in the managed Human Power error log with the original error context, expected behavior, fix description, target file and before/after hashes.

Normal Job validation, real execution, user acceptance and promotion requirements still apply to the Job result.

## Purpose

A **Job** in CadGPT is a small, repeatable CAD workflow: a known sequence of steps executed under one explicit CadGPT WorkRegistration to produce a concrete result.

A Job is not an AI agent and does not own a chat session. The current CadGPT invariant is **1 work execution = 1 bound drawing**. A Job must never inherit or guess another chat/execution's drawing target. Multi-drawing Job execution is not supported by the current runtime; workflows that need another drawing must cross an explicit work/binding boundary.

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
- write only approved workspace/data outputs through generic file tools.

A step must **not** directly edit permanent `appdata/libraries/**` content with generic file tools.

## Job vs Skill vs Tool

- **Job** = repeatable CAD workflow / unit of work
- **Skill** = reusable expert capability used by Jobs, for example `write-lisp` or `jobcreate`
- **Tool** = concrete execution mechanism, for example CAD MCP query, CAD MCP command execution, or managed file read/edit
- **Harness** = quality gate used by a Skill or Job validation process

## Job execution modes

CadGPT has two execution modes:

- **Reasoning Job** — User Registry `.md` workflows use the canonical structured workflow contract and `REASONING_HARNESS.md`.
- **Direct Job** — dispatched by `job_run_direct` with no model planning between internal operations. User Registry Direct Jobs are reviewed deterministic `.py` entrypoints. CadGPT may also ship a small explicit set of **official Internal Direct Jobs** implemented by bounded built-in executors.

User-authored Jobs use the managed draft → validate → real test → user acceptance → promote lifecycle. Official Internal Jobs version with CadGPT, are read-only product capabilities, never live in User AppData, and cannot be overridden by a User Registry id. A Direct Job is never exempt from drawing-targeting, authority, evidence, or final validation rules.

When a Direct Job runs with one bound drawing, CadGPT serializes the child process under that drawing host lock and provides exact target identity through `CADGPT_DRAWING_ID`, `CADGPT_DRAWING_NAME`, `CADGPT_DRAWING_PATH`, `CADGPT_DRAWING_HOST`, and `CADGPT_DRAWING_RUNTIME_IDENTITY`. Direct Job code must use that explicit identity and must not guess or inherit AutoCAD `ActiveDocument`.

A Direct Job is an **execution-only / no-persistent-data Job**. It does not own the Reasoning/Dynamic Job working-data lifecycle and must not leave file/directory output. CadGPT runs user Direct Jobs in disposable scratch CWD, removes that scratch after execution, and exposes only a minimal child environment plus required `CADGPT_*` execution identity. If persistent/intermediate files are part of the workflow, the workflow is not a Direct Job and must use the Reasoning/Dynamic Job contract.

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

### Runtime working data

Reusable Job definition and Job execution data are separate ownership domains.

Reasoning/Dynamic Jobs begin a runtime context with `job_working_location`. CadGPT returns one execution-scoped working root under:

```text
appdata/workspace/job-run/<job-id>/<execution-scope>/**
```

This root is the **only normal writable location for Job internal/raw/intermediate/generated runtime files** while that Job runtime context is active.

Runtime working-data rules:

- the folder contains current-run working state only;
- it is not Job history and is not a durable project record;
- beginning a fresh run replaces the prior current-run state for that execution;
- normal work stop/replacement/expiry and `job_runtime_end` remove it;
- a later Job run prunes stale abandoned Job workspaces across the runtime root while preserving work owned by a live execution/process;
- Job A cannot read/write Job B's runtime workspace through generic file tools;
- `appdata/data/runs/**` is reserved for explicit authoring/test evidence when applicable and is not a production Job raw-data sink.

A locally modified Job `JOB.md` is source/definition input, not runtime working data. Runtime cleanup must never overwrite or delete it.

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

## Choosing the Executor for a Step

Use the most suitable executor that preserves the step semantics.

### Existing LISP
Use a registered Lisp capability when reusable AutoLISP already performs the required work reliably and its registry semantics are sufficiently reviewed for the intended use.

### Job-owned internal helper assets
When a Job needs code that exists only to implement that Job, the helper is part of the Job package rather than a shared CadGPT capability.

For AutoLISP, the canonical ownership is:

```text
<job-root>/lisp/*.lsp
```

A Job-owned internal Lisp helper:

- is authored, versioned, tested, checked out and promoted with its owning Job;
- is declared locally by the Job contract so the Job can resolve and load it;
- is loaded on demand only when that Job requires it;
- is not added to the global/user Lisp Registry;
- is not discoverable as an independent reusable Lisp capability;
- must not be moved into a shared Lisp Library merely to bypass missing Job-bundle tooling.

This differs from a Job-owned dynamic derivative: an internal helper is authored specifically for the Job, while a dynamic derivative is seeded from a registered proven Lisp and then changes only declared dynamic sections.

If current runtime authoring/promotion/loading cannot preserve a required Job-owned helper inside the Job bundle, that is a platform blocker. Do not replace the intended ownership model with a registry workaround.

### Drawing-scoped persistent Job products
Job source/assets and Job runtime products have different ownership.

CadGPT ensures a durable `drawing_anchor` whenever a drawing is successfully bound. The execution-scoped runtime `drawing_id` remains separate and must never be used as persistent identity.

When a Job needs persistent metadata about the bound drawing, it must call the shared `drawing_metadata_location` tool. The tool re-validates the anchor, resolves or creates:

```text
%LOCALAPPDATA%\CadGPT\drawings\<drawing_anchor>\
```

and returns the canonical absolute path.

The Job/model must not assemble this path itself. Outside an active Job runtime, generic `file_*` access to `drawings/**` remains limited to the exact drawing root authorized by `drawing_metadata_location` for the current execution.

Inside an active Reasoning/Dynamic Job runtime, that drawing root is **readable but not generically writable**. Raw/intermediate files stay in the Job working root. The Job may send only an explicitly selected final result file to drawing storage through:

```text
job_publish_result
```

Published results live beneath the owning Job namespace:

```text
drawings/<drawing_anchor>/<job-id>/**
```

`job_publish_result` accepts sources only from the active Job working root and only after `drawing_metadata_location` authorized the exact drawing root. This prevents raw collection/intermediate artifacts from being copied into durable drawing storage by generic file operations.

If the tool created an empty drawing root and the execution ends without writing metadata, CadGPT cleanup removes that one registered empty directory. A non-empty directory is retained.

Jobs must not derive a replacement identity from filename/path, runtime `drawing_id`, ActiveDocument, work/session identity, or their own Job folder.

### Job-owned dynamic Lisp derivative
When a Job needs the **same proven Lisp logic with changing data/ranges/sections**, prefer a persistent derivative owned by that Job:

```text
registered working Lisp source
→ begin/ensure the active Job runtime workspace
→ seed a fresh current-run copy into <job-work>/dynamic-lisp/**
→ within the same run reuse that working copy
→ exact-replace only declared dynamic section(s)
→ syntax validate
→ verified load
→ run original command
→ publish only the final durable Job result when one exists
→ delete current-run working state at Job end
```

Use `job_dynamic_lisp_prepare` to make the byte-for-byte current-run seed or reuse it later in the **same** Job run. Use `job_dynamic_lisp_patch` for hash-guarded exact replacements. The patch may add/remove rows or sections when the Job input requires it, but code outside the declared dynamic area must remain unchanged.

Do **not** solve this case by generating an adapter/wrapper that feeds or shadows the old command. A new Job run starts from the registered proven source again; the previously patched runtime copy is not Job history and is not used to mutate the permanent Job library. If durable state from the previous run matters to business logic, persist only that explicit final result/state through the drawing-result contract, not by retaining a mutated runtime Lisp file.

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

Supporting reusable **definition/template** assets may live beside the Job entrypoint when they belong to the Job contract. This includes Job-owned internal helpers under `<job-root>/lisp/**`. Legacy/template material may exist under `<job-root>/dynamic-lisp/**`, but per-run patched/generated state must live in the active Job working root and must not mutate the permanent Job definition. Persistent drawing results belong under `AppData/drawings/<drawing_anchor>/<job-id>/**` only through the final-result publication contract. Explicit authoring/test evidence may live under managed data/run locations; production raw/intermediate Job data may not.

Shared reusable AutoLISP logic belongs to a managed Lisp Library. A Job-owned **runtime dynamic derivative** is generated under the active Job working root:

```text
appdata/workspace/job-run/<job-id>/<execution-scope>/dynamic-lisp/*.lsp
```

It originates from a registered working Lisp source, retains current-run provenance, and mutates only declared dynamic data/sections through the controlled Job dynamic-Lisp path. It is not separately registered as a shared Lisp capability and is deleted with the Job runtime workspace.

## Transitional Jobs

Migrated transitional Jobs may predate the full canonical per-step structure. Their transitional status must remain explicit. They should not be treated as fully `jobcreate`-validated reusable workflows until checked out, normalized, tested and promoted through the current lifecycle.

## Non-Goals

A Job is not a chat session, AI persona, autonomous agent, generic coding environment, or wrapper around one fixed tool. It is a repeatable constrained CAD workflow specification executed under the current CadGPT session/drawing context.
