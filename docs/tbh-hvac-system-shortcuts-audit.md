# TBH Toolkit — complete HVAC system shortcut audit

**Source:** `thebimhouseinfo-sudo/Cadgpt`, branch `fix/tbh-hvac-system-shortcuts-1-5`. **Inventory:** 64 bundled `.lsp` files including `tbhloader.lsp`. 

**Required invariant:** `1=SA | 2=RA | 3=OA | 4=EA | 5=TA`. This applies only to **HVAC system selectors**, never to unrelated choices such as insulation, riser shape, damper style, annotation type or geometry.

## Findings and repairs

- `CD` (`Draw/Modify/Change Duct Type.lsp`): displayed prompt previously said `3=EA, 4=OA` even though `cd:norm-type` used `3=OA, 4=EA`. Updated the displayed prompt and accepted keyword order, without changing block/fitting logic.
- `Round Duct.LSP` batch edit: old UI and branch mapping used `0=SA, 1=RA, 2=EA, 3=OA, 4=TA`. Updated **both** prompt and branch mapping to `1..5`.
- `DTS`: normalizer already used the required mapping. Normalized the keyword list and command banner for consistency.
- Other system-number pickers and direct layer aliases already conform; no unnecessary changes to their working implementation.

**Validation method:** checked all 64 source files' command definitions, `initget` / `getkword` / numeric menus, explicit numeric mappings, system layer literals, and system inheritance paths. A dedicated regression test now scans the full Toolkit, explicitly asserts all seven numeric system picker files, checks all ten direct layer shortcuts including shading, and checks all four separate Grille selection branches. The test is **static source validation**: no claim of successful interactive execution on a bound AutoCAD drawing.

## File-by-file disposition

| # | Source file (relative to `tbh-toolkit/`) | HVAC numeric selection | Finding / review disposition |
|---:|---|---|---|
| 1 | `TBH Tool Kit/Annotation/AttModSuiteV1-1.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 2 | `TBH Tool Kit/Annotation/Change leader properties.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 3 | `TBH Tool Kit/Annotation/Duct Tag.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 4 | `TBH Tool Kit/Annotation/EQM Tag.lsp` | No independent numeric HVAC picker | 1/2/3 menu selects tag placement/type, not HVAC systems |
| 5 | `TBH Tool Kit/Annotation/Flex connection Tag.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 6 | `TBH Tool Kit/Annotation/MEP Properties.lsp` | Numeric HVAC picker | Grille type creation menu 1 SAG, 2 RAG, 3 OAG, 4 EAG, 5 TAG: correct |
| 7 | `TBH Tool Kit/Annotation/MEP Tag.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 8 | `TBH Tool Kit/Annotation/NumIncV3-9.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 9 | `TBH Tool Kit/Demolition/Hatch Demolition.LSP` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 10 | `TBH Tool Kit/Draw/Auto Connect.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 11 | `TBH Tool Kit/Draw/Create/Bend Up Down.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 12 | `TBH Tool Kit/Draw/Create/Blade Damper.lsp` | No independent numeric HVAC picker | Detects system from picked duct/layer; its 1/2 menu is damper geometry |
| 13 | `TBH Tool Kit/Draw/Create/Boot.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 14 | `TBH Tool Kit/Draw/Create/Duct Riser.lsp` | No independent numeric HVAC picker | Uses global duct type; 1/2 menu chooses rectangular/round geometry |
| 15 | `TBH Tool Kit/Draw/Create/Endcap.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 16 | `TBH Tool Kit/Draw/Create/FlexConn.lsp` | No independent numeric HVAC picker | 1/2/3 menu means Create/Edit/Section, not SA/RA/OA |
| 17 | `TBH Tool Kit/Draw/Create/Flexible Duct.lsp` | No independent numeric HVAC picker | F15..F50 are flexible-duct sizing commands, not HVAC system numeric shortcuts |
| 18 | `TBH Tool Kit/Draw/Create/Grille.lsp` | Numeric HVAC picker | Four independent selectors; 1–5 and system-specific layers correct |
| 19 | `TBH Tool Kit/Draw/Create/Mitered Elbow.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 20 | `TBH Tool Kit/Draw/Create/Penetration.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 21 | `TBH Tool Kit/Draw/Create/Pipework.lsp` | No independent numeric HVAC picker | 1/2 menu means Refrigerant/Condensate |
| 22 | `TBH Tool Kit/Draw/Create/Rec Elbow.lsp` | No independent numeric HVAC picker | Inherits system from selected duct/global type; no numeric HVAC system selector |
| 23 | `TBH Tool Kit/Draw/Create/Rec to Round.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 24 | `TBH Tool Kit/Draw/Create/Rect Duct Transition.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 25 | `TBH Tool Kit/Draw/Create/Rectangular duct.lsp` | Numeric HVAC picker | Rectangular edit 1–5 and branch mapping correct |
| 26 | `TBH Tool Kit/Draw/Create/Round Duct Transition.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 27 | `TBH Tool Kit/Draw/Create/Round Duct.LSP` | Numeric HVAC picker | Round edit: legacy 0–4 and swapped OA/EA; repaired to 1–5 |
| 28 | `TBH Tool Kit/Draw/Create/Round Elbow.LSP` | No independent numeric HVAC picker | Inherits system from selected round duct/global type; no numeric HVAC system selector |
| 29 | `TBH Tool Kit/Draw/Duct Checker.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 30 | `TBH Tool Kit/Draw/Duct Path.lsp` | No independent numeric HVAC picker | Inherits system from connected duct or shared defaults; no numeric HVAC system selector |
| 31 | `TBH Tool Kit/Draw/Duct Sizer.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 32 | `TBH Tool Kit/Draw/Duct Type Setting.lsp` | Numeric HVAC picker | DTS: mapping correct; keyword list/banner order normalized |
| 33 | `TBH Tool Kit/Draw/Modify/Align.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 34 | `TBH Tool Kit/Draw/Modify/Change Duct Type.lsp` | Numeric HVAC picker | CD: prompt EA/OA reversed; repaired, normalizer already correct |
| 35 | `TBH Tool Kit/Draw/Modify/Match MEP Properties.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 36 | `TBH Tool Kit/Draw/Modify/Modify Duct.lsp` | No independent numeric HVAC picker | 1/2/3 menu means Length/Size/Rotate-or-Switch, not system |
| 37 | `TBH Tool Kit/Draw/Others/Change Layer.lsp` | Direct numeric CAD commands | c:1..c:5 and c:1r..c:5r map correctly; c:1e is equipment shading, not a sixth system |
| 38 | `TBH Tool Kit/Draw/Others/Hidden duct.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 39 | `TBH Tool Kit/Draw/Others/Tapper.lsp` | Numeric HVAC picker | Tapper 1–5 and layer mapping correct |
| 40 | `TBH Tool Kit/Setup Drawing/Chuanhoadrawing.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 41 | `TBH Tool Kit/Setup Drawing/Copy2Layouts.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 42 | `TBH Tool Kit/Setup Drawing/Finish Drawings.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 43 | `TBH Tool Kit/Setup Drawing/Layout Reference Tools.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 44 | `TBH Tool Kit/Setup Drawing/Split Viewport.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 45 | `TBH Tool Kit/Setup Drawing/TabSortV2-2.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 46 | `TBH Tool Kit/Setup Drawing/Viewport-lock-unlock.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 47 | `TBH Tool Kit/Setup Xref/CleanATT.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 48 | `TBH Tool Kit/Setup Xref/CleanAll.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 49 | `TBH Tool Kit/Setup Xref/CleanMtext.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 50 | `TBH Tool Kit/Setup Xref/PurgeReconciledLayers.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 51 | `TBH Tool Kit/Setup Xref/XrefLayerMapper_v3.2.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 52 | `TBH Tool Kit/Special/Block to layer 0.LSP` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 53 | `TBH Tool Kit/Special/Circular Wipeout.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 54 | `TBH Tool Kit/Special/Color-bylayer-byblock.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 55 | `TBH Tool Kit/Special/Export Layers.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 56 | `TBH Tool Kit/Special/Flexconn Takeoff.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 57 | `TBH Tool Kit/Special/Grille takeoff.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 58 | `TBH Tool Kit/Special/Join Polyline.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 59 | `TBH Tool Kit/Special/Match Hatch.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 60 | `TBH Tool Kit/Special/NestedRemove.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 61 | `TBH Tool Kit/Special/TBH Calc.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 62 | `TBH Tool Kit/TBH_Block_Library.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 63 | `TBH Tool Kit/TBH_Manager.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
| 64 | `tbhloader.lsp` | No independent numeric HVAC picker | No 1–5 HVAC system selection to change; unrelated shortcuts preserved |
## Non-regression / operational notes

- Numeric shortcuts `c:1..c:5` set duct system layers; `c:1r..c:5r` set their shading layers. The separate `c:1e` is equipment shading, not an HVAC system choice.
- Other menu digits (such as `1=Rect/2=Round`, `1=Manual/2=Auto`, `0=Bare insulation`) must retain their original behavior.
- Do **not** rewrite layer/block detection code solely because an unordered list of system names uses EA before OA. Such lists are named mappings, not ordinal numeric shortcuts.
- AutoCAD may retain previous Lisp function definitions in memory after a repository update. To validate active behavior, refresh the installed TBH loader and test in an explicitly approved drawing session; static CI is not live AutoCAD evidence.
