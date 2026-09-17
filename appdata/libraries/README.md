# Managed User Libraries

These directories are CadGPT-owned copies of user-selected Lisp/Job libraries.

```text
lisp/<library-id>/**
jobs/<library-id>/**
```

External source folders are read-only import inputs. After `library_import`, CadGPT works only with these managed AppData copies. Re-import is explicit and source folders are never mutated.

During Beta the seeded TBH assets are committed here to simulate the managed AppData state. A packaged build stores this data in the user's CadGPT AppData rather than installation source.
