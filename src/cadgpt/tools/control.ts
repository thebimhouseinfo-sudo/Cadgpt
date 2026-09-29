import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isSessionClaimed } from "../lib/admission.js";
import {
  activeWorkForSession,
  isDevelopmentBuild,
  workStatus,
} from "../lib/work-registration.js";
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
      "Có drawing workspace thì CadGPT sẽ load/test; nếu chưa có vẫn có thể tạo hoặc sửa Lisp.",
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
    "Có drawing workspace thì CadGPT có thể live-test; nếu chưa có vẫn có thể sửa/validate CAD MCP source.",
    "────────────────────────────────",
    "```",
  ].join("\n");
}

function assetPrompt(surface: "rl" | "rj" | "il" | "el" | "ij" | "ej"): string {
  const map: Record<typeof surface, [string, string]> = {
    rl: ["Register Lisp", "Hãy cung cấp đường dẫn thư mục chứa Lisp cần đăng ký."],
    rj: ["Register Job", "Hãy cung cấp đường dẫn thư mục chứa Job cần đăng ký."],
    il: ["Import Lisp", "Hãy cung cấp đường dẫn thư mục chứa Lisp cần import."],
    el: ["Export Lisp", "Hãy cung cấp đường dẫn thư mục để export Lisp."],
    ij: ["Import Job", "Hãy cung cấp đường dẫn thư mục chứa Job cần import."],
    ej: ["Export Job", "Hãy cung cấp đường dẫn thư mục để export Job."],
  };
  const [title, prompt] = map[surface];
  return [
    "```text",
    "CG / " + title,
    "────────────────────────────────",
    prompt,
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
        "Lightweight CG fake CLI. cg/list refreshes the tray-backed drawing launcher without waking full CAD MCP; cg/job lists registered Jobs; cg/cl/cj/mcp enter authoring workflows; cg/rl,rj,il,el,ij,ej enter Lisp/Job register/import/export workflows; cg/ shows the full command menu.",
      inputSchema: {
        surface: z.enum([
          "commands",
          "list",
          "cl",
          "cj",
          "job",
          "rl",
          "rj",
          "il",
          "el",
          "ij",
          "ej",
          "mcp",
          "help",
          "status",
          "stop",
        ]),
      },
      outputSchema: {
        text: z.string(),
        continuation_policy: z
          .object({
            existing_work_action: z.string(),
            start_new_work: z.boolean(),
            owner_type: z.string().optional(),
            owner_id: z.string().optional(),
            execution_path: z.string().optional(),
            enable_capability: z.string().optional(),
            development_only: z.boolean().optional(),
          })
          .optional(),
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
        text = workflowPrompt(surface);
      } else if (
        surface === "rl" || surface === "rj" ||
        surface === "il" || surface === "el" ||
        surface === "ij" || surface === "ej"
      ) {
        text = assetPrompt(surface);
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

      const activeWork =
        surface === "cl" || surface === "cj" || surface === "mcp"
          ? activeWorkForSession(options.sessionKey)
          : null;
      let continuationPolicy:
        | {
            existing_work_action: string;
            start_new_work: boolean;
            owner_type?: string;
            owner_id?: string;
            execution_path?: string;
            enable_capability?: string;
            development_only?: boolean;
          }
        | undefined;

      if (surface === "cl" || surface === "cj") {
        if (activeWork && (activeWork.executionPath === "file" || activeWork.executionPath === "hybrid")) {
          continuationPolicy = {
            existing_work_action:
              "Reuse the current work_handle. If MCP transport/session changed, resume that handle first; do not replace an existing HYBRID drawing workspace for Lisp/Job authoring.",
            start_new_work: false,
          };
        } else {
          continuationPolicy = {
            existing_work_action:
              "No compatible FILE/HYBRID work is active. Start independent FILE work, then use the authoring tools. A drawing workspace is not required.",
            start_new_work: true,
            owner_type: "file",
            owner_id: surface === "cl" ? "lisp-authoring" : "job-authoring",
            execution_path: "file",
          };
        }
      } else if (surface === "mcp") {
        if (!isDevelopmentBuild()) {
          continuationPolicy = {
            existing_work_action:
              "CAD MCP self-improve is development-only and should be used only when a CAD MCP tool is missing, broken, or explicitly being improved.",
            start_new_work: false,
            development_only: true,
          };
        } else if (
          activeWork &&
          (activeWork.executionPath === "file" || activeWork.executionPath === "hybrid")
        ) {
          continuationPolicy = {
            existing_work_action:
              "Reuse the current work_handle and explicitly enable cad-mcp-dev on that execution. Do not replace an existing drawing workspace.",
            start_new_work: false,
            owner_type: "skill",
            owner_id: "cad-mcp-dev",
            execution_path: activeWork.executionPath,
            enable_capability: "cad-mcp-dev",
            development_only: true,
          };
        } else {
          continuationPolicy = {
            existing_work_action:
              "No compatible work is active. Start standalone cad-mcp-dev FILE work. A drawing workspace is optional and only needed for live CAD validation.",
            start_new_work: true,
            owner_type: "skill",
            owner_id: "cad-mcp-dev",
            execution_path: "file",
            development_only: true,
          };
        }
      }

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: {
          text,
          ...(continuationPolicy
            ? { continuation_policy: continuationPolicy }
            : {}),
        },
      };
    }
  );
}
