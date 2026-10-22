# Skill: jobcreate

Status: **active** — V5 authoring guidance.

Use the canonical contract in `knowledge/jobs/JOB_RULES.md`. A request to perform a task is not a request to create a permanent Job. Prefer an existing tool/command or a Temp Job for one-off work. Enter Builder only when the user requests creation or modification of reusable source.

## Intent and business semantics

Preserve supplied steps, naming rules, authoritative properties, mappings and thresholds. Ask only for missing business decisions that affect the result. Do not invent domain rules or add a universal PLAN/APPROVE/TEST/PROMOTE ceremony. Reasoning may decompose the actual requested workflow, select available tools and define its concrete success conditions.

For an existing Job, read its current managed source and diagnose the relevant failure before patching. Existing registered Python Jobs remain runnable through their compatibility adapter; do not rewrite them merely to match a template.

## Source ownership

Reusable Job source lives directly in `appdata/libraries/jobs/<library-id>/<folder>/**`. `runtime/**` is working/recovery state, not published source. Persistent drawing results belong under the verified Drawing Anchor and the Job's own result folder. External import locations and bundled Internal Jobs remain read-only.

Use `v5_source_create` and `v5_source_update` in explicit Builder Work. Revision checks are internal; an earlier-read SHA may be supplied, but never ask the Human for one. The same logical session may continue its newly created, unpublished package after a Work ends. Saved/imported source needs the user's exact `cg/update <target>` authorization. A missing Registry entry does not prove that source is new. Do not use generic file writes to bypass source guards.

A canonical reusable package contains `JOB.md` and optional owned `lisp/`, `tools/`, data and runtime assets. Read the current Job contract for metadata, step and runtime requirements. Execute source through its supported source-path entrypoint without requiring registration first. Publish only when requested using `v5_source_publish`; publication is distinct from source edits and ends new-source continuation for the indexed packages.

## Runtime and verification

Use the bound drawing identity, owned runtime and real tool outputs. File-only processing must not activate CAD. CAD mutations require the verified CAD tools and bound Save. On an error, stop/report the actual partial state; do not invent evidence or automatically retry an uncertain mutation. Static tests and mocks do not establish native AutoCAD success. If the host is unavailable, report that limitation while retaining the repairable source.

## Compatibility

`job_local_compat_status` is optional diagnosis. Its epoch/pending warnings never block normal authoring or RUN. Analyze only relevant packages when compatibility analysis is requested; preserve accepted business behavior. Legacy draft/checkout/promote implementations are internal compatibility code, not public MCP tools or a required lifecycle. For new callers use the V5 source APIs.

See `harness/README.md` and `knowledge/jobs/JOB_RULES.md` for operation boundaries.
