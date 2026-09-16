# Coding Skill: Selection and Batch Operations

Purpose: write reliable AutoLISP for the high-volume drawing cleanup, conversion, mapping, and takeoff work CadGPT actually performs.

## Selection first

Prefer narrowing the candidate set before mutation.

Use `ssget` filters when entity type, layer, block name, or other DXF-supported criteria can be expressed directly. Avoid scanning every entity in the drawing and filtering in Lisp unless native selection cannot express the rule.

Typical shape:

```lisp
(setq ss (ssget "_X" '((0 . "LINE,ARC,*POLYLINE") (8 . "TARGET-LAYER"))))
```

Build filters from validated variables rather than concatenating arbitrary user strings into command calls.

## Layer + object-type rules

For cleanup and conversion, treat the pair `(layer, entity type)` as first-class evidence. Do not assume every object on a layer should receive the same action when mixed entity types exist.

Prefer:

```text
A-HATCH + HATCH   -> action
A-WIPE  + WIPEOUT -> action
```

over blanket rules such as “delete all objects on A-HATCH” unless the workflow explicitly requires it.

## Iteration

For selection sets:

```lisp
(setq i 0)
(repeat (sslength ss)
  (setq en (ssname ss i))
  ;; process en
  (setq i (1+ i))
)
```

When deleting entities during iteration, avoid index patterns that become invalid as the underlying collection changes. Selection sets are usually safer than iterating mutable COM collections forward while deleting.

## Classification before mutation

For complex bulk work, prefer two phases:

1. collect/classify candidate handles or enames;
2. execute the mutation on the frozen candidate set.

This reduces accidental scope drift and makes counts verifiable.

## Reporting

Batch commands should report useful aggregate evidence:

- scanned count;
- matched count;
- changed/deleted/created count;
- skipped count;
- error count;
- unresolved/unmapped count where relevant.

Avoid printing one line per object for hundreds or thousands of entities unless diagnostics explicitly require it.

## Performance rules specific to AutoLISP

- Filter early with AutoCAD selection APIs.
- Reuse document/layer/block collection references inside loops instead of repeatedly reacquiring them.
- Avoid repeated `command` calls per entity when DXF/VLA operations can perform the same change directly.
- Avoid repeated full-drawing searches inside an entity loop; build lookup data once.
- For nearby-entity inference, bound the search region and cache stable lookup information when practical.

These are CAD batch-operation rules, not generic application performance optimization.
