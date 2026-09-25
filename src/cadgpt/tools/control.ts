import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  CADGPT_HELP,
  CADGPT_ROOT_MENU,
} from "../lib/quickstart.js";

export function registerCadGptControlTool(server: McpServer): void {
  server.registerTool(
    "cadgpt_control",
    {
      title: "CadGPT Static Control",
      description:
        "Ultra-light static CadGPT command/help surface. Use commands for exact cadgpt/ and help for exact cadgpt/help. This tool does not activate CAD MCP or mutate work state. Return the text verbatim.",
      inputSchema: {
        surface: z.enum(["commands", "help"]),
      },
      outputSchema: {
        text: z.string(),
      },
    },
    async ({ surface }) => {
      const text = surface === "commands" ? CADGPT_ROOT_MENU : CADGPT_HELP;
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { text },
      };
    }
  );
}
