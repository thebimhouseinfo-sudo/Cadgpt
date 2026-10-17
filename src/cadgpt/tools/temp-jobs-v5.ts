import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { currentToolLease } from "../lib/work-registration.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { createTempJob, writeTempSource, finishTempJob, clearTempJobs } from "../runtime/temp-job-v5.js";

export function registerTempJobV5Tools(server: McpServer): void {
  server.registerTool("temp_job_create", {
    title: "Create temporary Job workspace",
    description: "Create an independently owned, random-ID temporary Job source folder. No JOB.md or promotion required.",
    inputSchema: {},
  }, async () => {
    try {
      const l = currentToolLease();
      return toolResult("temp_job_create", await createTempJob(l.workId, l.sessionKey));
    } catch (e) { return toolError("temp_job_create", e); }
  });
  server.registerTool("temp_job_source_create", {
    title: "Write one new owned Temp Job source file",
    description: "Create source inside the calling Builder's own Temp Job only. Never overwrites.",
    inputSchema: {
      id: z.string().uuid(),
      relative_path: z.string().min(1),
      content: z.string(),
    },
  }, async ({ id, relative_path, content }) => {
    try {
      const l = currentToolLease();
      return toolResult("temp_job_source_create", await writeTempSource(id, l.workId, l.sessionKey, relative_path, content));
    } catch (e) { return toolError("temp_job_source_create", e); }
  });
  server.registerTool("temp_job_done", {
    title: "Mark Temp Job complete",
    description: "Complete the current Builder-owned Temp Job without registering or promoting it.",
    inputSchema: { id: z.string().uuid() },
  }, async ({ id }) => {
    try {
      const l = currentToolLease();
      return toolResult("temp_job_done", await finishTempJob(id, l.workId, l.sessionKey));
    } catch (e) { return toolError("temp_job_done", e); }
  });
  server.registerTool("temp_job_clear", {
    title: "Clear completed Temp Jobs",
    description: "Delete only recognized completed and inactive Temp Job source folders. Never delete bound-DWG results.",
    inputSchema: { id: z.string().uuid().optional() },
  }, async ({ id }) => {
    try { return toolResult("temp_job_clear", await clearTempJobs(id)); }
    catch (e) { return toolError("temp_job_clear", e); }
  });
}
