# Migration scripts

These scripts are development/migration utilities. They are not part of the normal CadGPT end-user startup path.

The source repository `thebimhouseinfo-sudo/CAD-Agent` is private, so CadGPT intentionally avoids adding cross-repository GitHub Actions credentials just to perform one-time source preservation. Run these scripts from trusted local clones instead.

Default expected sibling layout:

```text
<parent>/
├── CAD-Agent/
└── Cadgpt/
```

Both scripts accept `-SourceRepo` when the old repository is stored elsewhere.

---

## TBH Toolkit

`migrate-tbh-toolkit.ps1` mirrors the complete:

```text
CAD-Agent/tool-kit/**
```

into:

```text
Cadgpt/lisp/tbh-toolkit/**
```

Dry run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass \
  -File scripts/migration/migrate-tbh-toolkit.ps1 -DryRun
```

Exact mirror + SHA256 verification:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass \
  -File scripts/migration/migrate-tbh-toolkit.ps1
```

Custom source clone location:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass \
  -File scripts/migration/migrate-tbh-toolkit.ps1 \
  -SourceRepo "D:\dev\CAD-Agent"
```

Rules:

- preserve every source file and relative path;
- do not refactor AutoLISP during migration;
- overwrite destination copies from the selected source commit;
- remove stale destination-only files **individually** inside `lisp/tbh-toolkit/**`;
- never recursively delete the Toolkit root;
- verify every copied file by SHA256;
- verify destination/source file counts match;
- write `lisp/tbh-toolkit/MIGRATION_PROVENANCE.md` with source commit and counts;
- review and commit the resulting asset changes separately from later AutoLISP edits.

Existing partial copies such as `Setup Xref` are intentionally replaced by the selected source clone so the migrated Toolkit represents one exact CAD-Agent commit.

---

## Revit MCP preservation

`preserve-revit-mcp.ps1` preserves the old:

```text
CAD-Agent/runtimes/Revit-mcp/**
```

under:

```text
Cadgpt/preserved/revit-mcp/source/**
```

Dry run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass \
  -File scripts/migration/preserve-revit-mcp.ps1 -DryRun
```

Preserve + SHA256 verification:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass \
  -File scripts/migration/preserve-revit-mcp.ps1
```

The script deliberately excludes generated artifacts such as:

```text
__pycache__
.pytest_cache
.mypy_cache
.ruff_cache
.vs
bin
obj
logs
node_modules
*.pyc
*.pyo
*.log
*.tmp
*.pdb
```

Rules:

- preserve source/config/project/documentation files and relative paths;
- do not refactor Revit source during preservation;
- remove stale files only inside `preserved/revit-mcp/source/**`;
- verify every preserved file by SHA256 and compare file counts;
- write `preserved/revit-mcp/MIGRATION_PROVENANCE.md`;
- keep the entire preserved tree inactive in CadGPT runtime/startup/build;
- future Revit cleanup belongs to RevitGPT, not CadGPT.

After either script runs, review `git status` and commit the generated asset/preservation changes before calling that migration complete.
