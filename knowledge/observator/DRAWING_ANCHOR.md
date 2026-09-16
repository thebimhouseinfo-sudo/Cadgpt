# Drawing Anchor Contract

## Purpose

The Drawing Anchor is the minimal persistent identity/job-checkpoint entity owned by Observator inside a DWG.

It exists only because Observator has metadata for that drawing. A drawing that has never been observed does not need an anchor.

The anchor is **not** a proof that AutoCAD saved the latest drawing state to disk, and it is **not** a selector that says newer AppData must always replace an older DWG state.

## Lazy creation

The anchor is created on first Observator-managed persistence for a drawing:

```text
first Observation Job
→ no anchor found
→ generate stable drawing_id
→ insert Drawing Anchor
→ create AppData/drawings/<drawing_id>/
→ continue Job
```

Opening a drawing in CadGPT alone must not create an anchor.

## Ownership and mutation rule

The Drawing Anchor is the **only CAD entity Observator may create or modify**.

Observator may not use this exception to mutate business geometry, tags, numbering, layers, properties, or other user drawing content.

## Minimal logical payload

The anchor contains only persistent identity/job-checkpoint data. At minimum:

```text
drawing_id
schema_version
last_completed_observation_revision
```

A `last_completed_observation_at` value may be included for diagnostics.

The anchor must not contain system membership, grille/duct/equipment semantics, full entity snapshots, Job-specific business state, or other semantic metadata. Those remain under AppData.

The physical AutoCAD representation is intentionally open until implementation selection. The logical contract above must survive whichever entity representation is chosen.

## Per-Job update rule

Every successfully completed Observation Job writes its AppData result and then updates the Drawing Anchor **exactly once**.

```text
anchor revision = N

Observation Job runs
→ writes/finalizes Job-selected AppData/log records for revision N+1
→ update anchor once to revision N+1
→ Job complete
```

The final anchor update belongs to Observator itself. It must not be delegated to another engine or delayed until application shutdown, AutoCAD save, cache flush, or process cleanup.

## Save independence

Observator does not try to determine whether AutoCAD has persisted the current in-memory DWG to disk.

AutoCAD can become Not Responding, terminate with a fatal error, be force-closed, or simply have unsaved changes. Therefore:

```text
Observation Job completed
→ AppData log written
→ anchor updated in the current DWG session
```

is the full Observator responsibility.

There is **no additional `Save()` requirement** and no attempt to certify that the updated anchor or the user's latest CAD edits are present in the file on disk.

## Crash semantics

If AutoCAD/process termination happens before the final anchor update, the current in-memory drawing may retain the previous anchor revision while AppData may contain partial or newer records.

If termination happens after the anchor update but before AutoCAD saves, the on-disk DWG may still contain an older anchor revision. This is expected and is not something Observator can reliably prevent or verify.

Therefore an anchor revision means:

> this DWG state/copy contains the Observation checkpoint that was present when that DWG state was saved or otherwise persisted.

It does **not** mean:

> this is definitely the newest CAD work that ever existed for this drawing_id.

## Reopen and older drawing copies

When Observator later runs on a drawing that already contains an anchor:

```text
read anchor
→ obtain drawing_id
→ obtain this DWG copy's last_completed_observation_revision
→ map to AppData/drawings/<drawing_id>/
→ continue from the context of the drawing copy actually opened
```

AppData may contain records/revisions newer than the anchor in the currently opened DWG. Observator must **not automatically advance the anchor or assume the DWG is stale/corrupt**, because the user may intentionally have opened an older saved copy/version.

The anchor in the opened DWG describes that DWG copy. Newer AppData is historical evidence available for later reconciliation logic, not automatic authority over the opened file.

File path and file name are locators only. They are not persistent drawing identity.

## Save As / duplicated anchor

A copied or Save-As DWG can duplicate the same `drawing_id`. Collision/clone policy is not yet frozen by this contract and must not be guessed by the current foundation implementation.
