# Cadgpt — existing implementation boundaries

This records current implementation facts for setup, without choosing a new architecture. Product theory remains exclusively in `docs/CRITERIA.md`; the imported candidate plan and provisional milestones do not authorize coding.

`src/index.ts` starts the loopback Express MCP control plane with a private path token. `src/cadgpt/` supplies admission, logical sessions, Work authority, owner-scoped FILE operations, registry, Jobs and Lisp. Capabilities load lazily. One work binds one drawing; ambient ActiveDocument is not authority.

`runtimes/cad-mcp/` is the Python/Windows COM bridge to AutoCAD. Its tracked manifest supplies tool descriptions while CAD sleeps. `addins/cadgpt-autocad/` hosts the chat UI, not drawing/Work authority. Windows tray/tunnel scripts handle desktop lifecycle/connectivity. No second planner is introduced.

Development data uses external `/workspace/cadgpt-data`. Source ownership, Registry publication and DWG Save remain distinct. Never widen generic FILE writes to all AppData. Linux source/MCP checks cannot prove native command completion or persisted DWG changes; Windows acceptance uses copied drawings.

Reference source and status: `.agents/knowledge/cadgpt-gsa/source-provenance.json` and `HANDOFF_20261021_P0_REOPENED.md` in the same directory. The current PHASE0_CLOSURE.md verdict closes source investigation and supersedes the historical reopened handoff; implementation defects and native acceptance remain outstanding. No technical direction change is made by Bootstrap.
