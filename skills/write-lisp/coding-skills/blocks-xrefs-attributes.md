# Coding Skill: Blocks, Xrefs, and Attributes

Purpose: handle the AutoCAD structures that most often break naive AutoLISP automation.

## Block references versus definitions

Always distinguish:

- block reference / INSERT in model or paper space;
- block definition / block table record;
- nested entities inside the definition;
- attribute definitions (`ATTDEF`);
- attribute references attached to inserts.

Changing the reference layer does not change internal entity layers. Changing a definition does not automatically update every attribute reference unless the appropriate synchronization step is performed.

## Dynamic blocks

Dynamic block references may have anonymous names while `EffectiveName` identifies the user-facing definition. Use the property that matches the task instead of assuming `Name` is always the semantic block name.

## Clone-before-modify pattern

When different inserts of one shared definition must receive different internal layer/property mappings, do not edit the shared definition in place. Clone or rebuild the definition for the relevant system/group, then repoint only the intended references.

This pattern is especially important for Revit-exported fittings/accessories where one generic source block may need different target system layers.

## Nested entity mapping

When remapping internal block entities:

1. identify the intended target system from deterministic evidence;
2. inspect every entity in the definition that participates in the mapping;
3. distinguish outline, shading/hatch, hidden/detail, centerline, insulation, text, and attribute entities where required;
4. preserve geometry unless the workflow explicitly changes it;
5. verify that no source/review/detail layers remain unexpectedly.

## Attributes

- Read attribute references from the insert when changing displayed values.
- Edit attribute definitions only when changing the block schema/default.
- Treat tag matching as case-insensitive unless a project contract says otherwise.
- After schema changes, synchronize references deliberately rather than assuming AutoCAD updates them automatically.

## Xrefs

- Distinguish xref block references from ordinary local block references.
- Do not modify entities inside an external reference as if they were local drawing entities.
- Xref-dependent layer names commonly contain `|`; preserve/parse the source prefix intentionally.
- Mapping logic should live in data where possible; a new incoming xref layer name should not force an algorithm rewrite when the mapper already supports data-driven mappings.

## Explode/burst caution

Exploding or rebuilding blocks is destructive and can lose attributes, dynamic behavior, fields, or semantic identity. Use it only when the workflow explicitly requires flattened geometry and verify the resulting entities afterward.
