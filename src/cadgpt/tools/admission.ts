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
        "Internal admission handshake. Call first whenever ChatGPT is considering CadGPT. Pass the exact current user turn and its current-turn invocation source. ACTIVE when the user explicitly invoked CadGPT either with literal @cadgpt or by selecting/calling the CadGPT plugin/icon in this same turn. Never infer plugin invocation from prior turns, memory, CAD context, files, or state.",
      inputSchema: {
        user_turn: z
          .string()
          .min(1)
          .describe("Exact current user message; never reconstruct from memory or another turn"),
        invocation_source: z
          .enum(["mention", "plugin"])
          .default("mention")
          .describe("mention = current turn literally contains @cadgpt; plugin = user explicitly invoked CadGPT through its plugin/icon in this current turn"),
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
              : "CadGPT is admitted for this current user turn. Carry admission_token into discovery and work registration.",
      });
    }
  );
}
