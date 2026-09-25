import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  activeExecutionForSession,
  activeWorkForSession,
  createWorkRegistration,
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
    ) => Promise<void>;
  }
): void {
  server.registerTool(
    "cadgpt_work_start",
    {
      title: "Start or Reuse CadGPT Work",
      description:
        "Start execution only after this chat has launched CadGPT. If compatible work is already active in this session, reuse its work_handle instead of creating a new generation.",
      inputSchema: {
        owner_type: z.enum(["skill", "job", "direct-cad", "file"]),
        owner_id: z.string().min(1).max(160),
        execution_path: z.enum(["file", "cad", "hybrid"]),
      },
    },
    async ({ owner_type, owner_id, execution_path }) => {
      try {
        assertSessionClaimed(options.sessionKey);

        const existing = activeWorkForSession(options.sessionKey);
        if (
          existing &&
          existing.ownerType === owner_type &&
          existing.ownerId === owner_id.trim() &&
          existing.executionPath === execution_path
        ) {
          await options.prepareFamilies(
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
              driver_epoch: existing.driverEpoch,
              generation: existing.generation,
            },
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

        try {
          await options.prepareFamilies(work.executionPath, work.ownerId, work.executionId);
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
            driver_epoch: work.driverEpoch,
            generation: work.generation,
          },
          ...(previousCleanup ? { previous_cleanup: previousCleanup } : {}),
        });
      } catch (error) {
        return toolError("cadgpt_work_start", error);
      }
    }
  );

  server.registerTool(
    "cadgpt_work_status",
    {
      title: "CadGPT Work Status",
      description:
        "Internal session-scoped work status. No admission token or work handle is required and no CAD runtime is started.",
      inputSchema: {},
    },
    async () => {
      try {
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
