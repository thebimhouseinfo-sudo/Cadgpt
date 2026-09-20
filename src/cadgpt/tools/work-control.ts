import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  activeExecutionForSession,
  createWorkRegistration,
  releaseWorkRegistration,
  workStatus,
  type ExecutionPath,
  type WorkOwnerType,
} from "../lib/work-registration.js";
import { validateAdmissionToken } from "../lib/admission.js";
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
      title: "Start CadGPT Work",
      description:
        "Create one execution-scoped work handle after ACTIVE cadgpt_admission. The handle owns later ToolLeases. Starting replacement work in the same ChatGPT session invalidates the prior work handle.",
      inputSchema: {
        admission_token: z.string().min(1),
        owner_type: z.enum(["skill", "job", "direct-cad", "file"]),
        owner_id: z.string().min(1).max(160),
        execution_path: z.enum(["file", "cad", "hybrid"]),
      },
    },
    async ({ admission_token, owner_type, owner_id, execution_path }) => {
      try {
        validateAdmissionToken(admission_token, options.sessionKey);
        const previousExecution = activeExecutionForSession(options.sessionKey);

        const work = createWorkRegistration({
          sessionKey: options.sessionKey,
          admissionToken: admission_token,
          ownerType: owner_type as WorkOwnerType,
          ownerId: owner_id,
          executionPath: execution_path as ExecutionPath,
        });

        if (previousExecution) {
          await cleanupExecutionState(previousExecution);
        }
        try {
          await options.prepareFamilies(work.executionPath, work.ownerId, work.executionId);
        } catch (error) {
          releaseWorkRegistration(work.executionId, work.authorityToken, options.sessionKey);
          throw error;
        }
        return toolResult("cadgpt_work_start", {
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
      description: "Show this ChatGPT session's CadGPT work state. It never exposes an authority token.",
      inputSchema: {
        execution_id: z.string().optional(),
        authority_token: z.string().optional(),
      },
    },
    async ({ execution_id, authority_token }) => {
      try {
        return toolResult(
          "cadgpt_work_status",
          workStatus(options.sessionKey, execution_id, authority_token)
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
      description: "Release only this ChatGPT session's supplied work handle.",
      inputSchema: {
        execution_id: z.string().min(1),
        authority_token: z.string().min(1),
      },
    },
    async ({ execution_id, authority_token }) => {
      try {
        const released = releaseWorkRegistration(
          execution_id,
          authority_token,
          options.sessionKey
        );
        await cleanupExecutionState(released.executionId);
        return toolResult("cadgpt_work_stop", {
          released: true,
          execution_id: released.executionId,
          owner_id: released.ownerId,
        });
      } catch (error) {
        return toolError("cadgpt_work_stop", error);
      }
    }
  );
}
