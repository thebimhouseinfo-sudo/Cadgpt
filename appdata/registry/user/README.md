# User Registry

User Registry contains only capabilities owned by imported user libraries:

- `kind=lisp`
- `kind=job`

MCP tools and system skills belong to Internal Registry and are generated from CadGPT core/skill metadata; they must never be stored here.

`capabilities.json` references managed assets by `library_id + relative_path`. `libraries.json` records the managed library copies and their import provenance/profile.
