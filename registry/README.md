# CadGPT Capability Registry

CadGPT exposes one effective capability catalog to ChatGPT, but ownership is split deliberately:

```text
Internal Registry
├─ MCP tools
└─ system skills

User Registry
├─ managed Lisp capabilities
└─ concrete Jobs
```

The effective registry is a unified search/view layer, not an override mechanism. User Registry cannot contain tools or system skills; Internal Registry does not own user Lisp/Jobs.

## Internal Registry

Internal entries are generated from CadGPT core tool metadata, the stable CAD MCP manifest, and `skills/*/SKILL.md`. They version with CadGPT and are not user-editable workflow assets.

## User Registry

User Registry lives under:

```text
appdata/registry/user/
```

Lisp/Job libraries are first copied into:

```text
appdata/libraries/lisp/<library-id>/**
appdata/libraries/jobs/<library-id>/**
```

Registry entries then reference managed assets with:

```text
library_id + relative_path
```

The external folder selected by the user is an import source only. CadGPT never writes back to it.

## Lisp metadata

A curated Lisp capability can include:

```text
id
kind                lisp
library_id
relative_path
title
ai_mode             static | dynamic
class
subclass
tags
module
commands
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
semantic_status      indexed | curated
```

Import/index never modifies source. Freshly discovered entries may remain `semantic_status=indexed` until behavior metadata is curated.

`ai_mode` is an AI usage mode, not a Lisp type. `dynamic` only permits bounded temporary runtime variants using declared `dynamic_parameters`; the source remains ordinary AutoLISP/Visual LISP.

## Job metadata

Concrete Jobs are User Registry assets from managed Job Libraries. Job rules/spec/schema are internal CadGPT knowledge under `knowledge/jobs/**` and are not themselves user Job entries.

## write-lisp lifecycle

```text
managed Lisp
→ lisp_checkout
→ appdata/workspace/lisp-draft/**
→ header/description normalization in draft only
→ validation + approved CAD test
→ lisp_promote_draft
→ managed AppData Lisp + User Registry
```

CadGPT header is the default authoring profile. `library_id=tbh-toolkit` is the explicit TBH-header exception.

## Registry tools

```text
registry_list(kind="tool" | "skill" | "lisp" | "job", registry="internal" | "user", ...)
registry_get(id=..., kind=...)
```

Registry metadata is for discovery/selection. MCP `tools/list` remains execution-authoritative for MCP schemas; Lisp execution still goes through verified load and Job execution still goes through the Job runtime contract.

## CI contract

`scripts/validate-lisp-registry.py` verifies User Registry coverage against managed AppData Lisp/Job libraries, including command/path drift, unique IDs, ownership, `ai_mode`, and full managed-library coverage.
