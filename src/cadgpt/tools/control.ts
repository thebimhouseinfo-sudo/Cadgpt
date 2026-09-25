import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isSessionClaimed } from "../lib/admission.js";
import { workStatus } from "../lib/work-registration.js";
import {
  CADGPT_HELP,
  CADGPT_ROOT_MENU,
} from "../lib/quickstart.js";

export function registerCadGptControlTool(
  server: McpServer,
  options: {
    sessionKey: string;
    stopCurrentWork: () => Promise<{ stopped: boolean; pending: boolean }>;
  }
): void {
  server.registerTool(
    "cadgpt_control",
    {
      title: "CadGPT Control",
      description:
        "Lightweight CadGPT CLI control surface. Exact cadgpt/ -> commands, cadgpt/help -> help, cadgpt/status -> status, cadgpt/stop -> stop. Status/stop are scoped to this MCP session and do not require user-visible authority tokens. Never wake CAD MCP merely for commands/help/status.",
      inputSchema: {
        surface: z.enum(["commands", "help", "status", "stop"]),
      },
      outputSchema: {
        text: z.string(),
      },
    },
    async ({ surface }) => {
      let text: string;

      if (surface === "commands") {
        text = CADGPT_ROOT_MENU;
      } else if (surface === "help") {
        text = CADGPT_HELP;
      } else if (surface === "status") {
        const claimed = isSessionClaimed(options.sessionKey);
        const work = workStatus(options.sessionKey);
        text = [
          "```text",
          "CadGPT Status",
          "────────────────────────────────",
          `SESSION   ${claimed ? "ACTIVE" : "IDLE"}`,
          `WORK      ${work.active === true ? "ACTIVE" : "IDLE"}`,
          "CAD MCP   ON DEMAND",
          "────────────────────────────────",
          "```",
        ].join("\n");
      } else {
        const result = await options.stopCurrentWork();
        text = [
          "```text",
          "CadGPT Stop",
          "────────────────────────────────",
          `WORK      ${result.pending ? "STOPPING" : result.stopped ? "STOPPED" : "IDLE"}`,
          "SESSION   ACTIVE",
          "CAD MCP   ON DEMAND",
          "────────────────────────────────",
          "```",
        ].join("\n");
      }

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { text },
      };
    }
  );
}
