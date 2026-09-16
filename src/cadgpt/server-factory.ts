import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFilesystemTools } from "./tools/filesystem.js";
import { registerCadProxyTools } from "./tools/cad-proxy.js";

export async function createMcpServer(): Promise<McpServer> {
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
        "Never assume that AutoCAD ActiveDocument is the CadGPT bound drawing.",
        "Jobs define repeatable CAD workflows; write-lisp is a reusable coding capability.",
        "CAD MCP tools are exposed as cad__<upstream-tool-name> and must target the explicitly bound drawing once drawing binding is implemented.",
      ].join("\n"),
    }
  );

  registerFilesystemTools(server);
  await registerCadProxyTools(server);
  return server;
}
