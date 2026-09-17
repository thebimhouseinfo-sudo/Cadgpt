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
2. a direct CAD MCP tool for small explicit CAD operations;
3. structured reasoning over retrieved CAD/file data when the step is a decision;
4. `write-lisp` when reusable AutoLISP must be created or patched;
5. file tools for managed AppData data/output work.

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
