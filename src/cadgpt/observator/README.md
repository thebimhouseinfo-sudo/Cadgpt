# Observator Engine

Implementation primitives for CadGPT Observator.

Current foundation:

- `engine.ts` bridges the explicitly bound CAD drawing to the CAD MCP direct-property reader and exposes the generic log writer.
- `log-store.ts` appends caller-selected JSON records under `AppData/drawings/<drawing_id>/observator/`.

The next engine primitives are:

1. Drawing Anchor support;
2. drawing-scoped appended-object capture for Observation Jobs;
3. lightweight candidate type/header resolution before full direct-property reads.

## Required capture model

Observation discovery must not enumerate the whole drawing at Job start or Job end.

The CAD host should use a database append event/reactor while an Observation Job is active:

```text
Job start
→ register append listener on explicitly bound drawing
→ stage = capturing

append event
→ store object identity only
→ no full property read

Job end
→ stage = finalizing
→ stop listener
→ resolve captured identities only
→ discard no-longer-existing / erased / undone objects
→ discard non-entity and block-definition/nested content
→ keep top-level ModelSpace/PaperSpace entities
→ read lightweight object type/header
→ Job chooses relevant candidates
→ full direct-property read only for selected candidates
```

The listener may see many temporary allocations. This is expected and cheap because capture stores identity only. Finalization is based on the final surviving state.

V1 never recursively inspects block contents. If the user creates many entities and then creates one block before ending the Job, final processing should reduce to the surviving top-level `BlockReference`; block-definition contents are ignored.

This gives the intended scaling property:

```text
Observation discovery cost
≈ objects appended during this Job
!= total entities in the drawing
```

The capture primitive must be implemented inside the CAD host boundary using a native database append event/reactor or equivalent. It must not be emulated by periodic/full-drawing polling.

## Drawing Anchor boundary

The anchor is created lazily when Observator first needs metadata for a drawing, and it is the only CAD database object Observator may create or modify.

A successful Observation Job follows this boundary:

```text
Job finalizes candidate inspection and AppData result
→ Observator updates Drawing Anchor exactly once
→ Job completes
```

The anchor update records the Observation Job checkpoint carried by the current DWG state. It is not a save operation and does not certify that AutoCAD persisted the current drawing to disk.

Anchor update is not a shutdown/save/cache-flush task and must not be delegated to an external background engine.

No concrete Observation Job lives here. Job-specific type filters, property projection, semantics, relevance rules, and lifecycle intent belong to Job Runtime.

Normative design contracts:

- `knowledge/observator/SPEC.md`
- `knowledge/observator/DRAWING_ANCHOR.md`
