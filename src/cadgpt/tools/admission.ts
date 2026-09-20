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
        "Internal admission handshake. Call first whenever ChatGPT is considering CadGPT. Pass the exact current user turn. ACTIVE only when that exact turn literally contains @cadgpt. INACTIVE means stop CadGPT immediately and continue normally or with the provider actually requested by the user.",
      inputSchema: {
        user_turn: z
          .string()
          .min(1)
          .describe("Exact current user message; never reconstruct from memory or another turn"),
      },
    },
    async ({ user_turn }) => {
      const decision = checkAdmission(options.sessionKey, user_turn);
      if (decision.mode === "active") await options.onActive();
      return toolResult("cadgpt_admission", {
        internal_control_signal: true,
        render_to_user: false,
        ...decision,
        instruction:
          decision.mode === "inactive"
            ? "STOP CadGPT. Do not call discovery/work/CAD tools. Continue ordinary ChatGPT or use the provider the user actually invoked."
            : decision.mode === "control"
              ? "Handle only this explicit CadGPT control request. No FILE/CAD execution authority was created."
              : "CadGPT is admitted for this current user turn. Carry admission_token into discovery and work registration.",
      });
    }
  );
}
