# Observator V1 Specification

## Purpose

Observator is CadGPT's generic CAD entity property reader, drawing-scoped AppData log writer, and owner of the minimal Drawing Anchor used to bind persistent metadata to a DWG.

It is infrastructure for future Observation Jobs. This specification deliberately does not define any concrete Job such as create-system, numbering, tagging, or workflow recording.

## Core invariants

> Observator reads complete direct properties of one or many CAD entities. Jobs decide what, when, and why to observe and persist.

> The Drawing Anchor is the only CAD entity Observator may create or modify.

> A completed Observation Job writes/finalizes its AppData result, then updates the Drawing Anchor exactly once.

> Anchor state is independent of AutoCAD save state. Observator does not certify that the latest in-memory DWG or anchor update has been persisted to disk.

## Engine responsibilities

Observator V1 provides the following foundation capabilities:

1. Read one or many CAD entities and return every directly discoverable, safely serializable property exposed by the CAD host adapter.
2. Append caller-selected records to a drawing-scoped AppData JSONL log.
3. Resolve the Drawing Anchor for an observed drawing.
4. Lazily create the Drawing Anchor when Observator first needs persistent metadata for a drawing that has no anchor.
5. Update the Drawing Anchor once at successful Observation Job completion.

Single-object and multi-object reads use the same engine contract. The only difference is the number of entity references supplied by the caller.

## CAD read boundary

The CAD MCP primitive is:

```text
cad_read_entity_properties(handles[], include_paper_space?)
```

It is read-only.

For each requested handle it returns:

- entity handle;
- object/class name when available;
- all direct readable COM properties discovered on that entity;
- any property getter failures as `unreadable_properties`;
- model/layout space;
- an explicit `nested_traversal: false` marker.

The reader is entity-generic. It is not limited to the entity classes recognized by the older structured entity mapper.

### No nested traversal

V1 does not traverse:

- block definitions;
- entities contained inside blocks;
- nested block references;
- child entity collections;
- referenced COM objects.

If a direct property value is itself a COM object, the reader returns only a shallow identifying summary when available. It does not recurse into that object.

## Drawing Anchor ownership

A normal DWG does not need a Drawing Anchor merely because it is opened by CadGPT.

The anchor is created **lazily** when Observator first needs persistent metadata for that drawing:

```text
Observation Job requires persistent drawing metadata
→ resolve Drawing Anchor
   ├─ found     → read stable drawing identity/job checkpoint
   └─ not found → create drawing identity
                  insert Drawing Anchor
                  create AppData drawing root
→ continue Observation Job
```

The Drawing Anchor belongs to Observator, not to a background lifecycle service.

Observator may mutate CAD only for its own anchor:

```text
allowed
  create Drawing Anchor
  update Drawing Anchor
  repair/normalize its own Drawing Anchor when explicitly required

not allowed
  create business/user geometry
  modify user entities
  move/delete user entities
  change user entity layer/properties
  tag/number drawing content
```

The physical anchor representation is intentionally not fixed by this specification yet. It must be an AutoCAD entity owned by Observator, but the exact representation/encoding remains open until implementation selection.

The anchor stores only minimal persistent identity/job-checkpoint information. Semantic system/member metadata remains external in AppData.

Logical anchor information includes at least:

```text
drawing_id
schema_version
last_completed_observation_revision
```

A completed timestamp may also be stored for diagnostics. Exact physical field names/encoding remain implementation details until the anchor representation is selected.

See `DRAWING_ANCHOR.md` for the full lifecycle and save/crash semantics.

## Observation Job completion boundary

Anchor update is part of the Observation Job completion path. It must not be delegated to application shutdown, AutoCAD save events, cache flushing, process cleanup, or an external background engine.

Canonical successful completion:

```text
1. Job performs its observation behavior.
2. Job writes/updates its AppData result/log.
3. Job finalizes that AppData result.
4. Observator updates the Drawing Anchor exactly once.
5. Job is complete.
```

This is an Observator lifecycle checkpoint only. It does **not** assert that AutoCAD has saved the drawing to disk.

No `Save()` operation is required by this contract.

## Reopen semantics

When a drawing is reopened, Observator trusts the anchor physically present in that DWG copy as the checkpoint associated with that copy.

AppData may contain later observation revisions. Observator must not automatically treat those later revisions as authoritative over the opened DWG because the user may intentionally be opening an older saved version.

Therefore:

```text
anchor revision in opened DWG
= checkpoint carried by this DWG copy

latest AppData revision
= later historical information that may exist

latest AppData revision != automatic replacement for anchor revision
```

Any future reconciliation behavior must preserve that distinction.

## AppData log boundary

Persistent Observator logs are drawing-scoped:

```text
appdata/
└─ drawings/
   └─ <drawing_id>/
      └─ observator/
         └─ <log_name>.jsonl
```

Each appended record receives only the minimal storage envelope:

```text
recorded_at
drawing_id
<caller supplied payload>
```

The engine does not choose which properties should be persisted. A future Job may read a complete entity snapshot and write only a small projection of it.

During the current foundation slice, the low-level logger may still receive `drawing_id` directly from its caller. Once the Drawing Anchor primitive is implemented, Observation Job orchestration must resolve `drawing_id` through the anchor instead of treating file path/name as drawing identity.

## Explicit non-responsibilities

Observator Engine does not define:

- which entities should be read;
- how a user selects one or many objects;
- whether an entity is new, modified, copied, or relevant;
- entity predicates or filters for a business workflow;
- which properties a Job keeps;
- semantic meaning such as equipment, duct, fitting, grille, or system membership;
- concrete Job start/stop behavior;
- business logic for Observation Jobs;
- mouse monitoring;
- command monitoring;
- command-line recording;
- UI interaction recording;
- workflow recording or workflow inference;
- AutoCAD save policy;
- verification that the current DWG state has been persisted to disk.

Those decisions belong to Job behavior or other runtime concerns.

## Read/write boundary

```text
CAD
 ↑ read normal entities
 │
 │  only mutation exception:
 │  create/update Drawing Anchor
 │
Observator Engine
 ↓ append caller-selected records
AppData/drawings/<drawing_id>/...
```

## Future Job usage

A future Observation Job may conceptually do this:

```text
Job starts
→ Observator resolves/creates Drawing Anchor
→ Job chooses entity references
→ Observator reads full direct property snapshots
→ Job evaluates/filter/selects properties
→ Job calls Observator logger with selected records
→ Job finalizes AppData result
→ Observator updates Drawing Anchor once
→ Job completes
```

The filtering, timing, semantics, entity relevance, and persistence projection in that example are Job behavior, not Observator Engine behavior.
