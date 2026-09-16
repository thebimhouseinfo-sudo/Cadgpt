# Observator

CadGPT Observator is the generic CAD entity observation foundation used by future Observation Jobs.

The engine has four infrastructure responsibilities:

1. capture the identities of database objects appended while an Observation Job is active;
2. at Job end, reduce those identities to surviving top-level drawing entities and read only the candidates the Job considers relevant;
3. write Job-selected records to drawing-scoped AppData logs;
4. own the minimal Drawing Anchor that binds AppData metadata to a DWG copy.

Observator does **not** discover Job changes by snapshotting or rescanning the whole drawing. While a Job is active, the CAD host uses a lightweight database append listener/reactor and records identity only. Full property inspection is deferred until Job finalization.

Canonical capture flow:

```text
Job start
→ start append-event capture
→ record object ids/handles only

user works manually in AutoCAD

Job end
→ stop capture
→ resolve only captured ids
→ discard erased/undone/non-entity/nested/block-definition objects
→ keep top-level ModelSpace/PaperSpace entities
→ read lightweight object type
→ Job filter
→ full direct-property read only for relevant candidates
```

This keeps discovery cost proportional to objects appended during the Observation Job rather than to total drawing size. A drawing may contain millions of existing entities without requiring Observator to enumerate them.

V1 does not traverse block definitions or nested entities. If the user creates many temporary entities and then turns them into one block before ending the Job, the top-level `BlockReference` is the relevant final candidate; the construction geometry inside the block definition is not recursively observed.

The engine does **not** define HVAC/system semantics, business predicates, property projections, or other concrete Observation Job behavior.

The Drawing Anchor is created lazily: a normal drawing has no reason to contain one until Observator first needs metadata for that drawing. The anchor is the **only CAD database object Observator may create or modify**.

A successful Observation Job finalizes its AppData result first, then updates the Drawing Anchor exactly once as the Job checkpoint carried by the current DWG state. Anchor maintenance must not depend on application shutdown, AutoCAD save timing, cache flushes, or an external background engine.

The anchor does **not** prove that AutoCAD saved the latest in-memory drawing to disk. When an older DWG copy is opened intentionally, the older anchor revision in that copy remains valid context for that copy even when AppData contains newer observation history.

See:

- `SPEC.md` — normative Observator engine and capture contract;
- `DRAWING_ANCHOR.md` — drawing identity and Job-checkpoint contract.
