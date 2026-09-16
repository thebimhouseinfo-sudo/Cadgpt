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

- run an existing AutoLISP file
- call CAD MCP tools directly
- inspect structured CAD data
- read or edit files under `lisp/**`
- call the `write-lisp` skill to patch or create AutoLISP
- read or edit Job definitions under `jobs/**` when explicitly required

## Job vs Skill vs Tool

- **Job** = repeatable CAD workflow / unit of work
- **Skill** = reusable expert capability used by Jobs, for example `write-lisp`
- **Tool** = concrete execution mechanism, for example CAD MCP query, CAD MCP command execution, or local file read/patch
- **Harness** = quality gate used by a Skill or Job validation process

Example:

```text
Job
  -> Step
      -> existing LISP
      -> CAD MCP direct tool
      -> write-lisp skill
          -> local file tools
          -> coding harness
      -> validation
```

## Required Job Structure

Every Job must define the following top-level sections.

### 1. Identity

- `name`
- `display_name`
- `description`
- optional aliases used by `/job`

### 2. Goal

Describe the concrete final result of the Job.

The goal must be observable and testable. Avoid vague goals such as "clean the drawing well".

### 3. Preconditions

List conditions that must be true before the Job runs, for example:

- a drawing is bound to the CadGPT session
- required source files exist
- required CAD MCP capability is connected

### 4. Steps

A Job is an ordered sequence of steps.

Every step should define:

- `id`
- `instruction`
- `inputs`
- `available_tools`
- optional `preferred_tools`
- `success_criteria`
- `failure_handling`
- `output`

Recommended shape:

```yaml
steps:
  - id: inventory
    instruction: >
      Collect the layer/object inventory required by later steps.
    inputs:
      - bound_drawing
    available_tools:
      - cad.query
      - cad.lisp.load
      - cad.lisp.run
      - file.read:lisp
      - file.search:lisp
      - skill.write-lisp
    preferred_tools:
      - cad.lisp.run
    success_criteria:
      - required inventory exists
    failure_handling:
      - if automation is missing or insufficient, call skill.write-lisp
    output:
      - inventory
```

The final implementation does not have to use YAML. The semantics above are required regardless of file format.

## Tool Scoping

Each step must expose only the tools needed for that step.

Do not give every step access to every CadGPT tool by default.

This keeps execution more stable and reduces accidental or unnecessary actions.

Examples:

```text
Inventory step
  available_tools:
    CAD query
    LISP load/run
    file read/search under lisp/**

LISP repair step
  available_tools:
    file read/search/patch/create under lisp/**
    write-lisp skill
    CAD MCP load/run for verification

CAD modify step
  available_tools:
    CAD MCP modification tools
    CAD MCP command execution
```

## Local File Boundaries

By default, CadGPT local file tools are allowed to work only inside:

```text
lisp/**
jobs/**
```

Expected basic file operations:

- list
- search
- read
- create
- patch/edit

No arbitrary whole-machine filesystem access is required for normal Job execution.

A Job must not rely on access outside these roots unless the architecture is explicitly extended later.

## Choosing the Executor for a Step

A Job must not assume that all CAD work is executed through one mechanism.

Use the most suitable executor for the step:

### Existing LISP

Use when a reusable AutoLISP implementation already performs the required work reliably.

### `write-lisp` Skill

Use when:

- required AutoLISP does not exist
- existing AutoLISP cannot satisfy the current step
- existing AutoLISP needs a controlled patch

The Job should return to the interrupted step after `write-lisp` finishes.

### CAD MCP Direct Tools

Use when the operation is small, explicit, and better performed directly than by creating a LISP automation.

### Structured Reasoning

Use when the Job needs GPT to make a decision from structured CAD data, rules, mappings, or diagnostics.

Prefer structured CAD information over visual inference whenever the same decision can be made from query/export data.

## `write-lisp` Integration Rule

`write-lisp` is a Skill, not a Job.

A Job may call it from any step that requires AutoLISP creation or modification.

Expected loop:

```text
Job step
  -> automation missing / insufficient
  -> call write-lisp
  -> inspect existing lisp/**
  -> patch or create LISP
  -> run write-lisp harness
  -> load/test through CAD MCP
  -> return to original Job step
  -> continue Job
```

The Job itself should not duplicate AutoLISP coding rules. Those rules belong to the `write-lisp` skill and its harness.

## Validation

Every Job must define a final validation section.

Validation should verify the actual drawing/result, not merely that commands completed without error.

Examples:

- required object types no longer exist on targeted layers
- source layers were converted to expected target layers
- unmapped layers are explicitly reported
- expected files were created
- entity counts remain plausible
- no unintended geometry was removed

A Job is complete only when its declared final success criteria pass.

## Failure Rules

Jobs must fail explicitly rather than silently guessing.

Use these principles:

- missing evidence -> report unresolved state
- ambiguous mapping -> keep unresolved / unmapped
- missing automation -> call `write-lisp` if allowed by the step
- CAD MCP unavailable -> stop CAD-dependent execution
- validation failure -> do not report Job success

## Job Authoring Guidance

When creating a new Job:

1. Start from the final observable result.
2. Break the workflow into the smallest meaningful ordered steps.
3. Define the instruction for each step.
4. Define the minimum available tool set for each step.
5. Prefer existing LISP before creating new automation.
6. Use `write-lisp` only when code must be added or changed.
7. Use CAD MCP directly for small explicit CAD operations when that is simpler.
8. Define success criteria before implementation.
9. Define final validation against the real drawing/result.
10. Keep domain workflow knowledge in the Job and coding knowledge in Skills.

## Naming and Location

Each Job should live in its own folder:

```text
jobs/<job-name>/
```

Recommended primary file:

```text
jobs/<job-name>/JOB.md
```

Supporting Job-specific data may live beside it, for example:

```text
jobs/<job-name>/
  JOB.md
  rules/
  mappings/
  validation/
```

Do not place reusable AutoLISP implementation inside the Job folder. Reusable AutoLISP belongs under `lisp/**`.

## Non-Goals

A Job is not:

- a chat session
- an AI persona
- an autonomous agent
- a generic coding environment
- a wrapper around one fixed tool

It is a repeatable, constrained CAD workflow specification.