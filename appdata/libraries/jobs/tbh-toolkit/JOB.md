# Job: TBH Toolkit Command

Status: **transitional migrated Job**

Source behavior: `CAD-Agent/backend/skills/tbh_toolkit.py`

## Goal

Preserve the existing TBH Toolkit command-dispatch workflow while CadGPT is being migrated. This Job is intentionally generic and may later be split into smaller domain Jobs.

The Job must execute a known TBH AutoLISP command against the explicitly bound drawing using the managed TBH Lisp Library in CadGPT AppData.

## Inputs

- `command`: requested TBH command name. Normalize to uppercase.
- bound drawing identity: provided by CadGPT session state.

## Preconditions

- A drawing is explicitly bound to the CadGPT session.
- CAD MCP is connected to the correct CAD host.
- User Registry contains the `tbh-toolkit` Lisp Library.

## Step 1 — Resolve command

Resolve the requested command through User Registry metadata for `library_id=tbh-toolkit`. Do not guess an unknown command.

### Success criteria

- exactly one usable command definition is resolved, or a known deterministic precedence rule selects one;
- the managed AppData Lisp path is known.

### Failure handling

If the command does not exist, stop and report the command as unknown. Do not create new Lisp merely because a command name was not found.

## Step 2 — Ensure required Lisp is loaded

Load the resolved managed Lisp through CAD MCP verified load against the bound drawing.

### Success criteria

- CAD MCP reports a successful verified load, or the command is already available in the bound drawing session.

### Failure handling

If the Lisp cannot be loaded, stop and return the CAD MCP/load error. Do not silently switch drawings.

## Step 3 — Execute command

Execute the resolved TBH command on the bound drawing. Preserve the command's own interaction model; some legacy TBH commands may still prompt inside AutoCAD.

## Step 4 — Report execution state

Report command, registry capability id, managed Lisp path, drawing, load status, execution status, and whether manual interaction remains.

## Validation

This transitional Job validates command resolution, correct drawing targeting, Lisp loading, and dispatch. It does not claim a universal postcondition for arbitrary TBH commands.

Domain-specific TBH workflows should later become separate Jobs with their own final-result validation.
