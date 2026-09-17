# Observator V1 Specification

## Purpose

Observator is CadGPT's generic CAD entity observation foundation, drawing-scoped AppData log writer, and owner of the minimal Drawing Anchor used to bind persistent metadata to a DWG.

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

## Drawing Anchor ownership

A normal DWG does not need a Drawing Anchor merely because it is opened by CadGPT.

The anchor is created lazily when Observator first needs persistent metadata for that drawing:

```text
Observation Job requires persistent drawing metadata
→ resolve Drawing Anchor
   ├─ found     → read drawing identity + revision carried by this DWG copy
   └─ not found → build drawing_id from current drawing name + local creation time/date timestamp
                  initialize last_revision
                  insert Drawing Anchor
                  create AppData drawing root
→ continue Observation Job
```

The Drawing Anchor belongs to Observator, not to a background lifecycle service.

Observator may mutate CAD only for its own anchor:

```text
allowed
  create Drawing Anchor
  update Drawing Anchor last_revision
  repair/normalize its own Drawing Anchor when explicitly required

not allowed
  create business/user geometry
  modify user entities
  move/delete user entities
  change user entity layer/properties
  tag/number drawing content
```

The anchor stores only two logical fields:

```text
drawing_id
last_revision
```

Field semantics:

- `drawing_id` — stable unique id generated by CadGPT and used as the AppData key. It embeds the drawing name at first anchor creation plus the local creation timestamp.
- `last_revision` — hierarchical Observation revision label carried by this DWG copy and used as the parent/checkpoint for its next Observation Job.

V1 `drawing_id` format:

```text
<origin-name>-<HHMMSS>-<DDMMYY>
```

Example:

```text
Bowhotel-143527-100826
```

The `HHMMSS` + `DDMMYY` segments are generated once from local system time when the anchor is created. Including seconds keeps the identifier compact while making accidental collisions extremely unlikely for practical use. V1 does not require a random/opaque suffix.

Creation time/date and origin drawing name are therefore not stored as separate anchor fields. They are immutable provenance embedded once in `drawing_id`.

Rename, move, copy, or Save As never regenerate `drawing_id`.

The anchor does not store a separate origin/current drawing name, separate creation timestamp, name history, file paths, AutoCAD fingerprint/version history, branch history, parent history, semantic system metadata, entity snapshots, or Job-specific business state.

The physical anchor representation is a separate implementation detail. It must be non-graphical and resistant to normal accidental delete/purge operations.

See `DRAWING_ANCHOR.md` for the full identity, revision, branching, save, and crash semantics.

## Observation revision model

Observation history is not required to be linear.

A copied/older DWG can later become the active working drawing again. If that DWG carries revision `12` while AppData already contains revisions `13–15`, Observator must not force the drawing to revision `15`.

If the user continues working from revision `12`, the next successfully completed Observation Job creates a hierarchical branch revision such as `12.01` whose parent is `12`:

```text
10 → 11 → 12 → 13 → 14 → 15
           \
            → 12.01
```

Branch segments use two-digit zero padding:

```text
12.01
12.02
...
12.09
12.10
```

If a branch later forks again, the hierarchy extends using the same convention:

```text
12.01.01
12.01.02
```

Revision labels must be stored and compared as strings. Zero padding is significant formatting and must be preserved exactly. `12.10` must never be parsed as the decimal number `12.1`.

Revision `12.01` is newer work continued from revision `12`. Revisions `13–15` remain another valid branch of the same `drawing_id` lineage.

Branch/parent relationships belong in AppData revision metadata:

```text
revision: "12.01"
parent_revision: "12"
```

They do not belong in the Drawing Anchor. The anchor stays minimal and points only to the revision carried by that DWG copy.

The exact child-label allocation policy belongs to the AppData revision allocator. `parent_revision` remains authoritative for topology; string formatting is human-readable lineage notation, not the sole source of graph semantics.

## Observation Job completion boundary

Anchor update is part of the Observation Job completion path. It must not be delegated to application shutdown, AutoCAD save events, cache flushing, process cleanup, or an external background engine.

Canonical successful completion:

```text
1. parent = anchor.last_revision
2. stage = capturing; host records appended-object identities only.
3. Job reaches its explicit end boundary.
4. stage = finalizing; stop capture and resolve surviving top-level candidates.
5. Read candidate type/header and let the Job select relevant candidates.
6. Deep-read direct properties only for selected candidates.
7. Allocate a new unique hierarchical revision label in AppData.
8. Store parent_revision = parent.
9. Job writes/finalizes its selected AppData result/log.
10. Observator updates anchor.last_revision to the new revision exactly once.
11. stage = complete; Job is complete.
```

This is an Observator lifecycle checkpoint only. It does not assert that AutoCAD has saved the drawing to disk.

No `Save()` operation is required by this contract.

## Reopen semantics

When a drawing is reopened, Observator trusts the anchor physically present in that DWG copy as the identity and Observation revision carried by that copy.

Example:

```text
anchor.last_revision in opened DWG = "12"
AppData contains revisions through "15"
```

This means that the opened DWG copy carries checkpoint `12` while later Observation history also exists. It does not mean the opened drawing is invalid or that the anchor should automatically be advanced to `15`. The user may intentionally be continuing work from the older copy.

Two copied DWGs may therefore share the same `drawing_id` while carrying different `last_revision` values. They are different versions/branches of the same logical drawing lineage.

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

During the current foundation slice, the low-level logger may still receive `drawing_id` directly from its caller. Once the Drawing Anchor primitive is implemented, Observation Job orchestration must resolve `drawing_id` through the anchor instead of treating file path/name as drawing identity.

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
Observator may create/update Drawing Anchor only.
```

## Future Job usage

A future Observation Job may conceptually do this:

```text
Job starts
→ Observator resolves/creates Drawing Anchor
→ parent = anchor.last_revision
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
→ Observator updates anchor.last_revision once
→ Job completes
```

The business filtering, semantics, and persistence projection belong to the Observation Job. The capture mechanism and direct-property reader are generic Observator infrastructure.
