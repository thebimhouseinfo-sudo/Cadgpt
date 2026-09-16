# CadGPT Job Rules

## Purpose

A **Job** in CadGPT is a small, repeatable CAD workflow. It is the replacement for the old CAD workflow/skill concept: a known sequence of steps that should be executed repeatedly on drawings to produce a concrete result.

A Job is not an AI agent and does not own a chat session. The CadGPT session remains bound to one drawing while multiple Jobs may run in sequence.

## Core Principle

A Job defines:

- **what must be done**
- **how many steps are required**
- **what instruction applies to each step**
- **which tools are available in each step**
- **what output each step must produce**
- **how success is validated before moving on**
- **what final result the Job must produce**

The Job describes the workflow. The executor for each step may differ.

A step may:

- run an existing AutoLISP capability from the User Registry
- call CAD MCP tools directly
- inspect structured CAD data
- read managed user assets inside CadGPT AppData
- call the `write-lisp` skill to patch or create AutoLISP in the AppData workspace
- read or edit managed Job definitions in AppData when explicitly required

## Job vs Skill vs Tool

- **Job** = repeatable CAD workflow / unit of work
- **Skill** = reusable expert capability used by Jobs, for example `write-lisp`
- **Tool** = concrete execution mechanism, for example CAD MCP query, CAD MCP command execution, or local file read/patch
- **Harness** = quality gate used by a Skill or Job validation process

## Required Job Structure

Every Job must define identity, goal, preconditions, ordered steps, per-step tool scope, success criteria, failure handling, outputs, and final validation.

Each step should define:

- `id`
- `instruction`
- `inputs`
- `available_tools`
- optional `preferred_tools`
- `success_criteria`
- `failure_handling`
- `output`

The exact file format may evolve; these semantics are required.

## Tool Scoping

Each step must expose only the capabilities needed for that step. Do not give every step access to every CadGPT tool by default.

## Storage and Ownership

Job **specification, rules, schema, authoring guidance, and runtime contract** are CadGPT internal knowledge and version with CadGPT.

Concrete Jobs are user assets. They live in managed Job Libraries under:

```text
appdata/libraries/jobs/<library-id>/**
```

In packaged builds the same virtual AppData paths map to the user's CadGPT AppData directory.

External folders selected by the user are import sources only. CadGPT never writes back to those source folders. Import copies a library into AppData; subsequent execution/editing uses the managed AppData copy.

## Choosing the Executor for a Step

Use the most suitable executor:

### Existing LISP
Use a registered Lisp capability when reusable AutoLISP already performs the required work reliably.

### `write-lisp` Skill
Use when required AutoLISP does not exist, is insufficient, or requires a controlled patch. Work happens in AppData workspace; imported source folders are never mutated.

### CAD MCP Direct Tools
Use when the operation is small, explicit, and better performed directly than by creating a Lisp automation.

### Structured Reasoning
Use when a decision must be made from structured CAD data, rules, mappings, or diagnostics.

## `write-lisp` Integration Rule

`write-lisp` is a system Skill, not a Job. A Job may call it from any step that requires AutoLISP creation or modification. The Job returns to the interrupted step after the applicable Lisp validation/test gate succeeds.

## Validation

Every Job must define final validation against the actual drawing/result. Command dispatch alone is not success.

## Failure Rules

Jobs fail explicitly rather than silently guessing:

- missing evidence -> unresolved state
- ambiguous mapping -> unresolved/unmapped
- missing automation -> call `write-lisp` only if allowed
- CAD MCP unavailable -> stop CAD-dependent execution
- validation failure -> do not report Job success

## Naming and Location

A concrete Job normally lives under one managed library:

```text
appdata/libraries/jobs/<library-id>/<job-name>/JOB.md
```

Supporting data may live beside `JOB.md`. Reusable AutoLISP belongs to a managed Lisp Library, not inside the Job folder.

## Non-Goals

A Job is not a chat session, AI persona, autonomous agent, generic coding environment, or wrapper around one fixed tool. It is a repeatable constrained CAD workflow specification.
