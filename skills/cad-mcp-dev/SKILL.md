# Skill: cad-mcp-dev

Status: **development-only**

## Purpose

Develop and repair the local CAD MCP runtime while CadGPT is still under active development.

This Skill is never part of the production packaged capability surface.

## Hard boundary

The only writable source tree is the absolute local path resolving to:

```text
<repo>\runtimes\cad-mcp\**
```

Every create/edit/delete/move operation must use an absolute filesystem path. Relative paths, CWD-derived mutation, `..` escape, symlink/junction escape, and fallback to similarly named files are forbidden.

Supporting CadGPT source/contracts may be read when needed, but they are read-only. If a correct change requires editing CadGPT core, stop with `OUT_OF_SCOPE_CORE_CHANGE`.

## Workflow

1. Reproduce and understand the CAD MCP gap.
2. Read/search runtime source and relevant read-only contracts.
3. Explain the implementation plan and receive user confirmation.
4. Start `skill:cad-mcp-dev` work with FILE or HYBRID execution path.
5. Create an in-memory source snapshot.
6. Edit only absolute paths under the runtime root.
7. Run compile/import validation.
8. Regenerate the CAD MCP manifest when tool schemas change.
9. Validate the effective tool surface.
10. When live CAD validation is necessary, use the normal CAD path and an explicitly approved test drawing.
11. Roll back to the snapshot if the candidate fails.
12. Stop when the local runtime source is validated and accepted.

## Tool registry

CAD MCP tool source is authoritative. Adding/removing/changing a tool must regenerate:

```text
runtimes/cad-mcp/tool-manifest.json
```

through the named manifest validation action. Do not edit CadGPT core registry code or User Registry.

## Prohibited

- no unrestricted cmd/PowerShell/bash;
- no Git branch/add/commit/push/PR;
- no writes under `src/**`, `skills/**`, `knowledge/**`, `scripts/**`, `appdata/**`, repo-root config, or `.git/**`;
- no silent self-modification triggered by a CAD failure;
- no production availability.
