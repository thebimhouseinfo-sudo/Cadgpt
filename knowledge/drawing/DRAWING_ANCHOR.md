# CadGPT Drawing Anchor

Status: **canonical shared drawing-persistence contract**

## Purpose

Drawing Anchor is CadGPT's generic persistent identity contract for a DWG.

Any Job that needs to save persistent metadata or results for a drawing must use the Drawing Anchor to resolve the drawing's stable AppData folder. This rule is independent of any specific Job, Skill, or higher-level concept.

The anchor exists to preserve drawing identity even when the DWG is renamed, moved, copied, or saved under another file name.

## Canonical storage root

Persistent drawing-scoped data lives under:

```text
%LOCALAPPDATA%\CadGPT\drawings\<drawing_id>\
```

Each Job may define its own subfolder/schema below that drawing root, for example:

```text
drawings/<drawing_id>/
├── <job-a-data>/
├── <job-b-data>/
└── ...
```

The Job package itself is not the storage location for drawing products.

## Lazy anchor creation

Opening or binding a drawing does not create an anchor automatically.

The anchor is created only when a Job first needs persistent drawing-scoped storage.

Canonical flow:

```text
Job needs persistent drawing-scoped data
→ check Drawing Anchor in the explicitly bound DWG
   ├─ anchor exists
   │  → read anchor.drawing_id
   │  → resolve %LOCALAPPDATA%\CadGPT\drawings\<drawing_id>\
   │  → ensure the drawing folder exists
   │  → Job writes its metadata/result below that drawing root
   │
   └─ anchor missing
      → create a new stable drawing_id
      → write Drawing Anchor into the explicitly bound DWG
      → create %LOCALAPPDATA%\CadGPT\drawings\<drawing_id>\
      → return drawing_id + drawing root
      → Job writes its metadata/result below that drawing root
```

Anchor check/create plus drawing-folder resolution is a shared CadGPT **contract**, not a separately promoted capability.

Each Job that needs persistent drawing-scoped data is responsible for enforcing this contract during its own execution. The Job may use its own Job-private implementation/helper to read or create the anchor, but every Job must use the same canonical anchor format and drawing-folder rules. Jobs must not implement parallel identity schemes.

## Anchor payload

The shared Drawing Anchor carries only the stable drawing identity required to locate drawing-scoped AppData:

```text
drawing_id
```

Job-specific state, business metadata, revision history, entity snapshots, system membership, file paths, and other workflow data do not belong in the shared anchor. They belong under the drawing's AppData folder in the schema owned by the relevant Job.

## V1 drawing_id

V1 uses:

```text
<origin-name>-<HHMMSS>-<DDMMYY>
```

Example:

```text
Bowhotel-143527-100826
```

The id is generated once when the anchor is first created. Rename, move, copy, or Save As must not regenerate it.

The current file name/path is never authoritative persistent identity after the anchor exists.

## Job contract

Any Job that needs persistent drawing metadata must:

1. target the explicitly bound drawing;
2. check the canonical Drawing Anchor in the bound DWG;
3. use the returned `drawing_id`;
4. resolve/create `%LOCALAPPDATA%\CadGPT\drawings\<drawing_id>\`;
5. write only its own data beneath that drawing root.

A Job must not:

- derive persistent identity from current DWG name or file path;
- use a runtime binding/session id as persistent drawing identity;
- invent its own drawing-id format;
- silently create another parallel folder keyed by filename;
- store drawing products inside the Job library merely because the Job produced them.

## Copy / rename / move semantics

Because the anchor travels with the DWG:

```text
rename / move / copy / Save As
→ anchor remains in DWG
→ drawing_id remains unchanged
→ CadGPT resolves the same drawing-scoped AppData root
```

A copied DWG therefore initially represents the same logical drawing identity. Any future branching/version semantics belong to the Job/data model that needs them, not to the shared identity primitive itself.

## Physical representation

The physical AutoCAD representation is part of the shared Drawing Anchor format. Jobs may implement read/create through their own private code, but the physical representation must remain compatible across Jobs.

It must be:

- non-graphical;
- resistant to normal accidental selection/delete operations;
- resistant to ordinary purge workflows;
- readable/writable without scanning drawing geometry.

Jobs must not implement their own physical anchor representation.

## Lazy existence and Job responsibility

A drawing with no anchor is normal. It means no Job has yet needed persistent drawing-scoped metadata for that DWG.

CadGPT must not create or promote an anchor capability merely because a drawing is opened, bound, or available.

When a Job first needs persistent drawing-scoped storage:

```text
Job needs persistence
→ check canonical Drawing Anchor
   ├─ exists
   │  → use drawing_id
   │  → resolve/create drawings/<drawing_id>/
   └─ missing
      → Job creates a canonical Drawing Anchor
      → Job creates drawings/<drawing_id>/
      → continue persistence
```

The Job may perform anchor read/create with its own Job-owned private Lisp/helper or another approved executor. That implementation remains private to the Job unless there is an independent reason to make it reusable.

No global Lisp Registry entry, separate Job registration, or standalone promotion is required for anchor handling itself.

If a Job requires persistent drawing metadata but cannot read/create the canonical anchor correctly, that Job is incomplete and must stop rather than falling back to filename/path identity or another ad-hoc scheme.
