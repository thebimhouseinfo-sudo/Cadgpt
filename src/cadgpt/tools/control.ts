import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isSessionClaimed } from "../lib/admission.js";
import { clearTempJobs } from "../runtime/temp-job-v5.js";
import {
  activeWorkForSession,
  clearSessionWorkStopBarrier,
  isDevelopmentBuild,
  workStatus,
} from "../lib/work-registration.js";
import {
  CADGPT_HELP,
  CADGPT_ROOT_MENU,
} from "../lib/quickstart.js";

function workflowPrompt(surface: "cl" | "cj" | "mcp" | "kug" | "kud"): string {
  if (surface === "cl") {
    return [
      "```text",
      "CG / Create Lisp",
      "────────────────────────────────",
      "Hãy mô tả Lisp bạn muốn tạo hoặc sửa.",
      "V5: Builder ghi source vào thư mục Lisp hoặc Temp Job đang sở hữu; LOAD/RUN trên drawing đã bind khi user yêu cầu. Không tạo bước TEST riêng hay bắt buộc checkout/promote.",
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
      "V5: Builder tạo/sửa Job trực tiếp trong thư mục sở hữu, RUN theo các bước thực tế, lỗi thì sửa và chạy lại bước an toàn. Không bắt buộc draft/checkout/promote.",
      "────────────────────────────────",
      "```",
    ].join("\n");
  }
  if (surface === "kug" || surface === "kud") {
    const global = surface === "kug";
    return [
      "```text",
      global ? "CG / Knowledge Update Global (KUG)" : "CG / Knowledge Update Drawing (KUD)",
      "────────────────────────────────",
      global
        ? "Hãy cung cấp quy tắc hoặc kinh nghiệm nghiệp vụ HVAC muốn cập nhật vào Global Knowledge."
        : "Hãy cung cấp thông tin HVAC của drawing đã bind cần cập nhật. KUD cần drawing workspace hiện tại.",
      "Kiểm tra knowledge cũ, phân tích xung đột, đề xuất nội dung rồi xác nhận trước khi ghi.",
      "Kiến thức CAD API, Lisp Writer, MCP Fixer không thuộc knowledge này.",
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
    stopCurrentJob: () => Promise<{ stopped: boolean; detail: string }>;
    authorizeJobUpdate: (libraryId?: string, folder?: string) => Promise<string>;
  }
): void {
  server.registerTool(
    "cadgpt_control",
    {
      title: "CadGPT Control",
      description:
        "Lightweight CG fake CLI. cg/list refreshes the tray-backed drawing launcher without waking full CAD MCP; cg/job lists registered Jobs; cg/cl/cj/mcp enter authoring workflows; cg/kug and cg/kud update HVAC domain knowledge; cg/rl,rj,il,el,ij,ej enter Lisp/Job register/import/export workflows; cg/ shows the full command menu.",
      inputSchema: {
        surface: z.enum([
          "commands",
          "list",
          "cl",
          "cj",
          "kug",
          "kud",
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
          "jobstop",
          "jobupdate",
          "cleartempjob",
        ]),
        temp_job_id: z.string().uuid().optional(),
        job_library_id: z.string().optional(),
        job_folder: z.string().optional(),
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
            active_work_handle: z
              .object({
                execution_id: z.string(),
                authority_token: z.string(),
                execution_path: z.string(),
                owner_id: z.string(),
              })
              .optional()
              .describe("Present when start_new_work=false and work is already active. Use these credentials directly for all file/job/lisp/cad tool calls."),
          })
          .optional(),
      },
    },
    async ({ surface, temp_job_id, job_library_id, job_folder }) => {
      let text: string;

      if (
        surface === "cl" ||
        surface === "cj" ||
        surface === "kug" ||
        surface === "kud" ||
        surface === "mcp" ||
        surface === "rl" ||
        surface === "rj" ||
        surface === "il" ||
        surface === "el" ||
        surface === "ij" ||
        surface === "ej"
      ) {
        clearSessionWorkStopBarrier(options.sessionKey);
      }

      if (surface === "commands") {
        text = CADGPT_ROOT_MENU;
      } else if (surface === "list") {
        text = await options.launchCadWorkspace();
      } else if (surface === "job") {
        text = await options.listJobs();
      } else if (surface === "cl" || surface === "cj" || surface === "mcp" || surface === "kug" || surface === "kud") {
        text = workflowPrompt(surface);
      } else if (
        surface === "rl" || surface === "rj" ||
        surface === "il" || surface === "el" ||
        surface === "ij" || surface === "ej"
      ) {
        text = assetPrompt(surface);
      } else if (surface === "jobupdate") {
        text = await options.authorizeJobUpdate(job_library_id, job_folder);
      } else if (surface === "jobstop") {
        const result = await options.stopCurrentJob();
        text = result.detail;
      } else if (surface === "cleartempjob") {
        const result = await clearTempJobs(temp_job_id);
        text = `Temp Jobs: removed ${result.removed.length}, skipped ${result.skipped.length}.` +
          (result.skipped.length ? "\n" + result.skipped.map(e => `${e.id}: ${e.reason}`).join("\n") : "");
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
        surface === "cl" || surface === "cj" || surface === "mcp" || surface === "kug" || surface === "kud"
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
            active_work_handle?: {
              execution_id: string;
              authority_token: string;
              execution_path: string;
              owner_id: string;
            };
          }
        | undefined;

      if (surface === "cl" || surface === "cj") {
        if (activeWork && (activeWork.executionPath === "file" || activeWork.executionPath === "hybrid")) {
          continuationPolicy = {
            existing_work_action:
              "Reuse the current work_handle: compatible work is already active. Use the active_work_handle credentials (execution_id + authority_token) directly for all file/job/lisp tool calls. Do not call cadgpt_work_start again. Do not replace an existing HYBRID drawing workspace for Lisp/Job authoring.",
            start_new_work: false,
            active_work_handle: {
              execution_id: activeWork.executionId,
              authority_token: activeWork.authorityToken,
              execution_path: activeWork.executionPath,
              owner_id: activeWork.ownerId,
            },
          };
        } else {
          continuationPolicy = {
            existing_work_action:
              "No compatible work is active. Call cadgpt_work_start(owner_type=file, owner_id=job-authoring or lisp-authoring) with omitted execution_path (defaults HYBRID); do not bind or activate CAD until requested.",
            start_new_work: true,
            owner_type: "file",
            owner_id: surface === "cl" ? "lisp-authoring" : "job-authoring",
            execution_path: "hybrid",
          };
        }
      } else if (surface === "kug" || surface === "kud") {
        if (activeWork && activeWork.executionPath === "hybrid") {
          continuationPolicy = {
            existing_work_action: "Reuse the current HYBRID bound drawing workspace. For KUG use global scope; for KUD use drawing scope after validating bound drawing. Follow skills/knowledge-updater/SKILL.md.",
            start_new_work: false,
            active_work_handle: {
              execution_id: activeWork.executionId,
              authority_token: activeWork.authorityToken,
              execution_path: activeWork.executionPath,
              owner_id: activeWork.ownerId,
            },
          };
        } else if (surface === "kug" && activeWork && activeWork.executionPath === "file") {
          continuationPolicy = {
            existing_work_action: "Reuse existing FILE work for global knowledge. If live CAD evidence is required, transition to HYBRID with cadgpt_work_upgrade and explicit drawing selection.",
            start_new_work: false,
            active_work_handle: {
              execution_id: activeWork.executionId,
              authority_token: activeWork.authorityToken,
              execution_path: activeWork.executionPath,
              owner_id: activeWork.ownerId,
            },
          };
        } else if (surface === "kug") {
          continuationPolicy = {
            existing_work_action: "No compatible work is active. Start HYBRID work with owner_type=file and owner_id=knowledge-updater-global; CAD activation is deferred until needed.",
            start_new_work: true,
            owner_type: "file",
            owner_id: "knowledge-updater-global",
            execution_path: "hybrid",
          };
        } else {
          continuationPolicy = {
            existing_work_action: activeWork?.executionPath === "file"
              ? "KUD requires a bound HYBRID drawing workspace. Use cadgpt_work_upgrade with an explicitly selected drawing; do not try to read or write drawing knowledge in FILE mode."
              : "KUD requires an explicitly bound drawing. Use cg/list and bind one drawing before updating its HVAC knowledge. Do not guess the drawing folder.",
            start_new_work: false,
            ...(activeWork?.executionPath === "file"
              ? { active_work_handle: {
                  execution_id: activeWork.executionId,
                  authority_token: activeWork.authorityToken,
                  execution_path: activeWork.executionPath,
                  owner_id: activeWork.ownerId,
                } }
              : {}),
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
              "No compatible work is active. Start standalone cad-mcp-dev HYBRID work. CAD activation remains optional until validation is requested.",
            start_new_work: true,
            owner_type: "skill",
            owner_id: "cad-mcp-dev",
            execution_path: "hybrid",
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
