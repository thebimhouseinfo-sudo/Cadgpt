# User Registry

User Registry contains only capabilities owned by user-created/imported libraries. Repo-bundled/install capabilities such as TBH Tool Kit belong to Internal Registry and must not be duplicated here:

- `kind=lisp`
- `kind=job`

MCP tools and system skills belong to Internal Registry and are generated from CadGPT core/skill metadata; they must never be stored here.

`capabilities.json` references managed assets by `library_id + relative_path`. `libraries.json` records the managed library copies and their import provenance/profile.
