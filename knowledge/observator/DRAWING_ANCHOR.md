# Drawing Anchor Contract

## Purpose

The Drawing Anchor is the minimal persistent identity/checkpoint entity owned by Observator inside a DWG.

It exists only because Observator has persistent metadata for that drawing. A drawing that has never been observed does not need an anchor.

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

The anchor contains only persistent identity/checkpoint data. At minimum:

```text
drawing_id
schema_version
last_committed_observation_revision
```

A `last_committed_at` value may be included for diagnostics.

The anchor must not contain system membership, grille/duct/equipment semantics, full entity snapshots, Job-specific state, or other business metadata. Those remain under AppData.

The physical AutoCAD representation is intentionally open until implementation selection. The logical contract above must survive whichever representation is chosen.

## Per-Job commit rule

Every successfully completed Observation Job updates the Drawing Anchor **exactly once** after the Job's AppData result has been finalized.

```text
anchor revision = N

Observation Job runs
→ writes/updates AppData for revision N+1
→ validates/finalizes AppData result
→ update anchor once to revision N+1
→ Job complete
```

The final anchor update belongs to Observator itself. It must not be delegated to another engine or delayed until shutdown/save/cache-flush time.

## Why the anchor update is inside Observator

CadGPT cannot rely on knowing when:

- AutoCAD will save;
- CadGPT/AutoCAD will close normally;
- runtime caches will flush;
- Windows/process shutdown will occur;
- a crash or forced termination will interrupt execution.

Therefore the only reliable checkpoint boundary is successful Observation Job completion.

## Crash semantics

If the process terminates before the final anchor update, the anchor must retain the previous committed checkpoint.

Example:

```text
anchor = revision 18

Job starts revision 19
→ AppData partially written
→ process crashes
→ anchor remains revision 18
```

On reopen, Observator can distinguish the last anchor-confirmed commit from newer incomplete/unreconciled AppData work.

If AppData was finalized but the process died before the anchor update, AppData may be ahead of the anchor. Reopen/recovery logic must detect this mismatch and reconcile it explicitly rather than silently treating the newer state as anchor-confirmed.

## Reopen mapping

When Observator runs again on a drawing with an anchor:

```text
read anchor
→ drawing_id
→ AppData/drawings/<drawing_id>/
→ compare anchor checkpoint with stored AppData state
→ reconcile if necessary
→ continue Observation Job
```

File path and file name are locators only. They are not persistent drawing identity.

## Save As / duplicated anchor

A copied or Save-As DWG can duplicate the anchor. Collision/clone handling is not yet frozen by this contract and must not be guessed by the current foundation implementation.
