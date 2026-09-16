import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFilesystemTools } from "./tools/filesystem.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerSkillTools } from "./tools/skills.js";
import { registerLispHarnessTools } from "./tools/lisp-harness.js";
import { registerCadProxyTools } from "./tools/cad-proxy.js";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "cadgpt",
      version: "0.1.0",
    },
    {
      capabilities: {
        logging: {},
        tools: { listChanged: true },
      },
      instructions: [
        "CadGPT is a drawing-centric AutoCAD execution environment for ChatGPT.",
        "Local file tools are strictly sandboxed to lisp/** and jobs/**.",
        "skills/** is read-only guidance and can only be accessed through skill_list/skill_get.",
        "Never assume that AutoCAD ActiveDocument is the CadGPT target drawing.",
        "Use drawing_list and drawing_bind to explicitly bind the target drawing before any CAD business operation; changing AutoCAD tabs does not change that binding.",
        "Jobs define repeatable CAD workflows; load them with job_list/job_get and follow each step's explicit available_tools contract.",
        "write-lisp is a specialized AutoLISP coding capability, not a generic application-development agent. Load its relevant coding-skills resources before non-trivial Lisp work.",
        "Every changed .lsp must pass lisp_validate before cad__cad_load_lisp_file; successful load/run still requires structured CAD postcondition verification.",
        "Proxied CAD business tools are exposed as cad__<upstream-tool-name> and CadGPT re-establishes the bound drawing before each call.",
      ].join("\n"),
    }
  );

  registerFilesystemTools(server);
  registerJobTools(server);
  registerSkillTools(server);
  registerLispHarnessTools(server);

  // CAD MCP is optional at connector startup. The ChatGPT/file-tool surface
  // remains healthy even if AutoCAD/CAD MCP is temporarily unavailable.
  void registerCadProxyTools(server)
    .then(() => server.sendToolListChanged())
    .catch((error) =>
      console.warn("[CAD MCP] proxy registration deferred:", error instanceof Error ? error.message : error)
    );

  return server;
}
