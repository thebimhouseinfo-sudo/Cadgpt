# write-lisp Harness

The harness is intentionally small and AutoLISP-specific. It is not a generic build/test framework.

## Gate 1 — Static source validation

Tool: `lisp_validate`

Checks currently include:

- comment/string-aware parenthesis structure;
- unclosed strings;
- unmatched opening/closing parentheses with source locations;
- public `c:` command extraction;
- function extraction;
- optional expected-command contract;
- duplicate public command definitions;
- warning when COM/VLA/VLAX APIs appear without `(vl-load-com)`;
- warning when `setvar` is used without a local `*error*` handler;
- warning when `(command)` / `(command-s)` is used so the caller verifies that a direct DXF/VLA API is not more appropriate.

The result includes a SHA-256 fingerprint of the validated source so the caller can identify exactly which text passed the static gate.

This validator is a structural reader-aware gate, not a full AutoLISP evaluator.

## Gate 2 — AutoCAD load

Tool: `cad__cad_load_lisp_file`

Only repository `.lsp` files under `lisp/**` can be loaded. Passing Gate 1 is required before load.

A successful queue/send is not sufficient proof that the file behaves correctly.

## Gate 3 — Runtime command execution

Tool: `cad__cad_run_lisp_command`

Run only when the command has a deterministic, safe invocation path. Interactive or destructive legacy commands may require a workflow-specific test strategy.

Do not auto-replay after uncertain transport failure.

## Gate 4 — Drawing postcondition

Use structured CAD MCP inspection to verify the real result in the explicitly bound drawing.

Examples:

- layer/object-type inventory;
- entity handles and properties;
- nested block/internal entity layers;
- block attributes;
- remaining source/review/detail entities;
- target layer existence and counts.

This is the true completion gate. Source validation and command dispatch are only intermediate evidence.

## Debug cycle

```text
static fail  -> inspect source -> patch -> static gate again
load fail    -> inspect load/path/dependency -> patch -> static -> reload
runtime fail -> classify AutoLISP/DXF/COM/drawing-state error -> patch narrowly
result fail  -> inspect actual CAD state/rule/data -> patch only the responsible logic
```

The harness does not provide generic unit-test, package, dependency, release, or Git gates because those do not fit CadGPT's AutoLISP specialization.
