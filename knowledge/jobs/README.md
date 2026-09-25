# CadGPT Job Knowledge

This directory contains CadGPT's internal Job specification, rules, authoring guidance and runtime semantics.

It does **not** contain concrete user Jobs. Concrete Jobs are imported into managed AppData Job Libraries and registered in User Registry:

```text
appdata/libraries/jobs/<library-id>/**
appdata/registry/user/**
```

CadGPT may run with no user Job Library configured and must still retain this internal knowledge of what a Job is and how it is validated/executed.

## Job execution modes

- `.py` — Direct Job. Resolve the registered script and dispatch it directly; do not add model planning between its internal operations.
- `.md` — Reasoning Job. Follow the workflow sequentially and use `REASONING_HARNESS.md` at each dynamic stage: READ → PLAN → REVIEW → REVISE if needed → EXEC → READBACK → NEXT. Later steps may depend on the changed drawing state, so do not require one upfront whole-workflow plan.
