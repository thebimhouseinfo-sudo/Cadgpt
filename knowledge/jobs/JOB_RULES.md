# CadGPT Job Rules

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

## Choosing the Executor for a Step

Use the most suitable executor that preserves the step semantics.

### Existing LISP
Use a registered Lisp capability when reusable AutoLISP already performs the required work reliably and its registry semantics are sufficiently reviewed for the intended use.

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

Supporting reusable data may live beside the Job entrypoint when that data belongs to the Job contract. Runtime/test evidence belongs under managed data/run locations rather than being silently mixed into the permanent Job definition.

Reusable AutoLISP belongs to a managed Lisp Library, not inside the Job folder.

## Transitional Jobs

Migrated transitional Jobs may predate the full canonical per-step structure. Their transitional status must remain explicit. They should not be treated as fully `jobcreate`-validated reusable workflows until checked out, normalized, tested and promoted through the current lifecycle.

## Non-Goals

A Job is not a chat session, AI persona, autonomous agent, generic coding environment, or wrapper around one fixed tool. It is a repeatable constrained CAD workflow specification executed under the current CadGPT session/drawing context.
