# Observator V1 Specification

## Purpose

Observator is CadGPT's generic CAD entity property reader and per-drawing log writer.

It is infrastructure for future Observation Jobs. This specification deliberately does not define any concrete Job such as create-system, numbering, tagging, or workflow recording.

## Core invariant

> Observator reads complete direct properties of one or many CAD entities. Jobs decide what, when, and why to observe and persist.

## Engine responsibilities

Observator V1 provides exactly two foundation capabilities:

1. Read one or many CAD entities and return every directly discoverable, safely serializable property exposed by the CAD host adapter.
2. Append caller-selected records to a drawing-scoped AppData JSONL log.

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

The current V1 logger receives `drawing_id` from its caller. The future drawing-identity/anchor mechanism is responsible for resolving a reopened DWG to that stable `drawing_id`; it is intentionally outside this engine slice.

## Explicit non-responsibilities

Observator Engine does not define:

- which entities should be read;
- how a user selects one or many objects;
- whether an entity is new, modified, copied, or relevant;
- entity predicates or filters for a business workflow;
- which properties a Job keeps;
- semantic meaning such as equipment, duct, fitting, grille, or system membership;
- Job start/stop behavior;
- Observation Job lifecycle;
- CAD mutation;
- mouse monitoring;
- command monitoring;
- command-line recording;
- UI interaction recording;
- workflow recording or workflow inference.

Those decisions belong to Job behavior or other future runtime components.

## Read/write boundary

```text
CAD
 ↑ read only
Observator Engine
 ↓ append caller-selected records
AppData/drawings/<drawing_id>/...
```

Observator itself never mutates the DWG.

## Future Job usage

A future Observation Job may conceptually do this:

```text
Job chooses entity references
→ Observator reads full direct property snapshots
→ Job evaluates/filter/selects properties
→ Job calls Observator logger with selected records
```

The filtering, timing, semantics, and persistence projection in that example are Job behavior, not Observator Engine behavior.
