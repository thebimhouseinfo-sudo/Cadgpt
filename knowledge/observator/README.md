# Observator

CadGPT Observator is an experimental/generic CAD entity observation foundation that may be used by Jobs needing append-event capture. It is not the owner of drawing identity or persistent drawing storage.

The engine has three observation responsibilities:

1. capture the identities of database objects appended while an Observation Job is active;
2. at Job end, reduce those identities to surviving top-level drawing entities and read only the candidates the Job considers relevant;
3. write Job-selected records to drawing-scoped AppData logs when a Job chooses to use this engine.

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

Drawing identity and drawing-folder resolution are shared CadGPT infrastructure, not Observator-owned behavior. Any Job—including one that uses Observator capture—must follow `knowledge/drawing/DRAWING_ANCHOR.md` when it needs persistent drawing-scoped data.

See:

- `SPEC.md` — normative Observator engine and capture contract;
- `../drawing/DRAWING_ANCHOR.md` — canonical shared drawing identity and persistent drawing-folder contract.
