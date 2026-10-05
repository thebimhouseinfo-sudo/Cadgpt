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
appdata/libraries/jobs/<library-id>/**     promoted reusable Job package (entrypoint + lisp/ + dynamic-lisp/ + tools/)
<job-root>/runtime/**                       current-run scratch; reset next run; never promoted/hashed
appdata/registry/user/**                   promoted Job registry metadata
<drawing-root>/jobs/<job-name>-result/**   final persistent drawing result only
```

External user folders are import sources only. `jobcreate` works on managed AppData copies/drafts and never writes back to an external source folder.

Permanent `appdata/libraries/**` content is read-only to generic file tools. `jobcreate` must use the controlled Job lifecycle tools for reusable Job mutation/promotion.

## Entry modes

`jobcreate` supports four entry modes:

1. **Goal only** — user states the desired outcome. Ask whether the user wants `jobcreate` to propose a skeleton or wants to provide the steps.
2. **User skeleton** — user supplies some or all steps. Develop and clarify that skeleton; do not replace it without agreement.
3. **Refine existing Job** — load the existing managed Job first, then discuss only what is wrong, missing or should change. Preserve accepted workflow semantics unless the user explicitly changes them.
4. **CONTRACT UPDATE** — entered only when `job_local_compat_status` reports a changed local-compatibility epoch. This is the updater for existing local Custom Jobs; do not create a separate migration agent/framework.

For normal create/refine work, run the lightweight compatibility status before drafting. A matching epoch is a fast path and must not enumerate/deep-read all Jobs. A mismatch routes to CONTRACT UPDATE first.

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

### CONTRACT UPDATE — compatibility-only local repair

This mode is not ordinary feature/refinement planning. It executes only when `job_local_compat_status.update_required=true`. Before scanning, read `knowledge/jobs/LOCAL_COMPAT_UPDATE.md`; that file contains the detector, repair, validation and report instructions for the current compatibility epoch.

```text
job_local_compat_status
→ job_list User Registry Jobs
→ job_get each User Job only after the mismatch is known
→ compare its real local package/source with current JOB_RULES
→ classify unchanged vs affected vs blocked
→ job_checkout only affected Jobs
→ patch narrowly without changing business semantics
→ job_draft_validate
→ real test/re-check required affected behavior
→ job_promote_draft when the corrected Job is proven
→ produce one scan report
→ job_local_compat_mark_checked
```

The scan report must include scanned / affected / updated / unchanged / blocked counts and per-Job detected violations, performed local corrections, validation result and any required external follow-up.

CONTRACT UPDATE has no extra authority. Do not enable Human Power, bypass Registry/platform gates, invent domain rules or change ownership as a workaround. If a gate blocks an external cleanup/re-registration step, report the exact gate and required follow-up. A safe validated local correction may remain valid while that external action is pending. Pass pending actions to `job_local_compat_mark_checked` so the expensive scan does not repeat on every later Job call.

`JOB_LOCAL_COMPAT_EPOCH` is only a local-compatibility signal. Increase it only when a source/contract change can require repairs to already-installed Custom Jobs in AppData. Do not increase it for ordinary compatible features, docs or implementation refactors.

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
Reasoning: <absolute appdata/workspace/job-draft>/<library-id>/<job-name>/JOB.md
Direct:    <absolute appdata/workspace/job-draft>/<library-id>/<job-name>/<job-name>.py
```

Choose the mode explicitly from the approved plan. Use reasoning `.md` when the workflow requires model reasoning between stages. Use direct `.py` when the user wants a deterministic script dispatched without model planning. Resolve the exact absolute path first, then create the new draft with `job_draft_new` only after J3 approval. Generic file tools are for subsequent draft reads/edits, not a substitute for the new-draft primitive.

Existing Job refinement:

```text
job_get
→ resolve exact absolute draft_path
→ job_checkout(registry_id, draft_path)
→ edit that absolute draft only
```

Relative/CWD-derived mutation paths are invalid. Re-checking out over an existing draft requires explicit overwrite plus its current SHA-256.

Do not copy/edit the permanent managed Job directly. The managed reusable Job remains unchanged until `job_promote_draft` succeeds. If the target user Job library does not exist yet, create that empty managed library with `library_create` before promotion; do not invent or reuse the reserved internal id `tbh-toolkit`.

#### B2. Author against the canonical Job contract

The draft must satisfy `knowledge/jobs/JOB_RULES.md` and the `jobcreate` harness.

For reasoning `.md`, every step must retain its agreed semantic purpose, explicit tool/executor scope, outputs/postconditions, success criteria and failure behavior.

For direct `.py`, keep the script deterministic, use explicit inputs, fail loudly, and when a drawing is bound target only the exact `CADGPT_DRAWING_*` identity supplied by CadGPT. Do not guess `ActiveDocument` or scan for a convenient drawing. Direct execution runs with `CADGPT_JOB_RUNTIME_ROOT` as CWD; use that for raw/intermediate data. When supplied, `CADGPT_JOB_RESULT_ROOT` is the only Job-owned final drawing-result location.

Do not broaden tool access merely because a tool is available.

Run:

```text
job_draft_validate
```

before real execution. It validates reasoning structure for `.md` and Python syntax for `.py`, and returns the exact draft SHA-256. For a direct `.py` draft, execute the pre-promotion test with `job_run_direct_draft(draft_path, expected_sha256=<that hash>)`; never promote a direct Job that was only syntax-checked. A source-valid draft does not proceed to promotion until its real execution path is tested.

#### B3. Dynamic Lisp — derive from proven source, do not wrap

When a Job needs a Lisp whose **data/ranges/sections vary per execution** but the command logic already works, prefer a Job-owned dynamic derivative instead of creating an adapter around the old command.

Required behavior:

```text
registered working Lisp source
→ job_dynamic_lisp_prepare
   ├─ first run: byte-for-byte copy into <job>/dynamic-lisp/**
   └─ later runs: reuse existing Job copy; do not recopy
→ identify the declared dynamic data/section(s)
→ job_dynamic_lisp_patch with exact old_text/new_text + sha256
→ syntax validation is part of the patch gate
→ verified AutoCAD load of the Job-owned .lsp
→ run the original command
→ verify Job postcondition
```

The dynamic file is a **derivative owned by that Job**, not a new shared Lisp capability. Preserve the source command and all code outside the declared dynamic sections. Changing the number of data rows/sections is allowed when that is part of the Job input; replace the data block itself rather than building a wrapper that feeds the old command.

Example: an FDT-update-style Job should seed from the known-working FDT Lisp, replace the sizing table/range section directly (including adding/removing ranges), keep the rest of the FDT implementation unchanged, and persist that Job copy for the next run.

Use `appdata/runtime/dynamic-lisp/**` only for ad-hoc/session variants that do **not** belong to a reusable Job.

#### B3a. Job-owned internal helpers

When the approved Job design needs a private helper that exists only for that Job, keep it inside the Job bundle rather than creating a shared Registry capability.

For private helpers:

```text
AutoLISP:  <job-root>/lisp/*.lsp
Other:     <job-root>/tools/**
```

Both directories are Job bundle assets preserved by checkout/promotion and included in the permanent Job hash. They are not registered as independent global capabilities.

The helper is Job-private, declared by the owning Job, loaded on demand, and is **not** registered in the global/user Lisp Registry. Do not promote it through the shared Lisp library path merely because current bundle tooling is incomplete.

A private Job helper differs from `dynamic-lisp/**`: the private helper is authored specifically for the Job; a dynamic derivative is seeded from a registered working Lisp and preserves that source logic outside declared dynamic sections.

If the current draft/promotion/load primitives cannot preserve the required Job-owned helper with the Job, report the missing platform primitive as a blocker. Do not change ownership as a workaround.

#### B3b. Drawing-scoped persistent metadata

If the approved Job needs a final persistent drawing-scoped product, do not make the Job invent or implement drawing identity/path resolution.

At Job execution start, Reasoning Jobs call `job_runtime_prepare`. Raw/intermediate working data stays in the returned `runtime_root`.

At the step that publishes a final drawing result, call:

```text
drawing_job_result_location
```

CadGPT internally resolves the canonical drawing root through the existing Drawing Anchor tool contract and returns:

```text
<drawing-root>/jobs/<job-name>-result/
```

Use that returned absolute path only for final/persistent Job output. Never construct the drawing root or substitute filename/path matching, runtime `drawing_id`, ActiveDocument, or Job-local guesses. After mutation, re-read/verify the actual output. Finish a Reasoning Job run with `job_runtime_finish`.

#### B4. Implement missing capabilities only when required

If a planned step requires a capability that does not exist:

- use `write-lisp` when AutoLISP is the agreed executor;
- use existing CAD MCP/file capabilities when they fit;
- if a required primitive truly does not exist, surface that as an implementation blocker rather than silently redesigning the Job.

After a called Skill completes its own gate, return to the interrupted Job step.

#### B5. Real execution/test — mandatory

If the current work_handle is FILE-only and the approved test needs AutoCAD, call `cadgpt_work_upgrade` with that FILE handle plus the exact user-approved drawing name/full path, or `drawing_selector="CREATE_TEST"` for an isolated blank test drawing. The returned HYBRID handle supersedes the FILE handle; use only the new credentials afterward. Never call `drawing_*` or `cad__*` with a FILE handle and never default to ActiveDocument/first-open drawing.

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

#### B6. Refine loop

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

#### B7. Promotion gate

A reusable Job may be promoted to:

```text
Reasoning: appdata/libraries/jobs/<library-id>/<job-name>/JOB.md
Direct:    appdata/libraries/jobs/<library-id>/<job-name>/<job-name>.py
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

A Job step may invoke `write-lisp` when Lisp creation or repair is part of the approved implementation plan. For **dynamic reuse of an already-working Lisp**, the Job should normally seed and patch its own persisted derivative with `job_dynamic_lisp_prepare` / `job_dynamic_lisp_patch` instead of asking `write-lisp` to create an adapter or a fresh copy every run. `jobcreate` must not absorb unrelated AutoLISP-specific coding rules into the Job definition.

## Required supporting knowledge

Read as needed:

```text
knowledge/jobs/JOB_RULES.md
knowledge/jobs/LOCAL_COMPAT_UPDATE.md      only when local compatibility epoch changed
knowledge/drawing/DRAWING_ANCHOR.md      when the Job persists drawing-scoped metadata
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
