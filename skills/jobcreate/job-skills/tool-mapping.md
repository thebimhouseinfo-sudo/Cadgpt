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

Choose by suitability and total end-to-end cost, not a mandatory hierarchy. Reuse an existing matching capability; use Direct Tools/Macro for small operations, or CAD-local Lisp/Engine bulk processing when that reduces round trips. Do not create permanent source unless reusable authoring was requested.

Dynamic Lisp uses stable Engine plus per-run Data. The Job may generate Lisp, JSON or another format its Engine actually consumes inside the owning runtime. Do not rewrite Engine sections or seed/patch persisted source as ordinary per-drawing input. `job_dynamic_lisp_prepare` / `job_dynamic_lisp_patch` are legacy source-maintenance adapters; actual source writes require exact Human `cg/update` for the selected Job. Normal Data creation does not require that command.

Builder may nominate a new method when authoring; Operator chooses only among the real Job's permitted executors and decisions. Preserve its business meaning.

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

File analysis and output processing may proceed independently once required CAD data has been collected. Ordinary foreground `file_*` and `job_system_run_helper` use the prepared Job Work; do not add manual SYSTEM acquire/release merely because a Job processes files. Retain legacy detached leases only where an existing explicitly designed detached tail needs them, including its real completion/failure cleanup. Resolve any persistent result location against the verified Drawing Anchor before use; never invent a drawing owner.
