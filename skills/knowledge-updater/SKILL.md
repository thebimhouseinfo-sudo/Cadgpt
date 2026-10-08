# Skill: Knowledge Updater (KUG / KUD)

## Purpose
Maintain **HVAC domain working knowledge**, not programming knowledge.

- `KUG` / `cg/kug` — update global HVAC knowledge in `appdata/knowledge/`.
- `KUD` / `cg/kud` — update current bound drawing knowledge in `appdata/drawings/<verified-drawing-anchor>/knowledge/`.

Both workflows may use SYSTEM tools for document/metadata observations and CAD MCP read tools when an explicitly bound HYBRID drawing workspace is available. Do not demand AutoCAD for purely global document work. Neither command is an AutoCAD command or a general-purpose filesystem escape.

## Strict taxonomy
Allowed: HVAC system design/implementation practices, system classification (SA, RA, OA, EA, TA), equipment/connectors, layer conventions, annotation, tagging, sizing methodology, equipment identification and project-specific decisions.

Forbidden here: CAD API or DXF developer information, AutoLISP syntax/authoring/debugging, Lisp Writer implementation instructions, CAD MCP code, tool manifests, MCP Fixer internal procedures. Maintain these only in the dedicated internal `skills/write-lisp/`, `skills/cad-mcp-dev/` and curated internal repositories as appropriate.

## Procedure
1. Determine KUG vs KUD from user's exact request. Never infer global promotion from a single drawing.
2. Resolve existing knowledge using `knowledge_list` / `knowledge_read` and compare with the proposed rule or observed evidence.
3. When consulting current CAD, use same-turn fresh CAD MCP read results and the explicitly bound drawing. If CAD is unavailable, say so instead of manufacturing drawing facts.
4. Classify each statement as **confirmed rule**, **drawing-specific observation** or **unresolved**; ask the human about unresolved items. Do not silently turn assumptions into rules.
5. Show the proposed document or changed sections, provenance and conflicts; obtain explicit user approval before `knowledge_upsert`.
6. Use an empty `expected_sha256` only when creating; on updates use the exact hash from `knowledge_read`. On conflict, reread and re-review; never overwrite blindly.
7. Read back the saved entry and report key, scope, affected drawing anchor and content summary.

## Scope boundaries
- Global: reusable HVAC working conventions only; no implicit promotion from per-drawing observations.
- Drawing: the runtime revalidates the bound drawing and canonical Drawing Anchor before every tool operation; never construct or guess another drawing folder.
- Never mutate `knowledge/cad/WORKING_KNOWLEDGE.md` through KUG/KUD. That repository file contains internal CadGPT behavior, not user HVAC domain knowledge.
- No external source automatically has authority over a confirmed user rule; show disagreements instead of silently resolving them.
