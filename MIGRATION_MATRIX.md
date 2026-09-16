# CadGPT Migration Matrix

Status: **Phase 1 inventory / first migration pass**

Source repository: `thebimhouseinfo-sudo/CAD-Agent`

This matrix is based on the actual current source tree. The old repository is an implementation source, not an architecture authority.

## Classification

- **KEEP** — useful as-is or nearly as-is.
- **ADAPT** — preserve behavior but change boundaries/API for CadGPT.
- **EXTRACT** — only selected logic/guidance is needed.
- **PRESERVE** — retain source for future work but do not activate in CadGPT.
- **DROP** — do not carry into the active CadGPT product.

## Matrix

| CAD-Agent source | Class | CadGPT target | First-pass decision |
|---|---|---|---|
| `runtimes/cad-mcp/` | KEEP / ADAPT | `runtimes/cad-mcp/` | Active runtime. Migrate source, tests, capabilities and bridge source. Exclude caches/build output and old assistant/dev configuration. Preserve behavior before API cleanup. |
| `runtimes/cad-mcp/services/` | KEEP | `runtimes/cad-mcp/services/` | Core CAD services remain runtime implementation. |
| `runtimes/cad-mcp/tools/` | KEEP / ADAPT | `runtimes/cad-mcp/tools/` | Preserve current tools first; later normalize the external CadGPT MCP surface. |
| `runtimes/cad-mcp/connection/` | KEEP / ADAPT | `runtimes/cad-mcp/connection/` | Preserve host/session connection logic; later enforce bound-document identity. |
| `runtimes/cad-mcp/adapters/` | KEEP / ADAPT | `runtimes/cad-mcp/adapters/` | Keep current supported CAD adapter(s). |
| `runtimes/cad-mcp/bridge/` source | KEEP | `runtimes/cad-mcp/bridge/` | Preserve bridge source/project required for CAD integration. Do not migrate `bin/` or `obj/`. |
| `runtimes/cad-mcp/capabilities.json` | KEEP / ADAPT | `runtimes/cad-mcp/capabilities.json` | Useful runtime capability inventory; later align with CadGPT tool contract. |
| `runtimes/cad-mcp/tests/` | KEEP | `runtimes/cad-mcp/tests/` | Retain meaningful source tests; discard `__pycache__`. |
| `runtimes/cad-mcp/skills/cad-mcp-workflows/` | EXTRACT | `jobs/**`, docs, or tests | Do not preserve as a runtime Skill hierarchy. Extract useful workflow/reference material into Jobs or validation docs. |
| `runtimes/Revit-mcp/` | PRESERVE | `preserved/revit-mcp/` | Keep for future RevitGPT. No active CadGPT registration/startup dependency. |
| `runtimes/openlisp/` | EXTRACT | `skills/write-lisp/harness/` | OpenLISP is not a runtime. Inspect and copy only useful validation/testing components. |
| `backend/skills/lisp_coder_SKILL.md` | EXTRACT | `skills/write-lisp/` | Reuse AutoLISP coding knowledge and patterns; remove old tool-kit temp/confirm assumptions where they conflict with new file tools. |
| `backend/agents/operator/skills/lisp_coder.py` | EXTRACT | `skills/write-lisp/harness/` + new file tools | Reuse syntax checks and workflow ideas. Replace direct filesystem mutations with sandboxed `file.*` tools. |
| `backend/skills/tbh_toolkit.py` | ADAPT | `jobs/tbh-toolkit/JOB.md` | Convert old CAD Skill behavior into a temporary legacy Job. It resolves and runs TBH commands; later split into smaller business Jobs where useful. |
| `tool-kit/` AutoLISP/DCL assets | KEEP | `lisp/tbh-toolkit/` | Migrate largely as-is first. Do not reorganize aggressively until CadGPT is running reliably. |
| `tool-kit/AI AutoLISP Guidelines.md` | EXTRACT | `skills/write-lisp/coding-rules/` | Treat as coding guidance, not runtime LISP. |
| `tool-kit/BLL_LOG_NOW.txt` and transient logs | DROP | — | Historical/transient logs are not product assets. |
| empty/temp files under `tool-kit/` | DROP | — | Do not migrate empty scratch artifacts unless a runtime dependency is proven. |
| `backend/agents/operator/` | EXTRACT | Job/runtime orchestration as needed | Do not preserve Operator as an agent. Extract only execution behavior that remains useful. |
| `backend/agents/chat/` | DROP / EXTRACT | optional future capability | No separate Chat agent in CadGPT. Extract only clearly reusable CAD-assistance logic if later needed. |
| `backend/agents/observer/` | DROP / EXTRACT | optional future observer capability | No separate Observer agent. Event logic may be extracted later if useful. |
| `backend/registry/` | REPLACE / EXTRACT | `job_runtime`, `skill_runtime`, tool registration | Old multi-agent capability registry is broader than required. Reuse small scanning ideas only if helpful. |
| `backend/providers/` | DROP | — | No Ollama/Anthropic/OpenAI-compatible local model layer. ChatGPT is the reasoning layer. |
| `frontend/` | DROP | — | CadGPT has no separate UI. |
| `backend/memory/`, `backend/knowledge/` | DROP initially | — | No independent memory/knowledge subsystem until a concrete CadGPT workflow requires it. |
| `.venv311/`, `.vs/`, `__pycache__/`, runtime logs | DROP | — | Never migrate local environments, IDE state, bytecode caches or generated logs. |

## Migration order

1. Clean-copy active `cad-mcp` source without generated artifacts.
2. Preserve Revit MCP separately.
3. Move TBH Toolkit assets into `lisp/tbh-toolkit/` with minimal restructuring.
4. Convert existing CAD Skill behavior into temporary Jobs where appropriate.
5. Build `write-lisp` from the old LISP coder guidance + new sandboxed file tools + CAD MCP test loop.
6. Add ChatGPT connector and stable Secure MCP Tunnel startup.
7. Add `setup.bat` and `run.bat`; stabilize BAT deployment before EXE packaging.
8. Only after end-to-end stability, reorganize Jobs/LISP for cleanliness.

## Migration invariant

> Phase 1 prioritizes preserving working behavior over perfect organization. Existing CAD workflows may enter `jobs/**` in transitional form, and TBH Toolkit may enter `lisp/tbh-toolkit/**` largely as-is. Structural cleanup happens after CadGPT can install, connect, execute, validate, and reconnect reliably.
