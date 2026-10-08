# CadGPT Working Knowledge

This file contains curated, durable operating knowledge for ChatGPT while CadGPT/CG is active.

Only stable lessons belong here. Raw product errors, failures, workarounds, and regressions belong in `diagnostics/cad/ERROR_LOG.md`.

## Intent routing inside an active CAD workspace

- When CadGPT/CG is active and a drawing workspace is bound, user requests such as **draw**, **draw this**, **redraw**, **create this geometry**, **add**, **modify**, **move**, **copy**, **delete**, **annotate**, or equivalent Vietnamese wording such as **vẽ**, **vẽ lại**, **tạo hình**, **thêm**, **sửa**, **di chuyển**, **copy**, **xóa**, **ghi chú** refer to the bound AutoCAD drawing by default.
- Perform the requested work through CadGPT CAD tools in the bound drawing.
- Do **not** interpret those requests as image-generation requests merely because the user attached a visual reference.
- Use image generation only when the user explicitly asks for a standalone image, illustration, render, concept art, mockup, or other output outside AutoCAD.
- An attached image may be a geometric/reference input for CAD work; it does not change the default destination away from the bound drawing.

## CAD state

- Current drawing facts must be read fresh from CAD in the same turn.
- Never reuse an old layer count, entity count, selection result, property value, or geometry observation as though it were current.
- One work binds one drawing.

## Grille ATT and grille-tag mutations

- Resolve actual grille and tag handles from the **currently bound drawing**. Read current grille ATT via `cad__cad_get_block` rather than scanning all blocks.
- To edit existing grille ATT values, use `cad__cad_update_grille_attributes` with one handle and an `updates` map. Where possible send observed original values in `expected_values`; inspect `verified`, `after` and `unresolved_tags` before reporting completion. This does not automatically update any already-placed tag's displayed ATTRIBs.
- To **delete a grille TAG** (not the grille), use `cad__cad_delete_grille_tags` with the exact tag handles only, after an explicit user delete request/approval. Set `confirmed=true` only with that authority. The service checks `GR-*` and `Hvac-GrilleTag` and is idempotent if a prior call already deleted the tag.
- Do not delete the grille INSERT when the user asked to delete only its annotation tag. Never blindly retry a mutating COM command when its result is uncertain; inspect verified readback. General-purpose destruction continues to require its own preview-token protocol.

## Internal Direct Jobs

- An Internal Direct Job is authoritative. If it fails, surface the failure rather than bypassing it with lower-level tools.
- TBH is an explicit internal exception: its capabilities are known in Internal Registry; successful `tbhloader.lsp` load switches TBH ON for that drawing, failed load leaves it OFF.

## Knowledge maintenance

- Use `diagnostics/cad/ERROR_LOG.md` to improve the app. Promote only stable CAD operating knowledge from an error into this file after the behavior is understood.
- Keep this file concise enough to be useful as model context.
