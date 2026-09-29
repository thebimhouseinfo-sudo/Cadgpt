import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  activeExecutionForSession,
  activeWorkForSession,
  adoptWorkSession,
  createWorkRegistration,
  enableWorkCapability,
  releaseSessionWork,
  workStatus,
  type ExecutionPath,
  type WorkOwnerType,
} from "../lib/work-registration.js";
import { assertSessionClaimed } from "../lib/admission.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { cleanupExecutionState } from "../runtime/execution-cleanup.js";

export function registerWorkControlTools(
  server: McpServer,
  options: {
    sessionKey: string;
    prepareFamilies: (
      executionPath: ExecutionPath,
      ownerId: string,
      executionId: string
    ) => Promise<Record<string, unknown> | void>;
  }
): void {
  server.registerTool(
    "cadgpt_work_start",
    {
      title: "Start or Reuse CadGPT Work",
      description:
        "Start execution only when there is no compatible existing work. If this conversation already has a work_handle but the connector replaced the MCP session, pass continuation_execution_id + continuation_authority_token so CadGPT resumes that exact work first. A bound HYBRID drawing workspace should be reused for later Job/Lisp authoring and CAD queries instead of starting a new work generation.",
      inputSchema: {
        owner_type: z.enum(["skill", "job", "direct-cad", "file"]),
        owner_id: z.string().min(1).max(160),
        execution_path: z.enum(["file", "cad", "hybrid"]),
        continuation_execution_id: z.string().min(1).optional(),
        continuation_authority_token: z.string().min(1).optional(),
      },
    },
    async ({
      owner_type,
      owner_id,
      execution_path,
      continuation_execution_id,
      continuation_authority_token,
    }) => {
      try {
        if (continuation_execution_id || continuation_authority_token) {
          if (!continuation_execution_id || !continuation_authority_token) {
            throw new Error(
              "WORK_CONTINUATION_HANDLE_REQUIRED: both continuation_execution_id and continuation_authority_token are required."
            );
          }
          const resumed = adoptWorkSession(
            continuation_execution_id,
            continuation_authority_token,
            options.sessionKey
          );
          let toolSurface = await options.prepareFamilies(
            resumed.executionPath,
            resumed.ownerId,
            resumed.executionId
          );
          const requestedCompatible =
            resumed.executionPath === "hybrid" ||
            resumed.executionPath === execution_path;
          if (!requestedCompatible) {
            throw new Error(
              `EXECUTION_PATH_MISMATCH: existing work is '${resumed.executionPath}' and cannot satisfy requested '${execution_path}'.`
            );
          }

          let continued = resumed;
          const enablingCadMcpDev =
            owner_type === "skill" &&
            owner_id.trim() === "cad-mcp-dev";
          if (enablingCadMcpDev) {
            continued = enableWorkCapability(
              resumed.executionId,
              resumed.authorityToken,
              options.sessionKey,
              "cad-mcp-dev"
            );
            toolSurface = await options.prepareFamilies(
              continued.executionPath,
              "cad-mcp-dev",
              continued.executionId
            );
          }

          return toolResult("cadgpt_work_start", {
            reused: true,
            resumed: true,
            reason: enablingCadMcpDev
              ? "conversation_work_dev_capability_enabled"
              : "conversation_work_continuation",
            work_handle: {
              execution_id: continued.executionId,
              authority_token: continued.authorityToken,
              owner_type: continued.ownerType,
              owner_id: continued.ownerId,
              job_id: continued.jobId,
              execution_path: continued.executionPath,
              capabilities: continued.capabilities,
              work_capabilities: continued.capabilities,
              driver_epoch: continued.driverEpoch,
              generation: continued.generation,
            },
            ...(toolSurface ? { tool_surface: toolSurface } : {}),
            note:
              "work_capabilities are execution privilege flags, not the MCP tool list. Use tool_surface / tools-list to inspect exposed tools.",
          });
        }

        assertSessionClaimed(options.sessionKey);

        const existing = activeWorkForSession(options.sessionKey);
        if (
          existing &&
          existing.ownerType === owner_type &&
          existing.ownerId === owner_id.trim() &&
          existing.executionPath === execution_path
        ) {
          const toolSurface = await options.prepareFamilies(
            existing.executionPath,
            existing.ownerId,
            existing.executionId
          );
          return toolResult("cadgpt_work_start", {
            reused: true,
            work_handle: {
              execution_id: existing.executionId,
              authority_token: existing.authorityToken,
              owner_type: existing.ownerType,
              owner_id: existing.ownerId,
              job_id: existing.jobId,
              execution_path: existing.executionPath,
              capabilities: existing.capabilities,
              work_capabilities: existing.capabilities,
              driver_epoch: existing.driverEpoch,
              generation: existing.generation,
            },
            ...(toolSurface ? { tool_surface: toolSurface } : {}),
            note:
              "work_capabilities are execution privilege flags, not the MCP tool list. Use tool_surface / tools-list to inspect exposed tools.",
          });
        }

        const previousExecution = activeExecutionForSession(options.sessionKey);
        const work = createWorkRegistration({
          sessionKey: options.sessionKey,
          ownerType: owner_type as WorkOwnerType,
          ownerId: owner_id,
          executionPath: execution_path as ExecutionPath,
        });

        const previousCleanup = previousExecution
          ? await cleanupExecutionState(previousExecution)
          : null;

        let toolSurface: Record<string, unknown> | void;
        try {
          toolSurface = await options.prepareFamilies(
            work.executionPath,
            work.ownerId,
            work.executionId
          );
        } catch (error) {
          const cleanupId = releaseSessionWork(options.sessionKey);
          if (cleanupId) await cleanupExecutionState(cleanupId);
          throw error;
        }

        return toolResult("cadgpt_work_start", {
          reused: false,
          work_handle: {
            execution_id: work.executionId,
            authority_token: work.authorityToken,
            owner_type: work.ownerType,
            owner_id: work.ownerId,
            job_id: work.jobId,
            execution_path: work.executionPath,
            capabilities: work.capabilities,
            work_capabilities: work.capabilities,
            driver_epoch: work.driverEpoch,
            generation: work.generation,
          },
          ...(toolSurface ? { tool_surface: toolSurface } : {}),
          note:
            "work_capabilities are execution privilege flags, not the MCP tool list. Use tool_surface / tools-list to inspect exposed tools.",
          ...(previousCleanup ? { previous_cleanup: previousCleanup } : {}),
        });
      } catch (error) {
        return toolError("cadgpt_work_start", error);
      }
    }
  );

  server.registerTool(
    "cadgpt_work_resume",
    {
      title: "Resume CadGPT Work",
      description:
        "Internal continuation handshake for MCP transport/session rotation. Rebind a valid existing work_handle to this replacement MCP session, restore the required lazy tool families, and continue the same work without creating a new generation.",
      inputSchema: {
        execution_id: z.string().min(1),
        authority_token: z.string().min(1),
      },
    },
    async ({ execution_id, authority_token }) => {
      try {
        const work = adoptWorkSession(
          execution_id,
          authority_token,
          options.sessionKey
        );
        await options.prepareFamilies(
          work.executionPath,
          work.ownerId,
          work.executionId
        );
        return toolResult("cadgpt_work_resume", {
          resumed: true,
          work_handle: {
            execution_id: work.executionId,
            authority_token: work.authorityToken,
            owner_type: work.ownerType,
            owner_id: work.ownerId,
            job_id: work.jobId,
            execution_path: work.executionPath,
            capabilities: work.capabilities,
            driver_epoch: work.driverEpoch,
            generation: work.generation,
          },
        });
      } catch (error) {
        return toolError("cadgpt_work_resume", error);
      }
    }
  );

  server.registerTool(
    "cadgpt_work_status",
    {
      title: "CadGPT Work Status",
      description:
        "Return work status for the current conversation. If this conversation already has a work_handle but the connector replaced the MCP session, pass continuation_execution_id + continuation_authority_token and CadGPT will resume that exact work before returning status.",
      inputSchema: {
        continuation_execution_id: z.string().min(1).optional(),
        continuation_authority_token: z.string().min(1).optional(),
      },
    },
    async ({ continuation_execution_id, continuation_authority_token }) => {
      try {
        if (continuation_execution_id || continuation_authority_token) {
          if (!continuation_execution_id || !continuation_authority_token) {
            throw new Error(
              "WORK_CONTINUATION_HANDLE_REQUIRED: both continuation_execution_id and continuation_authority_token are required."
            );
          }
          const resumed = adoptWorkSession(
            continuation_execution_id,
            continuation_authority_token,
            options.sessionKey
          );
          await options.prepareFamilies(
            resumed.executionPath,
            resumed.ownerId,
            resumed.executionId
          );
        }
        assertSessionClaimed(options.sessionKey);
        return toolResult(
          "cadgpt_work_status",
          workStatus(options.sessionKey)
        );
      } catch (error) {
        return toolError("cadgpt_work_status", error);
      }
    }
  );

  server.registerTool(
    "cadgpt_work_stop",
    {
      title: "Stop CadGPT Work",
      description:
        "Stop only the active work owned by this MCP/chat session. Session remains ready for later CadGPT requests.",
      inputSchema: {},
    },
    async () => {
      try {
        assertSessionClaimed(options.sessionKey);
        const activeExecution = activeExecutionForSession(options.sessionKey);
        if (!activeExecution) {
          return toolResult("cadgpt_work_stop", {
            stopped: false,
            active: false,
          });
        }

        const cleanupId = releaseSessionWork(options.sessionKey);
        if (!cleanupId) {
          return toolResult("cadgpt_work_stop", {
            stopped: false,
            pending: true,
            execution_id: activeExecution,
          });
        }

        const cleanup = await cleanupExecutionState(cleanupId);
        return toolResult("cadgpt_work_stop", {
          stopped: true,
          execution_id: cleanupId,
          cleanup,
          recovery_required: cleanup.recovery_required,
        });
      } catch (error) {
        return toolError("cadgpt_work_stop", error);
      }
    }
  );
}
