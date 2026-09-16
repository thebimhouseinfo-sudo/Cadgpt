import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFilesystemTools } from "./tools/filesystem.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerSkillTools } from "./tools/skills.js";
import { registerLispHarnessTools } from "./tools/lisp-harness.js";
import { registerCapabilityRegistryTools } from "./tools/registry.js";
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
        tools: {},
      },
      instructions: [
        "CadGPT is a drawing-centric AutoCAD execution environment for ChatGPT.",
        "Local file tools are strictly sandboxed to lisp/** and jobs/**.",
        "skills/** is read-only guidance and can only be accessed through skill_list/skill_get.",
        "Use registry_list/registry_get to discover what a Lisp capability actually does before reading its source. Lisp filenames/command names are not semantic contracts.",
        "Never assume that AutoCAD ActiveDocument is the CadGPT target drawing.",
        "Use drawing_list and drawing_bind to explicitly bind the target drawing before any CAD business operation; changing AutoCAD tabs does not change that binding.",
        "Jobs define repeatable CAD workflows; load them with job_list/job_get and follow each step's explicit available_tools contract.",
        "write-lisp is a specialized AutoLISP coding capability, not a generic application-development agent. Load its relevant coding-skills resources before non-trivial Lisp work.",
        "Every changed .lsp must pass lisp_validate before cad__cad_load_lisp_file; successful load/run still requires structured CAD postcondition verification.",
        "CAD tool descriptors are stable even while CAD MCP sleeps. The backend becomes executable only after ChatGPT has activated CadGPT and AutoCAD is running.",
        "Proxied CAD business tools are exposed as cad__<upstream-tool-name> and CadGPT re-establishes the bound drawing before each call.",
      ].join("\n"),
    }
  );

  registerFilesystemTools(server);
  registerJobTools(server);
  registerSkillTools(server);
  registerLispHarnessTools(server);
  registerCapabilityRegistryTools(server);
  registerCadProxyTools(server);

  return server;
}
