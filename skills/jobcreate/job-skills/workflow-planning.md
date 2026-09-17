# JobCreate — Workflow Planning

Purpose: help `jobcreate` turn a user goal or partial skeleton into an agreed Job workflow without inventing business semantics.

## Planning sequence

```text
goal or existing Job
→ determine authoring mode
→ clarify outcome/boundary
→ agree skeleton
→ detail each step
→ map capabilities
→ define validation/test
→ present final plan
→ user approval
```

## New Job from goal only

Do not immediately write steps as final. First ask whether the user wants:

- `jobcreate` to propose a skeleton; or
- the user to provide the intended steps.

If `jobcreate` proposes a skeleton, present it as a proposal for discussion, not as a decided workflow.

## New Job from user skeleton

Treat the supplied skeleton as the starting contract. Ask only about gaps that materially affect execution, tool choice, outputs or validation.

Do not replace the user's sequence merely because another sequence appears cleaner.

## Refine existing Job

Load the current Job first. Establish:

- which step(s) are wrong, weak or incomplete;
- what the user wants changed;
- whether the change affects downstream steps or final validation.

Preserve all unaffected accepted behavior.

## Good planning questions

Questions should resolve concrete ambiguity, for example:

- What exact result should exist when this step is finished?
- Which property is authoritative if several properties could represent the same concept?
- Should this step modify the drawing or only inspect it?
- Is the existing registered Lisp the intended executor, or should CadGPT use a direct CAD tool?
- What should happen when no matching entity is found?

Avoid generic questionnaires that do not help determine the Job.

## Unresolved requirements

When information is genuinely missing, record it explicitly:

```text
UNRESOLVED
- authoritative source for grille width
- company rule for target Xref layer
```

An unresolved item may remain during early planning. It must be resolved or explicitly excluded before promotion if it affects required behavior.

## Skeleton quality

A useful skeleton contains meaningful workflow stages, not implementation noise.

Good:

```text
1. Discover candidate Xrefs
2. Validate source/status
3. Attach or update references
4. Normalize host-layer placement
5. Verify final Xref state
```

Too low-level for skeleton stage:

```text
1. Call function A
2. Read field B
3. Loop array C
```

Those details belong in step planning and implementation.
