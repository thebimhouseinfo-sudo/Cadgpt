# Observator Engine

Implementation primitives for CadGPT Observator.

Current foundation:

- `engine.ts` bridges the explicitly bound CAD drawing to the CAD MCP direct-property reader and exposes the generic log writer.
- `log-store.ts` appends caller-selected JSON records under `AppData/drawings/<drawing_id>/observator/`.

The next engine primitive is Drawing Anchor support. The anchor is created lazily when Observator first needs persistent metadata for a drawing, and it is the only CAD entity Observator may create or modify.

A successful Observation Job must follow this persistent boundary:

```text
Job writes/updates AppData
→ Job finalizes/validates AppData result
→ Observator updates Drawing Anchor exactly once
→ Job completes
```

Anchor update is not a shutdown/save/cache-flush task and must not be delegated to an external background engine.

No concrete Observation Job lives here. Job-specific entity selection, filtering, property projection, semantics, relevance rules, and lifecycle behavior belong to Job Runtime.

Normative design contracts:

- `knowledge/observator/SPEC.md`
- `knowledge/observator/DRAWING_ANCHOR.md`
