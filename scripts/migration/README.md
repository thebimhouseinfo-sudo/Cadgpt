# Migration scripts

These scripts are development/migration utilities. They are not part of the normal CadGPT end-user startup path.

## TBH Toolkit

`migrate-tbh-toolkit.ps1` copies the complete `tool-kit/` folder from a local clone of `thebimhouseinfo-sudo/CAD-Agent` into:

```text
lisp/tbh-toolkit/
```

The source repository is private, so CadGPT intentionally does not depend on cross-repository GitHub Actions credentials for this migration.

Default expected sibling layout:

```text
<parent>/
├── CAD-Agent/
└── Cadgpt/
```

Dry run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migration/migrate-tbh-toolkit.ps1 -DryRun
```

Copy + SHA256 verification:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migration/migrate-tbh-toolkit.ps1
```

Custom source clone location:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migration/migrate-tbh-toolkit.ps1 -SourceRepo "D:\dev\CAD-Agent"
```

Rules:

- preserve every source file and its relative path;
- do not refactor AutoLISP during migration;
- overwrite destination copies from the selected source commit so migration is deterministic;
- verify every copied file by SHA256;
- write `lisp/tbh-toolkit/MIGRATION_PROVENANCE.md` with source commit and file count;
- review and commit the resulting asset changes separately from later AutoLISP edits.

Existing files such as `Setup Xref` are intentionally overwritten from the chosen source clone during the migration so the target pack matches one exact CAD-Agent commit.
