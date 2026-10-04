# CadGPT Drawing Anchor

Status: **canonical shared drawing-persistence contract**

## Purpose

Drawing Anchor is CadGPT's durable identity for a DWG.

CadGPT keeps two identities deliberately separate:

```text
drawing_id
= execution/runtime drawing-context identity
= may change after close/reopen/rebind

drawing_anchor
= durable identity persisted inside the DWG
= survives rename/move/copy/Save As
```

The anchor is common CadGPT infrastructure. It is not owned by Observator or by any individual Job.

## Bind-time lifecycle

Every successful CadGPT drawing bind must ensure the canonical Drawing Anchor before reporting the drawing as ready.

```text
bind exact AutoCAD document
→ check CADGPT_DRAWING_ANCHOR
   ├─ exists and schema is valid
   │  → read drawing_anchor
   │  → do not rewrite it
   └─ missing
      → generate drawing_anchor
      → write canonical XRecord
      → read back and verify
→ attach drawing_anchor to the runtime bound-drawing context
```

Binding does **not** create the external drawing metadata folder.

The bind remains protected by AutoCAD's lifetime `runtime_document_identity`; `drawing_anchor` is durable identity, not a replacement for live-document identity checks.

## V1 drawing_anchor

V1 uses:

```text
<origin-name>-<HHMMSS>-<DDMMYY>-<8hex>
```

Example:

```text
Bowhotel-143527-100826-a91f27c4
```

The origin portion is normalized to an ASCII-safe path segment. The random suffix prevents same-name/same-second collisions.

The value is generated once. Rename, move, copy, or Save As must not regenerate it.

## Physical representation

V1 is stored as a non-graphical XRecord inside CadGPT's own dictionary under AutoCAD's Named Objects Dictionary.

```text
Named Objects Dictionary
└── CADGPT_PERSISTENCE          [DICTIONARY, hard-owner entries]
    └── CADGPT_DRAWING_ANCHOR   [XRecord]
        ├── DXF 90 → schema_version = 1
        └── DXF 1  → drawing_anchor
```

The canonical dictionary uses DXF group 280 = 1 so its entries are treated as hard-owned. The XRecord is therefore owned by CadGPT's persistence dictionary instead of being a loose drawing entity.

Canonical XRecord key:

```text
CADGPT_DRAWING_ANCHOR
```

Canonical payload fields:

```text
schema_version
drawing_anchor
```

No Job/business metadata belongs in the anchor.

### Core-private storage adapter

CadGPT performs the actual dictionary/XRecord mutation through:

```text
resources/cad/core-lisp/drawing-anchor.lsp
```

This Lisp is a core-private implementation detail, not a Registry capability and not a Job-owned helper. Python/CAD MCP activates the exact bound drawing, verified-loads this Lisp, and performs a read-only anchor probe first. If the canonical anchor already exists, the existing value is returned and no write occurs. Only when the anchor is missing does CadGPT generate/reuse a candidate and call the Lisp ensure function.

The previous NOD-extension-dictionary layout is migration-only. If a valid legacy anchor is found, CadGPT writes that same value once into the canonical `CADGPT_PERSISTENCE` dictionary. Migration must never generate a replacement identity for a drawing that already carries a valid legacy anchor.

The Lisp owns native DWG dictionary/XRecord read/write. Python must not construct XRecord SAFEARRAY/VARIANT payloads through COM for Drawing Anchor persistence.

This representation must remain:

- non-graphical;
- invisible to ordinary SELECT/DELETE geometry workflows;
- protected by dictionary ownership from ordinary PURGE workflows;
- readable without scanning drawing geometry;
- compatible with AutoCAD ObjectARX/.NET/ActiveX/AutoLISP dictionary/XRecord access.

CadGPT must never toggle AutoCAD's global UNDO mode as a workaround. The normal contract is write-once/read-many: every bind first reads the anchor; an existing canonical anchor is never rewritten. If no anchor exists, CadGPT creates it once and verifies the read-back. If the same live bound context truly loses its XRecord, its cached `drawing_anchor` may be supplied as the preferred value so recovery preserves identity instead of generating a different one.

## External metadata root

Persistent drawing-scoped data lives under:

```text
%LOCALAPPDATA%\CadGPT\drawings\<drawing_anchor>\
```

The model/Job must **not** construct this path itself.

A Job that needs persistent drawing metadata must call:

```text
drawing_metadata_location
```

The tool:

1. resolves the exact bound drawing;
2. re-ensures and validates its Drawing Anchor;
3. computes the canonical `drawings/<drawing_anchor>/` path;
4. returns the existing directory, or creates it if absent;
5. authorizes only that exact drawing folder for generic `file_*` access in the current execution.

If the folder already exists, the tool returns it and does not register it for cleanup.

If the tool creates the folder, it records that exact directory as the execution's `last_created_metadata_folder`. A later newly-created drawing metadata folder overwrites that one cleanup candidate; no cleanup history is kept.

## Empty-folder cleanup

When the execution ends:

```text
last_created_metadata_folder absent
→ nothing

last_created_metadata_folder present
├─ still empty     → delete that one directory
└─ contains data   → keep it
```

Cleanup never scans `drawings/**`, never deletes a folder that merely existed before the execution, and never recursively deletes a non-empty folder.

## Job contract

Jobs use `drawing_anchor` only through the shared CadGPT persistence tools.

Jobs must not:

- derive durable identity from filename/path;
- use runtime `drawing_id`, work id, or session id as persistent identity;
- invent another anchor format;
- construct `%LOCALAPPDATA%\CadGPT\drawings\...` themselves;
- create parallel filename-keyed storage;
- write drawing products inside the Job package.

Each Job may own its own subfolder/schema beneath the tool-returned drawing root.
