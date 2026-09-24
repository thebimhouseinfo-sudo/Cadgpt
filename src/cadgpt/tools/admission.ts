import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { checkAdmission } from "../lib/admission.js";
import { toolResult } from "../lib/tool-result.js";

export function registerAdmissionTool(
  server: McpServer,
  options: {
    sessionKey: string;
    onActive: () => Promise<void>;
  }
): void {
  server.registerTool(
    "cadgpt_admission",
    {
      title: "CadGPT Admission",
      description:
        "Internal CadGPT session admission handshake. The user explicitly launches CadGPT once per ChatGPT/MCP session, either by calling this CadGPT plugin/icon (for example a connector renamed CG) or by using literal @cadgpt. That claim persists for later turns in the same session, so repeated @cadgpt is not required. Pass the exact current user turn. Never carry a claim across another MCP/chat session.",
      inputSchema: {
        user_turn: z
          .string()
          .min(1)
          .describe("Exact current user message; never reconstruct from memory or another turn"),
        invocation_source: z
          .enum(["mention", "plugin"])
          .default("plugin")
          .describe("plugin = CadGPT connector/plugin was invoked; mention = the current turn literally contains @cadgpt. Once either claims this MCP session, later turns continue without repeating @cadgpt."),
      },
    },
    async ({ user_turn, invocation_source }) => {
      const decision = checkAdmission(options.sessionKey, user_turn, invocation_source);
      if (decision.mode === "active") await options.onActive();
      return toolResult("cadgpt_admission", {
        internal_control_signal: true,
        render_to_user: false,
        ...decision,
        instruction:
          decision.mode === "inactive"
            ? "STOP CadGPT. Do not call discovery/work/CAD tools. Continue ordinary ChatGPT or use the provider the user actually invoked."
            : decision.mode === "control"
              ? "Use this CONTROL admission_token only for CadGPT control/status/stop. It cannot authorize discovery, FILE, CAD, or new work."
              : "CadGPT is admitted for this ChatGPT/MCP session. Carry the fresh admission_token into discovery and work registration for this turn; later turns may continue without repeating @cadgpt.",
      });
    }
  );
}
