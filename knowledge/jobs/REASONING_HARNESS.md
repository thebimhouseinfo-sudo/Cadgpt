# Reasoning Job Harness

Markdown Jobs are sequential reasoning workflows. The Job file defines the workflow order; the current drawing state determines the concrete action at each step.

Before a normal User Reasoning Job starts, call `job_local_compat_status`. If it returns `update_required=true`, do not start the normal Job yet: route through `jobcreate` **CONTRACT UPDATE** mode, complete/report the local scan, then mark the compatibility epoch checked. When the status is already current, this check is only the small state comparison; do not inspect all Job packages.

At the start of every actual Reasoning Job run, call `job_runtime_prepare(id=<registered-job-id>)` before any file mutation. Starting a Job automatically releases stale foreground/SYSTEM Job authority from the same logical chat, but it does not delete prior runtime bytes. Use the returned `runtime_root` for all raw/intermediate working data. If `recovery_pending=true`, drain/verify/delete the preserved pending work before or as part of the new run according to the Job contract.

## Storage rule for Reasoning Job steps

After `job_runtime_prepare`, use only its `runtime_root` for collected raw,
CSV/JSON, collector output, Job Steps and intermediate processing. For
final persistent output call `drawing_job_result_location` and write only
to that Job's returned `jobs/<job-name>-result/**` directory under the
verified Drawing Anchor. Never use the entire Drawing Anchor, another
Job's runtime/result, or a general workspace/data root as a writable
fallback. Authorized external inputs/other Job results may be read
but must not be edited, deleted or overwritten. If a step needs to transform
such input, copy it into the current Job's runtime first. On a denied
write report the original permission error; do not enable Human Power or
change Job tool family to bypass the boundary. The restrictions survive
`job_runtime_finish` until the parent Work ends. This is a Reasoning
Job FILE/SYSTEM data rule, not a change to the Direct Job executor.

A Reasoning Job may use an internal helper (including LISP) belonging to another **existing** Job. The helper still writes to its owner's built-in paths; its produced files remain owned by the helper's Job. The borrower may read authorized outputs, but must not edit/delete them or treat them as its own files. The borrower's own outputs stay in its own runtime/result. Do not copy or re-register the borrowed helper.

## Run-start source and routing discipline

The permanent managed `JOB.md` is the **only current workflow definition**.
Each invocation starts with `job_runtime_prepare`, which returns the
`workflow.source_sha256` and freshly read `workflow.content`.
Follow those returned bytes, not a prior assistant summary, the chat history,
a remembered stage number, or instructions that were only discussed but were
never promoted to the managed Job package. The Work being HYBRID grants tool
availability, not permission to skip Job branching.

Before executing a conditional branch, inspect the **actual input condition**
named by this Job's entry step, using managed file/CAD read tools. A Job may
check raw files, final result files, or both; do not substitute one for another.
A `recovery_pending` flag is only a hint that scratch exists, never proof
that the Job's own raw-data condition is true. If the check fails, STOP rather
than assume empty/nonempty. Follow the exact branch in current `JOB.md`.

When a Job step requires a choice, ask only those choices valid for that
observed condition; wait for an explicit answer. Never reuse a choice from a
previous invocation. After a choice, execute its specified action and stopping
point. A load-only choice loads the declared Lisp and **stops** even if the
general Job definition contains additional stages. A failed tool must not be
reported as successful or bypassed by switching branches.

On a new invocation, repeat entry checks. Only carry unfinished raw/results
forward under the Job's explicit recovery instructions; neither old choices
nor model-inferred routes are persistent workflow state. If the returned
`workflow.content` conflicts with the user's latest requested change, report
the unpromoted Job definition and route that requested change to `jobcreate`;
do not silently treat the chat instruction as a permanent edit.

## Job Steps (per-Job runtime checklist)

Custom Reasoning Jobs stay plain Markdown. The promoted `JOB.md` remains
the immutable workflow contract. Each Job has one ephemeral checklist at
`<job-root>/runtime/JOB_STEPS.md`, returned as `job_steps.path` by
`job_runtime_prepare`. Use existing managed file tools; no new Job tool,
parser, checkpoint engine, or global controller.

On each new run, freshly read `workflow.content`, inspect the actual entry
condition, and create/reconcile `JOB_STEPS.md` to that workflow and the
currently selected branch. The file contains a short header with Job ID,
`workflow.source_sha256`, drawing identity if applicable, and the actual
observed entry condition. Use an ordered checklist with only:
`- [ ]` pending, `- [✓]` verified successful, `- [✗]` failed.
Ask explicit user choices only when the current Job step requires them.
Do not invent a choice from old chat history or auto-expand unselected branches.

Work on one required step at a time. Check the tool's actual success/failure
result and perform separate readback **only when required by the promoted Job step
or mandatory platform/storage safety**. Do not add a CAD scan or readback simply
because an action modified something. Mark that step `[✓]` with `file_edit`
using the current checklist hash only after the required step succeeded.
A CAD tool that returns `loaded=false` is a FAILURE even
when transport succeeded; Load Lisp PASS requires `loaded=true`.
On failure, mark `[✗]`, notify the user immediately, and stop instead
of advancing. A `[ ]` or `[✗]` required step blocks the next
step; neither sending a tool call nor a model assertion counts as PASS.

**User-visible step reporting is mandatory**: after each meaningful Job step,
report `✓ Job / Step name — verified result` concisely. On any failure,
report `✗ Job / Step name — FAILED` with the actual tool/error code, original
message, relevant LISP/file path and CAD log excerpt if present, plus which
steps were NOT executed and whether raw/result/CAD data were changed.
Never replace the source error with a vague "blocked" statement.
If the error originates from CadGPT source, path-policy, bridge, CAD MCP or
tool authority, call it a **CadGPT platform/source failure**, not a user
workflow mistake. If origin is not confirmed, say "origin not established"
and retain the original error rather than guessing.
When the Job tool itself is broken, do not silently call another lower-level
tool, switch branches, enable Human Power or fabricate success. Surface the
fault so CadGPT source can be repaired and re-tested before re-execution.
Preserve failure information in the user-visible response BEFORE the runtime
resets Job Steps on finish/switch.

On Job success, error/stop, or replacement by a new Job, the CadGPT runtime
restores ✓/✗ markers to `[ ]` in that Job's `runtime/JOB_STEPS.md`.
After a terminal failure, first record the failed step and its actual error in the
user-facing report, then invoke `job_runtime_finish` (foreground) so the list
is restored; for detached SYSTEM work invoke `job_system_release` instead.
Do not finish during an ordinary user-choice pause; keep that run available
until user replies. An intentional "load Lisp then wait for new raw" stop point
may finish the current invocation after load verification, without completing
any unexecuted Job stages.
It never deletes the checklist, actual raw data, results, or metadata.
Driver-crash recovery also resets progress marks at the next run's prepare,
then rechecks evidence before repeating any potentially mutating step.
Repeated prepare for the SAME active Job preserves its current marks.
Always reconcile an older checklist against the fresh JOB.md SHA, real raw/
result content, and current branch before using it. A load-Lisp-then-wait
choice is an intentional stop for that invocation, not a declaration that
other Job stages have completed.

## Runtime execution — established Custom Jobs

For an **already promoted Reasoning Job**, the current `JOB.md` and its
observed entry condition define the entire sequence of actions. This section
and `knowledge/cad/WORKFLOW_EXECUTION_HARNESS.md` are consistent:

1. Read the current promoted workflow, inspect only its stated entry condition,
   and select its required branch. Follow the branch's exact steps and pauses.
2. Execute the next **required** action and check the result reported by the
   tool. A tool that reports failure or `loaded=false` is not successful.
3. Perform a separate readback, review or CAD state inspection **only if** that
   selected Job step specifically requires it, or the invoked platform/tool
   enforces it for safety. No generic PLAN→REVIEW→READBACK loop is added.
4. Record the result in the Job Steps checklist and report it, without inventing
   workflow stages. When the Job says "load Lisp, then wait", load and stop.
5. Stop at the selected branch's end or first actual failure. Never switch
   branches to disguise a failure; retain original error evidence.

For **Job Builder / authoring** (designing or editing a workflow rather than
executing a promoted Job), normal READ→PLAN→REVIEW→REVISE→IMPLEMENT→TEST
reasoning applies. That authoring loop is *not* automatically run inside
the steps of an established Custom Job. Temp tasks use the separate
one-approval Orchestrator routing policy, not this Job lifecycle.

Additional required platform/storage rules:

- Use the actual Drawing Binding and required live CAD checks whenever the
  Job step needs live drawing state; stored metadata is not live CAD evidence.
- When a Job needs a final persistent drawing result, call
  `drawing_job_result_location` and write only under its returned
  `jobs/<job-name>-result` location. Never guess the drawing root.
- Call `job_runtime_finish` when the Reasoning Job ends. It does not delete
  nonempty runtime bytes; processed raw items require explicit deletion.
- For a Job-owned raw item that the selected workflow actually deletes, first
  persist the durable result and verify it, then delete that raw by its hash.
  This is a storage safety prerequisite for deletion, not a general instruction
  to audit every CAD mutation.
- An independent post-CAD processing tail uses `job_system_acquire` and
  `job_system_release` **only when the current Job explicitly includes that
  tail**. Never detach a Job or borrow SYSTEM authority on speculation.
- Reuse existing dynamic Lisp through `job_dynamic_lisp_prepare` and patch
  only the declared data according to the selected Job step.
- Ask the user only when the selected branch requires a decision or
  an actual conflict cannot be resolved safely within existing authorization.

## DWG save checkpoint at CAD-to-SYSTEM boundary

For a promoted Job whose current workflow contains a DWG-mutating phase, execute its declared save checkpoint **immediately after the last confirmed DWG mutation in that phase**, before leaving CAD for independent analysis or SYSTEM-only processing, even while later Job steps remain pending. Save the exact execution-bound drawing via a verified available tool, record tool-confirmed success in the Job runtime, and only then proceed/release CAD authority. Do not wait for the final Job DONE/header transition. If a subsequent phase mutates DWG, its own save checkpoint is required. On save failure, stop with the original tool error and preserve resume evidence; do not replay the preceding mutation automatically.

On resume, validate the prior drawing identity plus durable save receipt and underlying mutation evidence before skipping completed CAD work. An uncertain crash-time save is not a license to repeat non-idempotent Lisp; report the unresolved state. FILE-only or read-only Jobs do not save a DWG. If the promoted JOB.md does not yet contain this checkpoint, the executor must not silently invent unsupported tools or mutate the permanent Job; route the missing contract to Job Builder.

## Direct Jobs

A `.py` Job is not processed by this harness. It is a direct Job: resolve the registered script and dispatch it through the direct Job runner without model planning between its internal operations.

The Direct Job runner performs the same ownership setup automatically: it resets `<job-root>/runtime`, runs the child with that directory as CWD, supplies `CADGPT_JOB_RUNTIME_ROOT`, and when a drawing is bound supplies `CADGPT_JOB_RESULT_ROOT` for `<drawing-root>/jobs/<job-name>-result`. Empty Job result namespaces are cleaned when the Job runtime finishes.


## Human Power

Human Power is not part of the Job workflow and is not a Job PASS condition.

If the Job is blocked by a defect or inappropriate CadGPT platform gate, the human may explicitly activate `human_power_start` for the **current work execution only**. CadGPT may then repair the platform/runtime and continue the same task without turning the Job into a permanent bypass variant.

When the task is finished, call `human_power_stop` when practical. Work stop/release/expiry/replacement also removes the grant automatically.

If Human Power changes CadGPT source, the mutation must include a fix summary and is written to the Human Power error log together with the error/expected behavior recorded at activation.
