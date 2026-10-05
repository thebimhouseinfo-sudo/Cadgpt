# JobCreate — Tool Mapping

Purpose: map each agreed Job step to constrained executors without changing the step's business meaning.

## Rule

Map tools only after the step intent is clear.

For each step define:

```text
preferred_tools
viable_tools
```

### Preferred tools

The first choice when available and valid for the step.

### Viable tools

Allowed alternatives that can satisfy the same step contract without changing semantics.

Do not list alternatives merely because they exist.

## Discovery first

Before naming an existing capability:

```text
registry_list / registry_search
→ registry_get
→ inspect source only if needed
```

For Jobs, use `job_list` / `job_get` when reusing or refining an existing Job.

Do not invent tool names, Lisp commands or Skills.

## Selection guidance

Prefer:

1. an existing registered capability that already matches the step;
2. when an existing working Lisp has variable data/sections, a **Job-owned dynamic derivative** seeded once from that real source and patched in place with `job_dynamic_lisp_prepare` / `job_dynamic_lisp_patch`;
3. a direct CAD MCP tool for small explicit CAD operations;
4. structured reasoning over retrieved CAD/file data when the step is a decision;
5. `write-lisp` when reusable/shared AutoLISP logic itself must be created or repaired;
6. file tools for managed AppData data/output work.

Do not create an adapter/wrapper merely to inject changing values into a working Lisp if the Job can safely replace the declared data/section in its persisted derivative while preserving the rest of the source.

The Job defines the required result; the executor is replaceable only when the alternative preserves that result and validation contract.

## Per-step scope

Expose only the tools needed for the step.

Bad:

```text
available_tools: all CadGPT tools
```

Good:

```text
preferred_tools:
- cad_read_entity_properties

viable_tools:
- registered Lisp: block.properties.inspect
```

## Tool uncertainty

If a desired primitive does not currently exist, mark it as an implementation requirement/blocker. Do not redesign the business workflow solely to work around an incomplete toolset unless the user agrees.

## Mutation awareness

For every mapped executor, record whether it:

- reads only;
- writes files;
- mutates the drawing;
- can be destructive;
- requires manual interaction.

This informs the implementation test and approval boundary.


## Independent post-CAD processing tail

Do not add Registry metadata for a background/backend Job and do not make CadGPT infer one.

When the agreed Job workflow has a tail that can continue only after all CAD-dependent data has already been collected:

1. keep the CAD-dependent work in the normal foreground Job flow;
2. resolve any required final `drawing_job_result_location` before handoff;
3. insert `job_system_acquire(id=<job-id>)` at the exact boundary where the remaining work is independent of CAD;
4. use the returned canonical `tool_id` (the Job id itself) for detached `file_*` processing;
5. guarantee `job_system_release(tool_id=<job-id>)` in the tail's completion/failure cleanup path.

Jobs without such an independent tail are unchanged. Do not add SYSTEM leasing merely because a Job uses file tools during its ordinary foreground execution.
