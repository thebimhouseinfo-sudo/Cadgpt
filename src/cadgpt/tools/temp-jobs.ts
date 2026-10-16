import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { activeWorkForSession, currentToolLease } from "../lib/work-registration.js";
import { createOwnedTempJob } from "../runtime/temp-job-maintenance.js";
import { toolError, toolResult } from "../lib/tool-result.js";

/** Maintenance-only path: no JOB.md, no registry or promotion. */
export function registerTempJobTools(server: McpServer): void {
  server.registerTool(
    "temp_job_create",
    {
      title: "Create Temp Job",
      description: "Create/reuse a private temp-jobs/<random-id> folder for the current work. Work there directly, without JOB.md or Job registration.",
      inputSchema: {},
    },
    async () => {
      try {
        const lease = currentToolLease();
        const active = activeWorkForSession(lease.sessionKey);
        if (!active || active.executionId !== lease.workId || active.ownerType === "job") {
          throw new Error("TEMP_JOB_BUILDER_WORK_REQUIRED: start/reuse Builder FILE or HYBRID work, not a registered Job execution.");
        }
        const job = await createOwnedTempJob(lease.workId, lease.sessionKey);
        return toolResult("temp_job_create", {
          id: job.id,
          root: job.root,
          reused: job.reused,
          note: "Editable only by this owning work. No Job registration or promotion.",
        });
      } catch (error) {
        return toolError("temp_job_create", error);
      }
    }
  );
}
