# Observator

CadGPT Observator is the generic CAD entity observation foundation used by future Observation Jobs.

The engine has three infrastructure responsibilities:

1. read complete direct properties from one or many CAD entities;
2. write Job-selected records to drawing-scoped AppData logs;
3. own the minimal Drawing Anchor that binds persistent AppData metadata to a DWG.

The engine does **not** define HVAC/system semantics, entity predicates, property projections, or concrete Observation Job behavior.

The Drawing Anchor is created lazily: a normal drawing has no reason to contain one until Observator first needs persistent metadata for that drawing. The anchor is the **only CAD entity Observator may create or modify**.

A successful Observation Job finalizes its AppData result first, then updates the Drawing Anchor exactly once as the final observation commit/checkpoint. Anchor maintenance must not depend on application shutdown, AutoCAD save timing, cache flushes, or an external background engine.

See:

- `SPEC.md` — normative Observator engine contract;
- `DRAWING_ANCHOR.md` — drawing identity and commit/checkpoint contract.
