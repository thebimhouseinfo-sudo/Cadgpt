# TBH Toolkit — Grille FACE_SIZE and MODEL

## Attribute contract

Grille block (SA/RA/OA/EA/TA layers) and Grille Tag (Hvac-GrilleTag, GR-* block names) have two additional **invisible, editable** attributes:

| Tag | Default | Source / propagation |
|---|---|---|
| `FACE_SIZE` | Blank for existing grilles and Side Wall; W x H for new Eggcrate, Bar, Double Deflection grilles | Separate from existing `SIZE` (neck size) |
| `MODEL` | Blank; user-entered | Grille block -> linked tag |

Both are invisible in the drawing but editable via AutoCAD Properties / attribute tools. Neither is derived from `SIZE`, `GRILLE_TYPE` or a guessed equipment model. All existing tags and visible grille-tag geometry retain their layouts.

## Paths affected

- `MEP_Properties_Create`: ensures new definitions for grilles; `ATTSYNC` only when missing definitions are added.
- `GRR` (not `GR` in source): generates the four grille types, stamps `FACE_SIZE` only when both face dimensions are supplied, and uses a stable INSERT reference across `ATTSYNC`.
- `GT`: initializes missing grille ATT for existing blocks and inserts tag carrying both fields.
- `TG`: delegates grilles to `GT`; no independent modification needed.
- Reactor / `GT:SetTagAttributes`: synchronized extended attributes through the bidirectional XData handle link. Copied/unlinked grilles are never matched to tags by tag number.
- `GRILLE_ATTR_UPGRADE`: explicit legacy drawing migration; adds missing hidden ATTDEFs and synchronizes **only** the new fields on linked tags. Run once after loading `TBH`; safe to rerun. Preexisting other attribute values and XData links are not intentionally rewritten.
- `GRTAKEOFF`: already enumerates all ATTRIB references dynamically and consequently exports both hidden columns. It requires no source change.
- `GRILLE_UPDATE` / `FDT`: do not modify the two fields.

## Local AutoCAD acceptance tests (not simulated by static CI)

1. Back up a DWG with grilles and tags. Confirm existing `SIZE`, `TAG_NUMBER`, `AIR_FLOW`, `GRILLE_TYPE`, `FLEX_DUCT_SIZE`, `CUSHION_HEAD` and system metadata.
2. Reload internal `TBH` loader. Run `GRILLE_ATTR_UPGRADE`. Verify old values and XData links persist; invisible FACE_SIZE and MODEL appear on both grille and tag.
3. Set grille `FACE_SIZE = 600x450`, `MODEL = ABC-01` via Properties. Check linked tag updates both; visible tag appearance unchanged.
4. Run `GT` and `TG` for grilles, and `GRR` for all four grille shape options. Confirm `FACE_SIZE` is W x H for three two-dimensional shapes, Side Wall remains blank and `MODEL` is blank until entered.
5. Copy a grille. Confirm changes to the copied grille do **not** update the original tag by matching `TAG_NUMBER`. Recreate a tag via `GT` for the copy.
6. Run `GRTAKEOFF` on tags. Ensure CSV contains `FACE_SIZE` and `MODEL` columns, including empty values where not specified.
7. Rerun `GRILLE_ATTR_UPGRADE` to confirm idempotency (no duplicate ATTDEFs or attribute changes). Test DWG save/reopen and verify invisible ATT persistence.

Static regression tests are in `tests/tbh-grille-face-model.test.mjs`. They check the source contracts and repo LISP syntax, **not** live COM/CAD drawing execution.
