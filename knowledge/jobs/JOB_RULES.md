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

## Required Job Structure

Every Job must define identity, goal, preconditions, ordered steps, per-step tool/executor scope, success criteria, failure handling, outputs/postconditions, and final validation.

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

Concrete Jobs are user assets. Reusable promoted Jobs live in managed Job Libraries under:

```text
appdata/libraries/jobs/<library-id>/**
```

Working authoring/refinement copies live under:

```text
appdata/workspace/job-draft/**
```

Every Job source mutation uses an explicit absolute canonical filesystem path under that approved draft root. Relative paths and ambient process CWD never authorize a write.

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

A structurally valid Markdown file is still only a draft until its intended workflow has been tested and the final result verified.

## Failure Rules

Jobs fail explicitly rather than silently guessing:

- missing evidence -> unresolved state;
- ambiguous mapping -> unresolved/unmapped;
- missing automation -> call `write-lisp` only if allowed by the approved step plan;
- CAD MCP unavailable -> stop CAD-dependent execution;
- validation failure -> do not report Job success;
- missing business/domain rule -> ask/resolve; do not invent a plausible default.

## Naming and Location

A concrete reusable Job normally lives under one managed library:

```text
appdata/libraries/jobs/<library-id>/<job-name>/JOB.md
```

Supporting reusable data may live beside `JOB.md` when that data belongs to the Job contract. Runtime/test evidence belongs under managed data/run locations rather than being silently mixed into the permanent Job definition.

Reusable AutoLISP belongs to a managed Lisp Library, not inside the Job folder.

## Transitional Jobs

Migrated transitional Jobs may predate the full canonical per-step structure. Their transitional status must remain explicit. They should not be treated as fully `jobcreate`-validated reusable workflows until checked out, normalized, tested and promoted through the current lifecycle.

## Non-Goals

A Job is not a chat session, AI persona, autonomous agent, generic coding environment, or wrapper around one fixed tool. It is a repeatable constrained CAD workflow specification executed under the current CadGPT session/drawing context.
