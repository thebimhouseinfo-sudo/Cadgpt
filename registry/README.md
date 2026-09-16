# CadGPT Capability Registry

CadGPT uses a semantic capability registry so ChatGPT can discover what existing tools and Lisp actually do without repeatedly opening implementation files.

## Principles

- filenames and personal command names are **not** semantic contracts;
- permanent Lisp metadata is curated from actual implementation behavior;
- registry metadata is for discovery/selection, not an execution bypass;
- MCP `tools/list` remains authoritative for executable MCP tool schemas;
- permanent Lisp source lives under `lisp/**` and every user-facing permanent `.lsp` must be catalogued;
- work-in-progress Lisp under `appdata/lisp-draft/**` is intentionally **not** part of the permanent registry;
- runtime AI-derived variants under `appdata/runtime/dynamic-lisp/**` are runtime artifacts and are not permanent registry entries.

## Lisp metadata

Each permanent Lisp capability should describe enough behavior for ChatGPT to choose it without reading source merely for discovery:

```text
id
title
ai_mode             static | dynamic
class
subclass
tags
module
commands
path
summary
when_to_use
targets
inputs
effects
interaction         interactive | non-interactive
load_behavior       define_only | execute_on_load
mutates_drawing
destructive
risk                 low | medium | high
dynamic_parameters
implementation_notes
```

Descriptions follow implementation reality rather than trusting legacy headers blindly.

## AI usage mode

All permanent sources are ordinary **AutoLISP/Visual LISP files**. `ai_mode` does not define a different Lisp type or language.

`ai_mode=static` means CadGPT/AI normally uses the permanent source as stored. `dynamic_parameters` must be empty.

`ai_mode=dynamic` means CadGPT/AI is allowed to derive a temporary runtime variant of the same normal AutoLISP source by changing only the bounded fields listed in `dynamic_parameters`. The permanent source remains unchanged.

For example, XLAY is ordinary AutoLISP, but its project-specific mapping tables/rules make it suitable for AI-derived runtime variants. Those instances live under `appdata/runtime/dynamic-lisp/**` and should carry provenance such as source registry ID/path, parameters, and content hash.

## Draft → permanent lifecycle

New or substantially changed AutoLISP normally follows:

```text
appdata/lisp-draft/**
→ AutoLISP static validation
→ user-approved AutoCAD load/runtime test
→ lisp_promote_draft
→ lisp/** + registry/lisp-registry.json
```

`lisp_promote_draft` re-validates source, derives public commands, checks path/command collisions, writes the permanent file, and updates semantic registry metadata as one rollback-safe operation. If registry update fails, permanent source is restored to its previous state.

A draft can remain in AppData after promotion for traceability until explicitly cleaned.

## Registry tools

```text
registry_list(kind="lisp" | "tool", ...)
registry_get(kind="lisp" | "tool", id=...)
```

Typical Lisp discovery:

```text
registry_list(kind="lisp", class_name="xref", ai_mode="dynamic", query="map consultant layers")
registry_get(kind="lisp", id="XLAY")
```

Read the `.lsp` source only when modification, debugging, audit, or runtime-variant construction actually requires implementation detail.

## CI contract

`scripts/validate-lisp-registry.py` and the registry workflow enforce structural drift protection:

- every user-facing permanent `lisp/**/*.lsp` except `lisp/_cadgpt-system/**` has a registry entry;
- every registered path exists;
- declared `commands` exist in source;
- public source commands are not omitted from registry metadata;
- registry IDs are unique;
- `ai_mode` and core semantic fields are valid;
- `ai_mode=static` cannot declare dynamic parameters;
- `ai_mode=dynamic` must declare at least one bounded dynamic parameter;
- legacy `type` / `dynamic_role` fields are rejected.

Drafts and runtime AI-derived instances are intentionally outside permanent-library coverage until explicit promotion of source changes.
