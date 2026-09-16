# CadGPT AppData

CadGPT keeps user-owned workflow assets and runtime/generated data separate from installation source.

During Beta the AppData root is repo-local `appdata/`. A packaged build can map the same virtual paths to `%LOCALAPPDATA%\CadGPT` through `CADGPT_APPDATA_ROOT`.

## Layout

```text
appdata/
├── libraries/
│   ├── lisp/                 managed copies of imported Lisp Libraries
│   └── jobs/                 managed copies of imported Job Libraries
├── registry/
│   └── user/                 User Registry + managed-library manifest
├── workspace/
│   ├── lisp-draft/           write-lisp working copies
│   └── job-draft/            future Job authoring workspace
├── runtime/
│   └── dynamic-lisp/         temporary AI-derived Lisp variants
├── drawings/                 per-drawing Observator/semantic runtime data
│   └── <drawing_id>/
│       └── observator/       JSONL logs selected by future Jobs
├── data/
│   └── runs/                 persistent run outputs/evidence
├── state/                    internal process state
└── logs/                     diagnostics
```

`drawings/<drawing_id>/` is intentionally separate from the conceptual Current Working Space. A drawing's stable identity will later map a reopened DWG back to this directory. Observator V1 only provides the per-drawing storage primitive; drawing-anchor creation/reconciliation is a separate concern.

## Imported library contract

A user-selected Lisp/Job folder is an **import source only**:

```text
external user folder (read-only)
→ library_import
→ managed copy in appdata/libraries/**
→ User Registry index
```

CadGPT never writes to the external source folder. After import, execution, reading, editing, testing and registration use the managed AppData copy. Re-import/update is explicit.

During Beta, `appdata/libraries/**` and `appdata/registry/user/**` are committed so the repo can simulate an already-imported user environment. Other generated AppData areas remain ignored.

## Registry ownership

```text
Internal Registry  → MCP tools + system skills
User Registry      → managed Lisp + concrete Jobs
```

The effective registry is a unified discovery view, not an override mechanism. User Registry cannot contain tools or system skills.

## Lisp workflow

Import/index never edits Lisp source. When the user explicitly asks `write-lisp` to modify an existing capability:

```text
managed library source
→ lisp_checkout
→ appdata/workspace/lisp-draft/**
→ normalize working header/description
→ static validation
→ user-approved CAD test
→ verified load/runtime verification
→ lisp_promote_draft
→ managed library + User Registry
```

CadGPT is the default authoring profile. `library_id=tbh-toolkit` is the deliberate exception and keeps the TBH header profile.

`ai_mode=dynamic` does not define another Lisp type. It only allows CadGPT/AI to derive bounded temporary runtime variants from ordinary AutoLISP using declared `dynamic_parameters`.
