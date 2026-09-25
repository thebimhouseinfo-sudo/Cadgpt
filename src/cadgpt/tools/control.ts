import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isSessionClaimed } from "../lib/admission.js";
import { workStatus } from "../lib/work-registration.js";
import {
  CADGPT_HELP,
  CADGPT_ROOT_MENU,
} from "../lib/quickstart.js";

function workflowPrompt(surface: "cl" | "cj" | "mcp"): string {
  if (surface === "cl") {
    return [
      "```text",
      "CG / Create Lisp",
      "────────────────────────────────",
      "Hãy mô tả Lisp bạn muốn tạo hoặc sửa.",
      "CadGPT sẽ dùng drawing workspace hiện tại để load/test.",
      "────────────────────────────────",
      "```",
    ].join("\n");
  }
  if (surface === "cj") {
    return [
      "```text",
      "CG / Create Job",
      "────────────────────────────────",
      "Hãy mô tả Job bạn muốn tạo hoặc sửa.",
      "Job sẽ được author/validate theo Job workflow của CadGPT.",
      "────────────────────────────────",
      "```",
    ].join("\n");
  }
  return [
    "```text",
    "CG / CAD MCP Development",
    "────────────────────────────────",
    "Hãy mô tả tool hoặc phần CAD MCP bạn muốn cập nhật.",
    "CadGPT sẽ dùng cad-mcp-dev trên drawing workspace hiện tại.",
    "────────────────────────────────",
    "```",
  ].join("\n");
}

export function registerCadGptControlTool(
  server: McpServer,
  options: {
    sessionKey: string;
    getCadState: () => Promise<string>;
    launchCadWorkspace: () => Promise<string>;
    listJobs: () => Promise<string>;
    stopCurrentWork: () => Promise<{ stopped: boolean; pending: boolean }>;
  }
): void {
  server.registerTool(
    "cadgpt_control",
    {
      title: "CadGPT Control",
      description:
        "Lightweight CG fake CLI. cg/list refreshes the tray-backed drawing launcher without waking full CAD MCP; cg/job lists registered Jobs; cg/cl, cg/cj and cg/mcp enter the corresponding workflow; cg/ shows the full command menu.",
      inputSchema: {
        surface: z.enum([
          "commands",
          "list",
          "cl",
          "cj",
          "job",
          "mcp",
          "help",
          "status",
          "stop",
        ]),
      },
      outputSchema: {
        text: z.string(),
      },
    },
    async ({ surface }) => {
      let text: string;

      if (surface === "commands") {
        text = CADGPT_ROOT_MENU;
      } else if (surface === "list") {
        text = await options.launchCadWorkspace();
      } else if (surface === "job") {
        text = await options.listJobs();
      } else if (surface === "cl" || surface === "cj" || surface === "mcp") {
        const work = workStatus(options.sessionKey);
        text = work.active === true
          ? workflowPrompt(surface)
          : [
              "```text",
              "CG / Workspace Required",
              "────────────────────────────────",
              "Chưa có drawing workspace.",
              "",
              "Dùng cg/list và chọn 1 drawing trước khi bắt đầu workflow này.",
              "────────────────────────────────",
              "```",
            ].join("\n");
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
