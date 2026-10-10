# Local Custom Job Compatibility Update

This file is the repair instruction carried by the current `JOB_LOCAL_COMPAT_EPOCH`. It is read only when the lightweight compatibility signal reports a mismatch. It is not a migration engine and it does not enumerate AppData by itself.

## Current signal

```text
JOB_LOCAL_COMPAT_EPOCH = 2
```

Epoch 1 exists because the Job storage/runtime contract changed in ways that can make already-installed local Custom Jobs non-compliant.

Epoch 2 (2026-10-10) is a **behavior/compatibility update**, not a general
Job-format migration: Jobs now default to HYBRID Work, a Reasoning Job reads
its current promoted `JOB.md` on every run, maintains `runtime/JOB_STEPS.md`
with verified step PASS/FAIL, and reports actual tool/source failures to users.
An unchanged local Job may still be compatible; each installed Job must be
inspected against the new execution behavior before the marker is checked.
The source fingerprint in the compatibility status also detects future edits
to the three versioned Job behavior documents without rescanning AppData
until a mismatch is seen. A source implementation change which alters Job
behavior **must update these source-owned contracts**; do not hide new
behavior in runtime code while leaving the versioned contract unchanged.

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

## Epoch 2 behavior detectors (all registered Custom Jobs)

Use the CURRENT promoted `JOB.md` returned by `job_get`, not old chat
summaries, previous Job Steps, or a locally remembered script. Inspect
every User Registry Job (including its relevant private Lisp/helpers) for:

- Entry conditions that are missing, reversed, or read from an unrelated
  result folder. The actual input check (e.g. raw empty/nonempty) MUST be
  performed before tools belonging to the selected branch; being a
  `HYBRID` Job does not justify eagerly loading CAD Lisp.
- Conditional choices that differ from the most recently *approved and
  promoted* Job contract, including Update/Skip and Load Lisp/Check raw,
  the exact stopping point of a load-only choice, and the behavior of Skip.
  Do NOT infer or silently change user business rules; report conflicts
  and ask the user how to update the Job.
- Reasoning step success criteria that mark PASS just because a tool was
  called, do not verify postconditions (Load Lisp requires `loaded=true`),
  or permit advancing after a required step failed.
- Missing per-Job `runtime/JOB_STEPS.md` discipline: use the supplied
  `job_steps.path`, check off ONLY evidence-backed steps and report each
  meaningful step/actual platform error to the user. On terminal finish,
  failure, or Job switch, the runtime resets just ✓/✗ marks, not raw/data.
- Outdated FILE-only/CAD-only Work assumptions: the default Job execution
  path is HYBRID. A true non-HYBRID exception must be deliberate, not a
  guess based on the first tool. CAD operations still require a valid
  drawing binding, tool authority, and path gate.
- Any Job that says to work around a failed CadGPT loader, suppress the
  original LISP source/CAD MCP error, bypass policy, or silently continue.
  Report the original error and stop for source repair instead.

- A **Reasoning** Job that collects raw data outside its *own*
  `<job-root>/runtime/**`, writes final output outside its exact
  `drawing_job_result_location` returned
  `drawings/<anchor>/jobs/<job-name>-result/**`, or edits an authorized
  external input / another Job's runtime or result. Such a Job is AFFECTED
  and needs a narrow user-reviewed source fix, not a broad filesystem
  permission exception. Test both allowed destinations and rejection of
  another Job's runtime/result, generic workspace/data and Drawing Anchor
  parent. A read-only dependency on another folder is allowed and should
  remain readable under its original authorization. **Do not migrate
  Direct Python Jobs solely for this Reasoning file-output rule.**

**Concrete Grille Tag regression scenario** (use ONLY when the examined
Job is `grille-tag`, preserving the user's approved contract):
`check actual raw -> empty: Stage 1 -> Stage 2 -> Stage 3;
nonempty: ask Update/Skip; Update: ask Load Lisp/Check raw;
Skip: Check raw; Load Lisp: load then report and STOP until a new user request`.
The raw check precedes any branch-specific Lisp loading. The update/skip
choice is never copied from a prior run. If local `JOB.md` has a different
route, classify AFFECTED and request user confirmation to patch through
jobcreate instead of replacing its instructions silently.

**Action/gate**: At activation, show that the contract changed and
`jobcreate` must scan local Jobs. Inspect and report
UNCHANGED / AFFECTED / BLOCKED for every registered User Job. Before
changing an AFFECTED Job's business flow, display the proposed narrow
change and get user acceptance. Use job_checkout -> patch -> validate ->
real affected-path test -> user approval -> job_promote_draft. If human
testing is unavailable, mark NOT TESTED / BLOCKED, do NOT claim the
local Job was updated. The compatibility scan report must be given to
the user, including pending work and the fact that affected/unpromoted
Jobs may still follow their old behavior.

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
CadGPT Job Contract Update — epoch 2

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

After all registered User Jobs have been inspected, show the report to
the user, then call `job_local_compat_mark_checked` with the **actual number
of registered User Jobs examined**, report summary, all pending actions,
and `blocked_job_ids`: the exact registered IDs of affected Jobs whose
changes have NOT been accepted, tested, or promoted. The tool rejects
a scan count inconsistent with the registry and unknown blocked IDs.
A Job in `blocked_job_ids` stays non-executable until the updater
completes its repairs and the marker is rechecked with that ID removed.
Unaffected Jobs remain usable after the initial compatibility scan.
Pending/unpromoted user changes must be clearly reported as pending,
not described as already applied; they remain visible at subsequent CadGPT
launches even if the completed compatibility scan itself does not repeat.
Do not mark the epoch checked before enumeration/inspection has occurred.
Do not mark an unpromoted Job as already repaired merely to make it runnable.
