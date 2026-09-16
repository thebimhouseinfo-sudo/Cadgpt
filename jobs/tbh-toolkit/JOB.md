# Job: TBH Toolkit Command

Status: **transitional migrated Job**

Source behavior: `CAD-Agent/backend/skills/tbh_toolkit.py`

## Goal

Preserve the existing TBH Toolkit command-dispatch workflow while CadGPT is being migrated. This Job is intentionally generic and may later be split into smaller domain Jobs.

The Job must execute a known TBH AutoLISP command against the explicitly bound drawing using LISP assets under:

```text
lisp/tbh-toolkit/**
```

## Inputs

- `command`: requested TBH command name. Normalize to uppercase.
- bound drawing identity: provided by CadGPT session state.

## Preconditions

- A drawing is explicitly bound to the CadGPT session.
- CAD MCP is connected to the correct CAD host.
- `lisp/tbh-toolkit/**` is available.

## Step 1 — Resolve command

### Instruction

Resolve the requested command against the LISP files in `lisp/tbh-toolkit/**` by locating a matching `(defun C:<COMMAND> ...)` definition.

Do not guess an unknown command.

### Available tools

```text
file.search:lisp
file.read:lisp
```

### Success criteria

- exactly one usable command definition is resolved, or a known deterministic precedence rule selects one;
- the LISP file path is known.

### Failure handling

If the command does not exist, stop and report the command as unknown. Do not create new LISP merely because a command name was not found.

### Output

```text
resolved_command
resolved_lisp_path
```

## Step 2 — Ensure required LISP is loaded

### Instruction

Load the resolved LISP, or the TBH startup loader when that is the established loading mechanism. Use CAD MCP against the bound drawing.

### Available tools

```text
cad.lisp
cad.command
cad.context
```

### Preferred tool

```text
cad.lisp
```

### Success criteria

- CAD MCP reports a successful load, or the command is already available in the bound drawing session.

### Failure handling

If the LISP file cannot be loaded, stop and return the CAD MCP/load error. Do not silently switch to another drawing.

## Step 3 — Execute command

### Instruction

Execute the resolved TBH command on the bound drawing. Preserve the existing command's own interaction model; some legacy TBH commands may still prompt inside AutoCAD.

### Available tools

```text
cad.command
cad.context
```

### Success criteria

- CAD MCP accepts/dispatches the command to the bound drawing.

### Failure handling

Return the command execution error without inventing a fallback command.

## Step 4 — Report execution state

### Instruction

Report whether dispatch succeeded and whether the command completed deterministically or remains interactive inside AutoCAD.

### Available tools

```text
cad.context
cad.validate
```

### Output

At minimum:

```text
command
lisp_path
drawing
load_status
execution_status
interactive_if_applicable
```

## Validation

This transitional Job validates command resolution, correct drawing targeting, LISP loading, and dispatch. It does **not** claim that every arbitrary TBH command has one universal drawing postcondition.

Domain-specific TBH workflows should later become separate Jobs with their own final-result validation.

## Migration note

The old `tbh_toolkit.py` scanned the tool-kit directory and exposed a generic skill that loaded startup LISP then sent a command. CadGPT preserves that behavior temporarily here, but the old Python Skill itself is not the target architecture.
