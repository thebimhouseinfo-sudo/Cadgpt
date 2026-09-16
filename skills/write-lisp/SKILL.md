# Skill: write-lisp

Status: **active system Skill contract; harness implementation pending migration**

`write-lisp` is CadGPT's specialized AutoLISP/Visual LISP coding capability. It is not a CAD business Job and not a generic coding agent.

Its purpose is to safely inspect, create, patch, test, load, and verify AutoLISP required by Jobs.

Legacy sources to extract from:

- `CAD-Agent/backend/skills/lisp_coder_SKILL.md`
- `CAD-Agent/backend/agents/operator/skills/lisp_coder.py`
- selected TBH AutoLISP guidelines/patterns
- selected OpenLISP validation components if they materially improve the harness

## Core rule

> Search first. Patch before rewrite. Validate before load. Test on the bound drawing before returning control to the Job.

## Allowed workspace

Normal write-lisp file operations are restricted to:

```text
lisp/**
```

The Skill must use CadGPT sandboxed file tools rather than unrestricted Python/filesystem access.

## Available tools

```text
file.list:lisp
file.search:lisp
file.read:lisp
file.create:lisp
file.patch:lisp
cad.context
cad.query
cad.lisp
cad.command
cad.validate
```

A Job may expose a narrower subset when invoking this Skill.

## Workflow

### 1. Understand the required behavior

Use the calling Job step, current structured CAD evidence, existing LISP contract, and expected postconditions.

Do not infer unrelated business rules.

### 2. Search existing LISP

Search `lisp/**` before creating a file.

Prefer in order:

1. reuse existing command unchanged;
2. patch the smallest relevant implementation;
3. extend a reusable implementation;
4. create a new LISP only when no suitable implementation exists.

### 3. Read before editing

Before patching a file:

- read the complete relevant command/function region;
- inspect referenced helpers when needed;
- preserve public command names unless the Job explicitly requires a contract change;
- preserve unrelated behavior.

### 4. Write or patch

Apply AutoLISP/Visual LISP coding discipline.

Baseline rules migrated from the old LISP coder:

- use `(vl-load-com)` when Visual LISP/COM is required;
- namespace helper functions with a module-specific prefix;
- declare local variables in the defun `/` section;
- restore modified system variables on normal completion and error/cancel paths;
- use guarded COM calls where failure is possible;
- prefer data/config changes over algorithm rewrites when the current engine already supports the requested behavior;
- prefer non-interactive automation for Job-driven batch work unless interaction is intrinsic to the command;
- use explicit undo/error boundaries for mutating commands where appropriate;
- avoid hard-coded project-specific values when they belong in Job rules or mapping data.

## Harness

The Skill must not declare a LISP ready based only on text generation.

### Stage A — static validation

At minimum validate:

- balanced Lisp structure using a parser/token-aware method when available;
- string literal closure;
- command/function definitions expected by the calling Job;
- obvious malformed source;
- required coding contract for the specific file where applicable.

The old coder's raw `code.count("(")` / `code.count(")")` check may be retained only as a fallback smoke check, not as the final validator because parentheses inside strings/comments can produce false results.

### Stage B — load validation

Load/reload the changed file through CAD MCP against the explicitly bound drawing.

Failure to load returns control to write-lisp for correction; do not let the parent Job continue as if the automation were ready.

### Stage C — execution test

When safe and when the calling Job provides a testable case:

- execute the command or target helper path;
- capture structured CAD MCP result/error;
- inspect the affected drawing state.

### Stage D — postcondition validation

Use the calling Job's expected result where possible.

Examples:

- target entity count changed as expected;
- unwanted entity/layer combination is gone;
- target layer/property exists;
- command completed without leaving partial state.

A successful load is not sufficient when the Job requires a drawing-state result.

## Error handling

If a patch fails:

1. preserve the existing file state where possible;
2. report the failing harness stage;
3. inspect the actual error;
4. patch only the needed logic;
5. rerun validation from the appropriate stage.

Do not repeatedly rewrite the whole file to chase a small runtime error.

## Relationship to Jobs

A Job calls `write-lisp` when:

- required automation does not exist;
- existing automation cannot satisfy the current step;
- a controlled source patch is needed.

After write-lisp passes its harness, control returns to the exact Job step that invoked it.

```text
Job step
   ↓
automation missing / insufficient
   ↓
write-lisp
   ↓
search → read → patch/create → static validate → CAD load → test → validate
   ↓
return to same Job step
```

## Legacy behavior intentionally not carried forward as architecture

The old LISP coder directly manipulated `tool-kit/temp/`, moved files after user confirmation, and owned broad local filesystem operations. CadGPT replaces that with sandboxed `file.*` tools under `lisp/**`.

Draft/approval states may be added later if a concrete workflow needs them, but they are not required as a global write-lisp architecture rule.
