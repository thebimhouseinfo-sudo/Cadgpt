import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFilesystemTools } from "./tools/filesystem.js";
import { registerJobTools } from "./tools/jobs.js";
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
        "Never assume that AutoCAD ActiveDocument is the CadGPT target drawing.",
        "Use drawing_list and drawing_bind to explicitly bind the target drawing before any CAD business operation; changing AutoCAD tabs does not change that binding.",
        "Jobs define repeatable CAD workflows; load them with job_list/job_get and follow each step's explicit available_tools contract.",
        "write-lisp is a reusable coding capability rather than a CAD business Job.",
        "Proxied CAD business tools are exposed as cad__<upstream-tool-name> and CadGPT re-establishes the bound drawing before each call.",
      ].join("\n"),
    }
  );

  registerFilesystemTools(server);
  registerJobTools(server);

  // CAD MCP is optional at connector startup. The ChatGPT/file-tool surface
  // remains healthy even if AutoCAD/CAD MCP is temporarily unavailable.
  void registerCadProxyTools(server)
    .then(() => server.sendToolListChanged())
    .catch((error) =>
      console.warn("[CAD MCP] proxy registration deferred:", error instanceof Error ? error.message : error)
    );

  return server;
}
