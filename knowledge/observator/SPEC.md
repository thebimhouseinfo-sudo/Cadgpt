# Observator V1 Specification

## Purpose

Observator is CadGPT's generic CAD entity observation foundation and optional drawing-scoped AppData log writer. Drawing identity is shared CadGPT infrastructure defined outside Observator.

It is infrastructure for future Observation Jobs. This specification deliberately does not define any concrete Job such as create-system, numbering, tagging, or workflow recording.

## Core invariants

> Observator never needs to enumerate the whole drawing to discover what an Observation Job created.

> While an Observation Job is active, the CAD host records only the identity of database objects appended after Job start. Property inspection is deferred until Job finalization.

> At Job end, only surviving top-level drawing entities are candidates. Erased, undone, non-entity, block-definition, and nested objects are ignored.

> Candidate type is read before full properties. Jobs decide which object types are relevant and only relevant candidates receive deep property inspection.

> Observator reads direct properties only. V1 performs no nested entity traversal.

> The Drawing Anchor is the only CAD database object Observator may create or modify.

> A completed Observation Job writes/finalizes its AppData result, then updates the Drawing Anchor `last_revision` exactly once.

> `last_revision` is the revision carried by the opened DWG copy, not a global "latest wins" marker.

> Observation revision labels are hierarchical strings such as `12.01`, never floating-point numbers.

> Anchor state is independent of AutoCAD save state. Observator does not certify that the latest in-memory DWG or anchor update has been persisted to disk.

## Engine responsibilities

Observator V1 provides the following foundation capabilities:

1. Start and stop lightweight appended-object capture for the explicitly bound drawing.
2. During capture, retain only stable object identity needed for later resolution; do not inspect full properties.
3. At finalization, resolve only objects observed since Job start and reduce them to surviving top-level drawing entities.
4. Read lightweight candidate headers/type first.
5. Read complete direct properties for one or many Job-approved candidates.
6. Append caller-selected records to a drawing-scoped AppData JSONL log.
7. Resolve the Drawing Anchor for an observed drawing.
8. Lazily create the Drawing Anchor when Observator first needs persistent metadata for a drawing that has no anchor.
9. Update the Drawing Anchor `last_revision` once at successful Observation Job completion.

Single-object and multi-object property reads use the same engine contract. The only difference is the number of entity references supplied by the caller.

## Observation capture lifecycle

### Stage model

An Observation Job uses a small lifecycle:

```text
idle
→ capturing
→ finalizing
→ complete
```

The engine does not continuously inspect drawing content while `capturing`.

### Start

At Job start:

```text
Observation Job start
→ bind to the intended drawing
→ register a lightweight database append listener/reactor
→ initialize an in-memory candidate-id set
→ stage = capturing
```

The append listener records only identity such as object id/handle for newly appended database objects.

It must not:

- enumerate existing drawing entities;
- read full properties;
- recursively inspect blocks;
- infer business meaning;
- write Observation results merely because an append event fired.

The purpose of the listener is only to remember which database objects appeared after this Job started.

### During capture

While the user works manually in AutoCAD, many temporary objects may be created, deleted, undone, copied, or consumed while creating a block.

Observator does not need to interpret these intermediate steps.

Example:

```text
Job starts
→ user creates many lines/arcs/etc.
→ user deletes or redraws some of them
→ user selects the remaining geometry
→ user creates a temporary block
→ Job ends
```

The append listener may have seen many object ids during that process. That is acceptable because it stores identity only; no deep inspection has occurred.

### End / finalization

At Job end:

```text
stage = finalizing
→ detach/stop append listener
→ resolve only ids collected since Job start
→ discard objects that no longer survive
→ discard non-entity database objects
→ discard entities owned by block definitions / nested containers
→ retain only top-level ModelSpace/PaperSpace entities
→ read lightweight object type/header
→ Job applies its relevance predicate
→ deep-read direct properties only for relevant candidates
→ Job writes/finalizes its result
→ update Drawing Anchor last_revision once
→ stage = complete
```

The listener must be stopped before final candidate resolution so the candidate set has a clear boundary.

## No full-drawing scan

V1 must not use this pattern:

```text
Job start → snapshot every entity in drawing
Job end   → enumerate every entity again
           → diff two full-drawing sets
```

That design is forbidden because its cost scales with total drawing size.

Instead:

```text
cost of discovery ≈ objects appended during this Observation Job
```

A drawing may contain millions of pre-existing entities without making Observation finalization proportional to those millions.

If a Job sees 50 temporary allocations but the user finally creates one top-level BlockReference, final business processing may reduce to that one BlockReference after survivor/top-level filtering.

## Candidate survival and top-level rule

An object observed during capture is not automatically an Observation result.

At finalization a candidate is ignored when it is:

- erased or otherwise no longer resolvable;
- undone/unappended and not present in the final Job state;
- a non-entity database object;
- contained in a block definition;
- nested under another entity/container rather than present directly in ModelSpace or PaperSpace.

V1 observes final top-level drawing results, not construction history inside those results.

Therefore, when a user creates many entities and then turns them into one block, Observator does not traverse the block definition. The top-level BlockReference is the candidate visible to the Observation Job.

## Lightweight type gate before deep read

Finalization is two-stage:

```text
surviving top-level candidate
→ lightweight read: identity + ObjectName/object type (+ space when needed)
→ Job predicate
   ├─ irrelevant → stop
   └─ relevant   → full direct-property read
```

This keeps the expensive generic property reader away from irrelevant objects.

The exact business predicate belongs to the Observation Job, not Observator Engine.

## CAD host capture primitive

V1 requires the CAD host adapter to provide a drawing-scoped appended-object capture mechanism.

The mechanism may be implemented using a host-native database append reactor/event. It must satisfy this contract:

```text
start capture on bound drawing
→ receive append events locally inside AutoCAD
→ record stable object identities only
→ stop capture
→ return/resolve the captured candidate identities
```

The implementation must not simulate this capability by polling or repeatedly enumerating the whole drawing.

Exact CAD MCP tool names are implementation details until the capture primitive is coded.

## CAD property read boundary

The existing deep-read CAD MCP primitive is:

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

The capture finalizer must not call this full reader for every appended object. It first performs the lightweight type gate described above.

### No nested traversal

V1 does not traverse:

- block definitions;
- entities contained inside blocks;
- nested block references;
- child entity collections;
- referenced COM objects.

If a direct property value is itself a COM object, the reader returns only a shallow identifying summary when available. It does not recurse into that object.

## Drawing persistence boundary

Observator does not own Drawing Anchor, drawing identity, or drawing-folder lifecycle.

If a concrete Job using Observator capture needs persistent drawing-scoped metadata, that Job must first use the shared CadGPT Drawing Anchor contract:

```text
knowledge/drawing/DRAWING_ANCHOR.md
```

That shared primitive resolves or creates the stable `drawing_id` and the matching `AppData/drawings/<drawing_id>/` root. Observator may then be used only for its capture/read/log behavior as requested by the Job.

Observation-specific revision/branch semantics are not part of this V1 Observator capture contract and must not be stored in or inferred from the shared Drawing Anchor.

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

The engine does not choose which properties should be persisted. A Job may receive a complete direct snapshot for a relevant candidate and write only a small projection of it.

During the current foundation slice, the low-level logger may still receive `drawing_id` directly from its caller. A real Job requiring persistent drawing storage must resolve `drawing_id` through the shared Drawing Anchor helper instead of treating file path/name as drawing identity.

## Explicit non-responsibilities

Observator Engine does not define:

- which appended object types are relevant to a concrete Job;
- business predicates or filters;
- which properties a Job keeps;
- semantic meaning such as equipment, duct, fitting, grille, or system membership;
- UI workflow recording;
- mouse movement recording;
- command-line transcription;
- inference of the user's intermediate construction steps;
- nested/block-definition content inspection;
- AutoCAD save policy;
- verification that the current DWG state has been persisted to disk.

Those decisions belong to Job behavior or other runtime concerns.

## Read/write boundary

```text
AutoCAD database append events
        ↓ identity only
Observator capture
        ↓ at Job end
surviving top-level candidates
        ↓ type gate
Job relevance predicate
        ↓ selected handles only
Observator direct-property reader
        ↓
Job-selected AppData records

CAD mutation exception:
Observator has no ownership exception for Drawing Anchor.
```

## Future Job usage

A future Observation Job may conceptually do this:

```text
Job starts
→ Job resolves/creates shared Drawing Anchor
→ start appended-object capture

user works manually in AutoCAD
→ capture only remembers newly appended object identities

Job ends
→ stop capture
→ resolve surviving top-level entities only
→ lightweight type/header read
→ Job filters candidates
→ full direct-property read only for relevant candidates
→ allocate hierarchical revision with parent_revision = parent
→ Job writes/finalizes AppData result
→ Job completes
```

The business filtering, semantics, and persistence projection belong to the Observation Job. The capture mechanism and direct-property reader are generic Observator infrastructure.
