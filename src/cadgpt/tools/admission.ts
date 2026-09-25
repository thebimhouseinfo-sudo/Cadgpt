import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { checkAdmission } from "../lib/admission.js";
import { toolResult } from "../lib/tool-result.js";
import { isBareCadGptLaunch } from "../lib/quickstart.js";

export function registerAdmissionTool(
  server: McpServer,
  options: {
    sessionKey: string;
    onActive: (input: { bareLaunch: boolean }) => Promise<Record<string, unknown> | void>;
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
      const bareLaunch = isBareCadGptLaunch(user_turn);
      const launch =
        decision.mode === "active"
          ? await options.onActive({ bareLaunch })
          : undefined;
      const welcome =
        bareLaunch && launch && typeof launch.welcome_text === "string"
          ? launch.welcome_text
          : undefined;

      const data = {
        internal_control_signal: true,
        render_to_user: Boolean(welcome),
        ...decision,
        ...(launch ?? {}),
        ...(welcome ? { welcome_text: welcome } : {}),
        instruction:
          decision.mode === "inactive"
            ? "STOP CadGPT. Do not call discovery/work/CAD tools. Continue ordinary ChatGPT or use the provider the user actually invoked."
            : decision.mode === "control"
              ? "Route the exact CadGPT control command through cadgpt_control. CONTROL never starts FILE/CAD work."
              : welcome
                ? "Return welcome_text verbatim. If launch_mode is cad_prepare, preserve confirmation_token privately and wait for the user's workspace confirmation before calling cadgpt_cad_confirm."
                : "CadGPT session is ready. If the user requested real FILE/CAD work, start or reuse a compatible work_handle; otherwise continue conversationally.",
      };

      if (welcome) {
        return {
          content: [{ type: "text" as const, text: welcome }],
          structuredContent: {
            ok: true,
            tool: "cadgpt_admission",
            summary: "CadGPT session claimed",
            data,
          },
        };
      }

      return toolResult("cadgpt_admission", data);
    }
  );
}
