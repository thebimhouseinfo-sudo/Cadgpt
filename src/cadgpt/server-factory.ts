import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFilesystemTools } from "./tools/filesystem.js";
import { registerLibraryTools } from "./tools/libraries.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerSkillTools } from "./tools/skills.js";
import { registerLispHarnessTools } from "./tools/lisp-harness.js";
import { registerLispWorkspaceTools } from "./tools/lisp-workspace.js";
import { registerCapabilityRegistryTools } from "./tools/registry.js";
import { registerCadProxyTools } from "./tools/cad-proxy.js";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "cadgpt", version: "0.1.0" },
    {
      capabilities: { logging: {}, tools: {} },
      instructions: [
        "CadGPT is a drawing-centric AutoCAD execution environment for ChatGPT.",
        "CadGPT core owns MCP tools, system skills and Job knowledge. User Lisp/Job assets are imported as managed copies under AppData libraries.",
        "A user-selected external library folder is a read-only import source. library_import copies it into AppData; all later CadGPT reads/writes use the managed AppData copy and never write back to the source folder.",
        "Internal Registry contains only MCP tools and system skills. User Registry contains only managed Lisp and concrete Jobs. Use registry_list/registry_get as the unified discovery surface.",
        "skills/** and knowledge/** are internal read-only CadGPT knowledge, not user libraries.",
        "Concrete Jobs are loaded from User Registry/AppData with job_list/job_get. Job rules/specification live in internal knowledge/jobs/JOB_RULES.md.",
        "Imported Lisp is indexed without source mutation. Only when the user activates write-lisp for an edit should lisp_checkout create a workspace draft and normalize its header/description.",
        "CadGPT is the default authoring profile for new/edited Lisp. The deliberate exception is library_id=tbh-toolkit, which keeps the TBH header profile.",
        "New Lisp work uses appdata/workspace/lisp-draft/**, then static validation, an explicitly approved CAD test drawing, verified load/runtime verification, and lisp_promote_draft into a managed AppData Lisp Library.",
        "ai_mode=dynamic describes bounded AI adaptation of normal AutoLISP into temporary runtime variants; dynamic is not a Lisp source type.",
        "Never assume AutoCAD ActiveDocument is the CadGPT target drawing. Use drawing_list/drawing_bind and preserve explicit drawing binding.",
        "CAD tool descriptors are stable while CAD MCP sleeps; backend availability changes without changing the ChatGPT tool surface.",
      ].join("\n"),
    }
  );

  registerFilesystemTools(server);
  registerLibraryTools(server);
  registerJobTools(server);
  registerSkillTools(server);
  registerLispHarnessTools(server);
  registerLispWorkspaceTools(server);
  registerCapabilityRegistryTools(server);
  registerCadProxyTools(server);

  return server;
}
