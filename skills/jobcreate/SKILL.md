# Skill: jobcreate

Status: **active**

`jobcreate` is CadGPT's specialized **Job authoring and refinement** capability. It is the Job equivalent of `write-lisp`: it may reason, ask questions, compare alternatives, map tools and test execution, but that reasoning is constrained to producing or refining a concrete CadGPT Job.

It is **not** a generic autonomous agent and it must not invent missing business/domain semantics.

## Core rule

> Discuss before drafting. Map the workflow before implementation. Never invent domain rules. Every Job source mutation uses an explicit absolute canonical path inside its approved root. Implementation includes real execution/testing. Promote only after the Job has passed its intended test.

`jobcreate` uses the canonical Job contract in `knowledge/jobs/**`; it does not define a second Job model.

## Storage

```text
knowledge/jobs/**                         internal Job contract/rules
skills/jobcreate/**                       internal read-only authoring skill
appdata/workspace/job-draft/**            Job working drafts
appdata/libraries/jobs/<library-id>/**     promoted reusable Jobs
appdata/registry/user/**                   promoted Job registry metadata
appdata/data/runs/**                       test/evidence outputs when applicable
```

External user folders are import sources only. `jobcreate` works on managed AppData copies/drafts and never writes back to an external source folder.

Permanent `appdata/libraries/**` content is read-only to generic file tools. `jobcreate` must use the controlled Job lifecycle tools for reusable Job mutation/promotion.

## Entry modes

`jobcreate` supports the same authoring workflow from three entry points:

1. **Goal only** — user states the desired outcome. Ask whether the user wants `jobcreate` to propose a skeleton or wants to provide the steps.
2. **User skeleton** — user supplies some or all steps. Develop and clarify that skeleton; do not replace it without agreement.
3. **Refine existing Job** — load the existing managed Job first, then discuss only what is wrong, missing or should change. Preserve accepted workflow semantics unless the user explicitly changes them.

## Reasoning boundary

`jobcreate` may reason about:

- decomposition of the requested workflow into steps;
- dependencies and ordering;
- what information each step requires and produces;
- which registered Skill/Lisp/CAD MCP/file tool is suitable;
- preferred vs viable alternative executors;
- validation and failure handling;
- test design for proving that the Job actually works.

`jobcreate` must **not** silently decide domain facts such as naming conventions, authoritative properties, classification rules, mappings, thresholds, layer standards or company policy when those facts were not supplied or already registered.

When a domain decision is missing, ask the user or mark it explicitly as unresolved during planning. Do not hide uncertainty by filling in a plausible default.

## Required workflow

### Phase A — Planning

Planning is conversational. No permanent Job is written during this phase.

#### A1. Establish authoring mode

For a new Job, determine whether the user wants:

```text
jobcreate proposes skeleton
or
user provides skeleton
```

For an existing Job, load the current workflow and ask what part is not working or needs extension.

#### A2. Clarify goal and boundaries

Establish only the information needed to define the Job correctly:

- goal / final result;
- starting state and inputs;
- scope and exclusions;
- important user/company rules;
- mutation/destructive boundaries;
- expected outputs;
- what counts as success.

Ask targeted questions when needed. Do not create a long generic questionnaire when the requirement is already clear.

#### A3. Build or refine the skeleton

Discuss the ordered workflow with the user. A skeleton is an agreed sequence of meaningful steps, not yet an implementation file.

For each proposed step, make the intent understandable before mapping tools.

If several workflow structures are viable, present the useful alternatives and trade-offs. The user chooses the business/workflow direction.

#### A4. Detailed step planning and capability mapping

After the skeleton is accepted, detail every step. Each step must identify:

```text
id
instruction / intended action
inputs
expected output
success criteria
failure handling
preferred tools / Skills / registered Lisp
viable alternative tools / Skills / registered Lisp
required evidence or postcondition
mutation scope
unresolved requirements, if any
```

Use registry/discovery before naming an existing capability. Do not claim a Lisp, Skill or CAD MCP tool exists without checking.

`preferred_tools` means the first implementation choice when available and valid.

`viable_tools` means allowed alternatives the executor may choose when they satisfy the same step contract. Alternatives must not change business semantics.

#### A5. Final implementation plan — approval gate

Before writing the Job draft, present a compact final plan showing:

- Job goal;
- ordered steps;
- what each step does;
- preferred and viable executors for each step;
- important inputs/outputs;
- validation strategy;
- unresolved items;
- planned real test.

Then obtain explicit user approval.

**Do not create the Job draft before this approval.**

---

### Phase B — Implement + test

Implementation begins only after the planning approval gate.

#### B1. Create or checkout a Job draft

New Job:

```text
<absolute appdata/workspace/job-draft>/<library-id>/<job-name>/JOB.md
```

Resolve the exact absolute path first, then create the new draft with generic workspace file tools only after J3 approval.

Existing Job refinement:

```text
job_get
→ resolve exact absolute draft_path
→ job_checkout(registry_id, draft_path)
→ edit that absolute draft only
```

Relative/CWD-derived mutation paths are invalid. Re-checking out over an existing draft requires explicit overwrite plus its current SHA-256.

Do not copy/edit the permanent managed Job directly. The managed reusable Job remains unchanged until `job_promote_draft` succeeds.

#### B2. Author against the canonical Job contract

The draft must satisfy `knowledge/jobs/JOB_RULES.md` and the `jobcreate` harness.

Every step must retain its agreed semantic purpose, explicit tool/executor scope, outputs/postconditions, success criteria and failure behavior.

Do not broaden tool access merely because a tool is available.

Run:

```text
job_draft_validate
```

before real execution. A structurally invalid draft does not proceed to promotion.

#### B3. Implement missing capabilities only when required

If a planned step requires a capability that does not exist:

- use `write-lisp` when AutoLISP is the agreed executor;
- use existing CAD MCP/file capabilities when they fit;
- if a required primitive truly does not exist, surface that as an implementation blocker rather than silently redesigning the Job.

After a called Skill completes its own gate, return to the interrupted Job step.

#### B4. Real execution/test — mandatory

A Job is not proven by reading its Markdown or dispatching commands. The workflow must be exercised against an explicitly approved test context.

```text
draft Job
→ execute actual steps
→ collect actual outputs/postconditions
→ verify step success
→ verify final Job result
```

For CAD-mutating Jobs, use an explicitly approved test drawing or explicitly approved bound drawing. Never silently use a project drawing for destructive testing.

If a step is interactive, the user may perform the required manual interaction, but the resulting state/output must still be checked against the step and final success criteria.

Record concise test evidence and final-validation evidence suitable for the promotion call.

#### B5. Refine loop

If the real test exposes a problem:

```text
identify failing step
→ discuss semantic change with user if required
→ patch draft narrowly
→ job_draft_validate
→ re-run affected test path
→ verify final result again
```

Do not promote a Job with known failing or untested required paths.

#### B6. Promotion gate

A reusable Job may be promoted to:

```text
appdata/libraries/jobs/<library-id>/<job-name>/JOB.md
```

only when:

1. the agreed workflow is represented in the draft;
2. `job_draft_validate` passes;
3. required unresolved business decisions are closed or explicitly excluded;
4. the real execution/test has passed the applicable success criteria;
5. final output/postcondition has been verified;
6. the user explicitly accepts the tested Job for permanent use.

Then call `job_promote_draft` with the absolute tested `draft_path`, the exact absolute managed `target_path`, metadata, test evidence, final-validation evidence and `user_accepted=true`. If replacing an existing managed Job, require its current target SHA-256; never silently overwrite a concurrent change.

`job_promote_draft` is the only normal `jobcreate` path that mutates a permanent managed Job and synchronizes the User Registry entry.

## Refine-existing rule

Refining an old Job uses the same Planning → Implement+Test → Promote lifecycle.

The difference is only the starting point:

```text
existing workflow
→ job_checkout
→ identify weak/missing step(s)
→ discuss the intended delta
→ remap affected tools/validation
→ final plan approval
→ draft patch
→ job_draft_validate
→ real test
→ final validation
→ job_promote_draft only after pass + user acceptance
```

Do not rewrite unaffected steps for cosmetic consistency.

## Relationship to `write-lisp`

`jobcreate` owns workflow authoring. `write-lisp` owns AutoLISP engineering.

A Job step may invoke `write-lisp` when Lisp creation or repair is part of the approved implementation plan. `jobcreate` must not absorb AutoLISP-specific coding rules into the Job definition.

## Required supporting knowledge

Read as needed:

```text
knowledge/jobs/JOB_RULES.md
skills/jobcreate/job-skills/workflow-planning.md
skills/jobcreate/job-skills/tool-mapping.md
skills/jobcreate/job-skills/implementation-testing.md
skills/jobcreate/harness/README.md
```

## Completion

`jobcreate` is complete only when either:

- Planning ends with an explicitly user-approved implementation plan and the user chooses not to implement yet; or
- the Job has been drafted, `job_draft_validate` has passed, the Job has been actually tested, refined as necessary, accepted by the user, promoted through `job_promote_draft`, and synchronized with User Registry.

A written-but-untested Job is a **draft**, not a completed reusable Job.
