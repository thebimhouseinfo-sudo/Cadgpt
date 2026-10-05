import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { checkAdmission } from "../lib/admission.js";
import { toolResult } from "../lib/tool-result.js";
import { isBareCadGptLaunch } from "../lib/quickstart.js";
import { completePendingAddinPair } from "../lib/addin-control.js";

export type HumanPowerControlAction =
  | "start"
  | "stop"
  | "status";

export function parseHumanPowerControl(
  userTurn: string
): HumanPowerControlAction | null {
  const value = userTurn
    .trim()
    .toLowerCase();
  if (!/human\s+power/.test(value)) {
    return null;
  }
  if (
    /(?:\bon\b|\bstart\b|\benable\b|bật)/i.test(
      value
    )
  ) {
    return "start";
  }
  if (
    /(?:\boff\b|\bstop\b|\bdisable\b|tắt)/i.test(
      value
    )
  ) {
    return "stop";
  }
  if (
    /(?:\bstatus\b|\bstate\b|trạng\s+thái)/i.test(
      value
    )
  ) {
    return "status";
  }
  return null;
}

export function registerAdmissionTool(
  server: McpServer,
  options: {
    sessionKey: string;
    onActive: (input: {
      bareLaunch: boolean;
    }) => Promise<Record<string, unknown> | void>;
    onHumanPowerControl?: (input: {
      action: HumanPowerControlAction;
      userTurn: string;
    }) => Promise<Record<string, unknown>>;
  }
): void {
  server.registerTool(
    "cadgpt_admission",
    {
      title: "CadGPT Admission",
      description:
        "Internal CadGPT session admission handshake. On a bare CadGPT/CG plugin invocation or bare @cadgpt / @cg launch, the returned text content IS the final user-visible Welcome screen: output it verbatim and do not summarize it as ready/activated. The session claim persists for later turns in the same session. Pass the exact current user turn. Never carry a claim across another MCP/chat session.",
      inputSchema: {
        user_turn: z
          .string()
          .min(1)
          .describe("Exact current user message; never reconstruct from memory or another turn"),
        invocation_source: z
          .enum(["mention", "plugin"])
          .default("plugin")
          .describe("plugin = CadGPT connector/plugin was invoked; mention = the current turn literally contains @cadgpt or @cg. Once either claims this MCP session, later turns continue without repeating the mention."),
      },
    },
    async ({ user_turn, invocation_source }) => {
      const decision = checkAdmission(options.sessionKey, user_turn, invocation_source);
      const bareLaunch = isBareCadGptLaunch(
        user_turn,
        invocation_source
      );
      const humanPowerAction =
        parseHumanPowerControl(user_turn);
      const humanPowerControl =
        decision.mode === "active" &&
        humanPowerAction &&
        options.onHumanPowerControl
          ? await options.onHumanPowerControl({
              action: humanPowerAction,
              userTurn: user_turn,
            })
          : undefined;
      const launch =
        decision.mode === "active" &&
        !humanPowerControl
          ? await options.onActive({ bareLaunch })
          : undefined;
      const welcome =
        bareLaunch && launch && typeof launch.welcome_text === "string"
          ? launch.welcome_text
          : undefined;

      if (decision.mode === "active" && decision.claimed) {
        completePendingAddinPair(options.sessionKey);
      }

      const data = {
        internal_control_signal: true,
        render_to_user: Boolean(welcome),
        ...decision,
        ...(launch ?? {}),
        ...(humanPowerControl
          ? {
              human_power_control:
                humanPowerControl,
            }
          : {}),
        ...(welcome ? { welcome_text: welcome } : {}),
        instruction:
          decision.mode === "inactive"
            ? "STOP CadGPT. Do not call discovery/work/CAD tools. Continue ordinary ChatGPT or use the provider the user actually invoked."
            : decision.mode === "control"
              ? "Route the exact CadGPT control command through cadgpt_control. CONTROL never starts FILE/CAD work."
              : humanPowerControl
              ? "Human Power control was handled through the stable cadgpt_admission surface. Continue the current CadGPT work with the same work_handle unless the result reports no active work."
              : welcome
                ? "Return welcome_text verbatim. If launch_mode is auto_bind, the sole drawing is already bound: reuse the returned work_handle for CAD calls. If launch_mode is cad_prepare, preserve confirmation_token privately and wait for the user's workspace confirmation before calling cadgpt_cad_confirm."
                : "CadGPT session is ready. If the user requested real FILE/CAD work, start or reuse a compatible work_handle; otherwise continue conversationally.",
      };

      if (welcome) {
        return {
          content: [{ type: "text" as const, text: welcome }],
          structuredContent: {
            welcome_text: welcome,
            render_verbatim: true,
            launch_mode: launch?.launch_mode,
            autocad_detected: launch?.autocad_detected,
            ...(launch?.confirmation_token
              ? { confirmation_token: launch.confirmation_token }
              : {}),
            ...(launch?.drawings ? { drawings: launch.drawings } : {}),
            ...(launch?.auto_bound ? { auto_bound: true } : {}),
            ...(launch?.work_handle
              ? { work_handle: launch.work_handle }
              : {}),
            ...(launch?.drawing ? { drawing: launch.drawing } : {}),
            ...(typeof launch?.cad_tools_ready === "boolean"
              ? { cad_tools_ready: launch.cad_tools_ready }
              : {}),
            ...(typeof launch?.cad_proxy_tool_count === "number"
              ? { cad_proxy_tool_count: launch.cad_proxy_tool_count }
              : {}),
            ...(Array.isArray(launch?.cad_proxy_tools)
              ? { cad_proxy_tools: launch.cad_proxy_tools }
              : {}),
          },
        };
      }

      return toolResult("cadgpt_admission", data);
    }
  );
}
