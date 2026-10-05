# Local Custom Job Compatibility Update

This file is the repair instruction carried by the current `JOB_LOCAL_COMPAT_EPOCH`. It is read only when the lightweight compatibility signal reports a mismatch. It is not a migration engine and it does not enumerate AppData by itself.

## Current signal

```text
JOB_LOCAL_COMPAT_EPOCH = 1
```

Epoch 1 exists because the Job storage/runtime contract changed in ways that can make already-installed local Custom Jobs non-compliant.

## Target discovery

The online/source side does not know which Custom Jobs exist on a user's machine.

When this epoch is pending, `jobcreate` CONTRACT UPDATE must:

1. call `job_list`;
2. select User Registry Jobs only;
3. call `job_get` for each selected User Job;
4. inspect that Job's real managed package/source;
5. classify it as `UNCHANGED`, `AFFECTED`, or `BLOCKED/REVIEW_REQUIRED`.

Do not deep-read Job packages before the epoch mismatch is known.

## Epoch 1 detectors

Mark a Job `AFFECTED` only when the real local Job shows one or more of these conditions:

- raw/intermediate working data is intentionally written beside permanent Job source/assets, to a shared run-data/history location, or directly into the drawing root;
- a Reasoning Job writes working data but does not use the Job-owned runtime boundary;
- a Job publishes final drawing-scoped output outside its own `jobs/<job-name>-result/` namespace;
- a Direct Job hard-codes a working/result path that conflicts with `CADGPT_JOB_RUNTIME_ROOT` / `CADGPT_JOB_RESULT_ROOT`;
- a Direct Job relied on the old process CWD to resolve permanent package-relative assets such as `tools/**`, `lisp/**` or `dynamic-lisp/**`;
- a private helper owned only by that Job sits outside the Job package or is treated as a shared Registry capability solely because the old Job bundle could not preserve it;
- a private non-Lisp helper belongs to the Job but is not owned under `<job-root>/tools/**`.

Do **not** classify a Job as affected merely because it has `dynamic-lisp/**`; that directory is persistent executable state and remains valid.

Do **not** remove a global Registry capability when ownership is ambiguous or another Job may depend on it. Classify that external cleanup as `REVIEW_REQUIRED` and report it.

## Epoch 1 repair rules

For each affected Job, preserve business/workflow semantics and make only the compatibility correction:

- raw/intermediate data -> `<job-root>/runtime/**`;
- Reasoning execution -> prepare the Job runtime before working-data mutation and finish/re-check at the end;
- final drawing result -> use `drawing_job_result_location`, never construct the drawing root;
- Direct Job working files -> prefer relative paths / `CADGPT_JOB_RUNTIME_ROOT`;
- Direct Job permanent package assets -> resolve from `CADGPT_JOB_ROOT` instead of the process CWD;
- Direct Job final drawing products -> `CADGPT_JOB_RESULT_ROOT` when supplied;
- Job-private AutoLISP -> `<job-root>/lisp/**`;
- other Job-private helper/scripts/assets -> `<job-root>/tools/**`;
- leave `dynamic-lisp/**` persistent and unchanged except for its normal declared dynamic sections.

Use the ordinary controlled lifecycle:

```text
job_get
→ job_checkout
→ narrow draft patch
→ job_draft_validate
→ real affected-path test
→ post-mutation re-check
→ job_promote_draft when normal authority permits
```

The updater has no additional authority. Never enable Human Power, bypass a gate, rewrite platform policy, or invent a business rule to make a migration pass.

If a gate prevents an external registration/removal/re-registration action, finish and validate every safe local change that is permitted, then report the remaining external action instead of bypassing the gate.

## Validation

For every changed Job, re-check at minimum:

- entrypoint still validates and its original business semantics are preserved;
- private helpers resolve from the owning Job package;
- `tools/**` / `lisp/**` / `dynamic-lisp/**` ownership is correct;
- `runtime/**` is scratch and is not part of permanent bundle/hash/promotion;
- raw/intermediate data does not publish into drawing storage;
- final drawing output, when present, goes only to the tool-returned `jobs/<job-name>-result/`;
- the affected real execution path still passes.

## Report

Produce one concise scan report with this shape:

```text
CadGPT Job Contract Update — epoch 1

Scanned:
Affected:
Updated:
Unchanged:
Blocked / review required:

Job: <id>
Detected:
- <violation>

Local changes:
- <change or NO CHANGE>

Validation:
PASS | FAILED | NOT RUN

Pending external action:
- <exact gate/action, or NONE>
```

After all User Jobs have been inspected, call `job_local_compat_mark_checked` with the scan count, report summary and all pending external actions. Pending actions remain visible but do not cause the full local scan to repeat on every later Job call.
