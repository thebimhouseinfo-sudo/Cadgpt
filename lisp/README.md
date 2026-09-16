# Permanent AutoLISP Library

`lisp/**` is CadGPT's **permanent, reusable AutoLISP library**.

Files here are source-controlled capabilities intended to be discovered through the semantic Lisp registry. Every user-facing `.lsp` under this tree must have a matching entry in `registry/lisp-registry.json`.

Do not use this directory as a scratch workspace.

AutoLISP being authored, debugged, or tested before acceptance belongs under:

```text
appdata/lisp-draft/**
```

Parameterized/session-only Lisp artifacts belong under CadGPT runtime AppData rather than the permanent library.

Reusable AutoLISP belongs here rather than inside Job folders. Job-specific orchestration belongs under `jobs/**`.
