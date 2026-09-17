# Observator Engine

Implementation primitives for CadGPT Observator.

Current foundation:

- `engine.ts` bridges the explicitly bound drawing to CAD MCP Observation capture, lightweight candidate finalization, direct-property reads, and the generic log writer.
- `log-store.ts` appends caller-selected JSON records under `AppData/drawings/<drawing_id>/observator/`.
- CAD MCP exposes `cad_observation_capture_start`, `cad_observation_capture_status`, `cad_observation_capture_finish`, and `cad_observation_capture_cancel`.
- `cad_read_entity_properties` resolves requested handles directly with `HandleToObject`; it no longer enumerates ModelSpace/PaperSpace to find them.

The remaining major engine primitive is Drawing Anchor support.

## Implemented capture model

Observation discovery does not enumerate the whole drawing at Job start or Job end.

The CAD host uses the AutoCAD document `ObjectAdded` event while an Observation Job is active:

```text
Job start
→ register ObjectAdded listener on explicitly bound drawing
→ stage = capturing

ObjectAdded
→ store entity handle only
→ no full property read

Job end
→ stage = finalizing
→ stop listener
→ resolve captured handles only
→ discard no-longer-existing / erased / undone objects
→ discard block-definition/nested content
→ keep top-level ModelSpace/PaperSpace entities
→ return identity + ObjectName/type header
→ Job chooses relevant candidates
→ full direct-property read only for selected handles
```

The event listener runs on its own COM-initialized message-pump thread so it can remain active while the user works manually in AutoCAD between MCP calls. The event callback records only `Handle`; it does not perform interactive work or deep inspection.

The listener may see many temporary allocations. This is expected and cheap because capture stores identity only. Finalization is based on the final surviving state.

V1 never recursively inspects block contents. If the user creates many entities and then creates one block before ending the Job, final processing reduces to surviving top-level entities such as the final `BlockReference`; block-definition contents are ignored.

This gives the intended scaling property:

```text
Observation discovery cost
≈ objects appended during this Job
!= total entities in the drawing
```

## Validation status

Live AutoCAD validation is intentionally deferred to a later phase. The current foundation must not be described as live-verified yet.

The later validation phase must include at least this smoke path:

```text
bind an explicit test drawing
→ observator_capture_start
→ manually create several entities
→ delete/undo some temporary entities
→ optionally combine remaining geometry into one block
→ observator_capture_finish
→ verify only surviving top-level entities are returned
→ verify block-definition/nested entities are excluded
→ read full properties for selected returned handles
→ verify no full-drawing enumeration is required
```

Also validate cancellation, drawing mismatch protection, listener cleanup, and repeated start/finish cycles before treating the capture primitive as production-ready.

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
