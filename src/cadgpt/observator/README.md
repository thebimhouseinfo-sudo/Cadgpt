# Observator Engine

Implementation primitives for CadGPT Observator.

- `engine.ts` bridges the explicitly bound CAD drawing to the CAD MCP direct-property reader and exposes the generic log writer.
- `log-store.ts` appends caller-selected JSON records under `AppData/drawings/<drawing_id>/observator/`.

No concrete Observation Job lives here. Job-specific entity selection, filtering, property projection, semantics, and lifecycle belong to Job Runtime.

Normative design contract: `knowledge/observator/SPEC.md`.
