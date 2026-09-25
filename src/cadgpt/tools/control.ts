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
    getCadState: () => Promise<string>;
    launchCadWorkspace: () => Promise<string>;
    stopCurrentWork: () => Promise<{ stopped: boolean; pending: boolean }>;
  }
): void {
  server.registerTool(
    "cadgpt_control",
    {
      title: "CadGPT Control",
      description:
        "Lightweight CG CLI. Exact cg/ -> commands, cg/list -> refresh drawing launcher from tray cache, cg/cad -> CAD workspace launcher, cg/help -> help, cg/status -> direct session/work/CAD status, cg/stop -> stop this session's active work. cg/list and cg/cad never start full CAD MCP."
      inputSchema: {
        surface: z.enum(["commands", "list", "cad", "help", "status", "stop"]),
      },
      outputSchema: {
        text: z.string(),
      },
    },
    async ({ surface }) => {
      let text: string;

      if (surface === "commands") {
        text = CADGPT_ROOT_MENU;
      } else if (surface === "list" || surface === "cad") {
        text = await options.launchCadWorkspace();
      } else if (surface === "help") {
        text = CADGPT_HELP;
      } else if (surface === "status") {
        const claimed = isSessionClaimed(options.sessionKey);
        const work = workStatus(options.sessionKey);
        const cadState = await options.getCadState();
        const lines = [
          "```text",
          "CadGPT",
          "────────────────────────────────",
          `SESSION   ${claimed ? "READY" : "IDLE"}`,
          `WORK      ${work.active === true ? "ACTIVE" : "IDLE"}`,
        ];
        if (work.active === true && typeof work.execution_path === "string") {
          lines.push(`MODE      ${String(work.execution_path).toUpperCase()}`);
        }
        lines.push(
          `CAD MCP   ${cadState}`,
          "────────────────────────────────",
          "```"
        );
        text = lines.join("\n");
      } else {
        const result = await options.stopCurrentWork();
        const cadState = await options.getCadState();
        text = [
          "```text",
          "CadGPT",
          "────────────────────────────────",
          "SESSION   READY",
          `WORK      ${result.pending ? "STOPPING" : "IDLE"}`,
          `CAD MCP   ${cadState}`,
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
