import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFilesystemTools } from "./tools/filesystem.js";

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
        "Never assume that AutoCAD ActiveDocument is the CadGPT bound drawing.",
        "Jobs define repeatable CAD workflows; write-lisp is a reusable coding capability.",
      ].join("\n"),
    }
  );

  registerFilesystemTools(server);
  return server;
}
