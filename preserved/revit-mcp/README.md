# Preserved Revit MCP

This directory preserves the old CAD-Agent Revit MCP implementation as source material for a future **RevitGPT** project.

It is deliberately **inactive** in CadGPT.

CadGPT must not:

- import code from this directory;
- start any Revit MCP process from this directory;
- expose Revit tools through the CadGPT MCP surface;
- add this directory to the active build/runtime dependency graph.

## Layout

```text
preserved/revit-mcp/
├── README.md
├── MIGRATION_PROVENANCE.md
└── source/                     # preserved Revit-mcp source mirror
```

`source/**` is produced from:

```text
CAD-Agent/runtimes/Revit-mcp/**
```

using the local preservation script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass \
  -File scripts/migration/preserve-revit-mcp.ps1
```

The source repository is private, so preservation is performed from a trusted local clone rather than by adding cross-repository credentials to CadGPT CI.

## Preservation rules

- preserve source/config/project/documentation files and their relative paths;
- do not refactor Revit source during preservation;
- exclude generated caches/build outputs such as `__pycache__`, `bin`, `obj`, logs, temporary files and compiled Python artifacts;
- SHA256-verify every preserved file;
- remove only stale files inside the dedicated `source/**` mirror so it represents one selected CAD-Agent commit;
- write source commit and counts into `MIGRATION_PROVENANCE.md`.

The preserved source is not expected to build or run as part of CadGPT. Any modernization, cleanup, or product architecture work belongs to the future RevitGPT repository.
