# CadGPT AppData

CadGPT keeps user-owned workflow assets and runtime/generated data separate from installation source.

During Beta the AppData root is repo-local `appdata/`. A packaged build can map the same virtual paths to `%LOCALAPPDATA%\CadGPT` through `CADGPT_APPDATA_ROOT`.

## Layout

```text
appdata/
├── libraries/
│   ├── lisp/                 permanent managed copies of Lisp Libraries
│   └── jobs/                 permanent managed copies of Job Libraries
├── registry/
│   └── user/                 User Registry + managed-library manifest
├── workspace/
│   ├── lisp-draft/           write-lisp working copies
│   └── job-draft/            jobcreate working copies
├── runtime/
│   └── dynamic-lisp/         temporary bounded AI-derived Lisp variants
├── drawings/                 per-drawing Observator/semantic runtime data
│   └── <drawing_id>/
│       └── observator/       JSONL logs selected by Jobs
├── data/
│   └── runs/                 persistent run/test outputs and evidence
├── state/                    internal process state
└── logs/                     diagnostics
```

## Read/write ownership

Generic file tools may read:

```text
appdata/libraries/**
appdata/workspace/**
appdata/data/**
```

Generic file tools may write only:

```text
appdata/workspace/**
appdata/data/**
```

`appdata/libraries/**` is permanent managed content. It must not be mutated with generic `file_create` / `file_edit` because doing so could make implementation diverge from User Registry metadata.

Permanent mutations use controlled operations:

```text
library_import
lisp_promote_draft
job_promote_draft
```

`appdata/registry/**`, `runtime/**`, `drawings/**`, `state/**`, and `logs/**` are internal ownership areas rather than generic writable roots.

## Drawing-scoped Observator data

`drawings/<drawing_id>/` is intentionally separate from the conceptual Current Working Space.

A drawing gets a stable `drawing_id` lazily when Observator first needs metadata for it. The id is carried inside that DWG by the Observator-owned Drawing Anchor. File path/name remain locators only.

The Drawing Anchor is the only CAD entity Observator may create or modify. A completed Observation Job writes/finalizes its AppData records and then updates the anchor exactly once.

The anchor revision is **not** a guarantee that AutoCAD saved the latest in-memory drawing to disk. If an older DWG copy is opened, the anchor revision physically present in that copy describes that copy even when `appdata/drawings/<drawing_id>/` contains newer observation history. Newer AppData must not automatically overwrite or advance the opened drawing's anchor.

## Imported library contract

A user-selected Lisp/Job folder is an **import source only**:

```text
explicitly user-approved external folder (read-only)
→ library_import
→ managed copy in appdata/libraries/**
→ User Registry index
```

CadGPT never writes to the external source folder. Import rejects symlinked source entries, excludes repository metadata such as `.git/.svn`, and enforces bounded file-count/byte-size limits.

After import, execution and normal reading use the managed AppData copy. Editing occurs through workspace drafts. Re-import/update is explicit.

Replacement import is rollback-safe across:

```text
managed library content
+ appdata/registry/user/libraries.json
+ appdata/registry/user/capabilities.json
```

If re-imported implementation bytes differ from the implementation hash stored with a capability, previous semantic/safety claims are invalidated to `needs_review` rather than silently kept as trusted curated metadata.

During Beta, `appdata/libraries/**` and `appdata/registry/user/**` are committed so the repo can simulate an already-imported user environment. Other generated AppData areas remain ignored.

## Registry ownership

```text
Internal Registry  → MCP tools + system skills
User Registry      → managed Lisp + concrete Jobs
```

The effective registry is a unified discovery view, not an override mechanism. User Registry cannot contain tools or system skills and User capability IDs must remain unique.

## Lisp workflow

Import/index never edits Lisp source. When the user explicitly asks `write-lisp` to modify or repair an existing capability:

```text
managed library source
→ lisp_checkout
→ appdata/workspace/lisp-draft/**
→ edit/repair + normalize working header/description
→ static validation
→ user-approved CAD test
→ verified load/runtime verification
→ lisp_promote_draft
→ managed library + User Registry
```

Source syntax errors are reported by checkout but do not block creation of a repair draft. Promotion remains strict. Intentional helper-only Lisp without public `c:` commands is supported.

CadGPT is the default authoring profile. `library_id=tbh-toolkit` is the deliberate exception and keeps the TBH header profile.

`ai_mode=dynamic` does not define another Lisp type. It only allows CadGPT/AI to derive bounded temporary runtime variants from ordinary AutoLISP using declared `dynamic_parameters`.

## Job workflow

Existing reusable Job:

```text
managed Job
→ job_checkout
→ appdata/workspace/job-draft/**
→ edit
→ job_draft_validate
→ approved real execution/test
→ final-result validation
→ explicit user acceptance
→ job_promote_draft
→ managed Job Library + User Registry
```

New Jobs begin directly in the Job draft workspace only after the `jobcreate` planning approval gate.

A Markdown Job definition is not considered a completed reusable Job merely because it parses or dispatches commands. Promotion requires actual test evidence and final-validation evidence.
