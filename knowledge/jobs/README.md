# CadGPT Job Knowledge

This directory contains CadGPT's internal Job specification, rules, authoring guidance and runtime semantics.

It does **not** contain concrete user Jobs. Concrete Jobs are imported into managed AppData Job Libraries and registered in User Registry:

```text
appdata/libraries/jobs/<library-id>/**
appdata/registry/user/**
```

CadGPT may run with no user Job Library configured and must still retain this internal knowledge of what a Job is and how it is validated/executed.
