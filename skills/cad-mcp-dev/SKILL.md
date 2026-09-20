# Skill: cad-mcp-dev

Status: **development-only**

## Purpose

Develop and repair the local CAD MCP runtime while CadGPT is still under active development.

This Skill is never part of the production packaged capability surface.

## Hard boundary

The only writable **source** tree is the absolute local path resolving to:

```text
<repo>\runtimes\cad-mcp\**
```

Every create/edit/delete/move operation must use an absolute filesystem path. Relative paths, CWD-derived mutation, `..` escape, symlink/junction escape, and fallback to similarly named files are forbidden.

Supporting CadGPT source/contracts may be read when needed, but they are read-only. If a correct change requires editing CadGPT core, stop with `OUT_OF_SCOPE_CORE_CHANGE`.

CadGPT system runtime may persist rollback metadata under:

```text
<appdata>\state\cad-mcp-dev-recovery\**
```

That directory is **not** a coding-agent write scope. It exists only for crash-safe baseline recovery.

## Execution ownership

Only one active `cad-mcp-dev` source execution may exist at a time.

Within that execution, only one `cad-mcp-dev` ToolLease may be active at a time. Do not parallelize source mutations, validation, candidate lifecycle or dependency sync.

Use:

- `execution_path=file` for source-only work;
- `execution_path=hybrid` when live AutoCAD validation will be required;
- never `execution_path=cad` for this Skill.

## Required workflow

1. Start from an explicit current-turn `@cadgpt` admission.
2. Start `skill:cad-mcp-dev` work with FILE or HYBRID execution path.
3. Call `cad_mcp_dev_recovery_status`.
4. If a pending recovery baseline exists from an older execution, do **not** edit source. Recover it first with `cad_mcp_dev_recover`.
5. Reproduce and understand the CAD MCP gap.
6. Read/search runtime source and relevant read-only contracts.
7. Explain the implementation plan and receive user confirmation.
8. Create exactly one `cad_mcp_dev_snapshot` baseline before the first source/environment mutation.
9. Edit only absolute paths under the runtime root.
10. Run `cad_mcp_dev_validate(action=all)` after the final source edit.
11. Regenerate the CAD MCP manifest through validation whenever tool schemas change.
12. Validate the effective public CadGPT tool surface, not only the raw upstream manifest.
13. If live CAD validation is unnecessary, finish with `cad_mcp_dev_accept_local`.
14. If live CAD validation is required:
    - start a candidate with `cad_mcp_dev_candidate_start`;
    - use only normal CadGPT CAD tools on an explicitly approved drawing;
    - require at least one successful live CAD tool as candidate evidence;
    - finish with `cad_mcp_dev_candidate_accept`.
15. If the candidate fails, use `cad_mcp_dev_rollback`.
16. Do not stop/replace the work while an active ToolLease is still running.

If CadGPT/Windows exits before acceptance, the persistent baseline remains. The next development execution must recover it before any new CAD MCP mutation.

## Tool registry

CAD MCP tool source is authoritative. Adding/removing/changing a tool must regenerate:

```text
runtimes/cad-mcp/tool-manifest.json
```

through the named manifest validation action.

`tool-manifest.json` is a generated artifact and must not be hand-edited through generic dev mutation tools.

Outer CadGPT may deliberately wrap/hide raw upstream primitives when execution ownership is required. Examples include drawing activation, Observation capture, destructive preview tokens, and verified Lisp command execution. The effective Internal Registry must describe the **public CadGPT surface**, not expose those raw primitives.

Do not edit CadGPT core registry code or User Registry from this Skill.

## Dependency changes

The Skill may edit dependency declaration/lock files only when those files are themselves under `runtimes/cad-mcp/**`.

- `requirements.lock.txt` accepts exact `package==version` pins only;
- dependency lock edits are source edits and therefore require the crash-safe baseline;
- the Skill does **not** install dependencies and does not write `.venv-cad/**`;
- if a dependency change requires environment installation/rebuild, stop the Skill workflow and hand that step to setup/maintainer authority outside `cad-mcp-dev`.

## Prohibited

- no unrestricted cmd/PowerShell/bash;
- no dependency installation or writes to .venv-cad/**; dependency environment changes remain setup/maintainer authority outside this Skill;
- no Git branch/add/commit/push/PR;
- no generic writes under `src/**`, `skills/**`, `knowledge/**`, `scripts/**`, `appdata/**`, repo-root config, or `.git/**`;
- no direct edit of generated `tool-manifest.json`;
- no mutation before a crash-safe baseline exists;
- no new mutation while foreign recovery is pending;
- no silent self-modification triggered by a CAD failure;
- no production availability.
