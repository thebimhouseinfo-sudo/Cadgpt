import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isPathInside, toCadgptPath } from "../lib/path-security.js";
import {
  currentToolLease,
  currentWorkRegistration,
} from "../lib/work-registration.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import {
  beginJobWorkspaceForExecution,
  cleanupJobWorkspaceForExecution,
  jobWorkspaceForExecution,
} from "../runtime/job-workspace.js";
import { drawingMetadataRootsForExecution } from "../runtime/drawing-persistence.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";
import { listRegisteredJobs } from "./jobs.js";

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeResultRelative(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(
      "JOB_RESULT_PATH_INVALID: relative_path must stay inside the Job result folder."
    );
  }
  return normalized;
}

async function assertRegisteredReasoningJob(jobId: string): Promise<void> {
  const jobs = await listRegisteredJobs();
  const match = jobs.find(
    (job) => job.id.toLowerCase() === jobId.trim().toLowerCase()
  );
  if (!match) {
    throw new Error(`JOB_NOT_FOUND: ${jobId}`);
  }
}

export function registerJobRuntimeTools(server: McpServer): void {
  server.registerTool(
    "job_working_location",
    {
      title: "Begin Job Runtime Working Storage",
      description:
        "Begin a fresh current-run working directory for one Reasoning/Dynamic Job. The previous current-run raw workspace for this execution is deleted. This root is for intermediate/raw/generated runtime data only and is never drawing metadata or Job history.",
      inputSchema: {
        job_id: z.string().min(1).max(160),
      },
    },
    async ({ job_id }) => {
      try {
        const lease = currentToolLease();
        const work = currentWorkRegistration();
        const requested = job_id.trim();
        await assertRegisteredReasoningJob(requested);
        if (
          work.ownerType === "job" &&
          work.ownerId.toLowerCase() !== requested.toLowerCase()
        ) {
          throw new Error(
            `JOB_WORKSPACE_OWNER_MISMATCH: active work belongs to '${work.ownerId}', not '${requested}'.`
          );
        }

        const state = await beginJobWorkspaceForExecution(
          lease.workId,
          requested
        );
        return toolResult("job_working_location", {
          job_id: state.job_id,
          execution_id: state.execution_id,
          path: toCadgptPath(state.root),
          absolute_path: state.root,
          retention: "current-run-only",
          history_retained: false,
          drawing_output_policy:
            "Raw/intermediate files stay here. Publish only explicit final result files with job_publish_result after drawing_metadata_location authorizes the bound drawing root.",
        });
      } catch (error) {
        return toolError("job_working_location", error);
      }
    }
  );

  server.registerTool(
    "job_publish_result",
    {
      title: "Publish Final Job Result",
      description:
        "Publish one explicit final result file from the active Job working directory into the exact execution-authorized drawing metadata root. Generic Job file tools cannot write raw/intermediate files to drawing storage.",
      inputSchema: {
        source_path: z
          .string()
          .min(1)
          .describe("Absolute source file inside the active Job working directory."),
        relative_path: z
          .string()
          .optional()
          .describe("Destination path beneath drawings/<drawing_anchor>/<job-id>/. Defaults to the source filename."),
        overwrite: z.boolean().optional().default(false),
      },
    },
    async ({ source_path, relative_path, overwrite }) => {
      try {
        if (!path.isAbsolute(source_path)) {
          throw new Error(
            "ABSOLUTE_PATH_REQUIRED: job_publish_result source_path must be absolute."
          );
        }
        const lease = currentToolLease();
        const state = jobWorkspaceForExecution(lease.workId);
        if (!state) {
          throw new Error(
            "JOB_WORKSPACE_REQUIRED: call job_working_location before publishing a Job result."
          );
        }

        const source = await fs.realpath(path.resolve(source_path));
        if (!isPathInside(source, state.root)) {
          throw new Error(
            "JOB_RESULT_SOURCE_SCOPE: final result source must be inside the active Job working directory."
          );
        }
        const sourceStat = await fs.lstat(source);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
          throw new Error(
            "JOB_RESULT_SOURCE_INVALID: final result source must be a regular non-symlink file."
          );
        }

        const drawingRoots = drawingMetadataRootsForExecution(lease.workId);
        if (drawingRoots.length !== 1) {
          throw new Error(
            "JOB_RESULT_DRAWING_LOCATION_REQUIRED: call drawing_metadata_location for the exact bound drawing before publishing."
          );
        }

        const destinationRelative = safeResultRelative(
          relative_path || path.basename(source)
        );
        const resultRoot = path.join(
          drawingRoots[0],
          state.job_id
        );
        const destination = path.resolve(
          resultRoot,
          destinationRelative
        );
        if (!isPathInside(destination, resultRoot)) {
          throw new Error(
            "JOB_RESULT_PATH_INVALID: destination escapes the Job result folder."
          );
        }

        return await withFileMutationLocks(
          [source, destination],
          async () => {
            const content = await fs.readFile(source);
            await fs.mkdir(path.dirname(destination), {
              recursive: true,
            });
            const existing = await fs
              .lstat(destination)
              .catch((error) => {
                if (
                  (error as NodeJS.ErrnoException).code === "ENOENT"
                ) {
                  return null;
                }
                throw error;
              });
            if (existing && !overwrite) {
              throw new Error(
                `JOB_RESULT_EXISTS: final result already exists at ${toCadgptPath(destination)}; use overwrite=true only when the Job contract permits replacing the previous durable result.`
              );
            }
            if (existing && !existing.isFile()) {
              throw new Error(
                "JOB_RESULT_CONFLICT: destination exists but is not a regular file."
              );
            }

            const temp = path.join(
              path.dirname(destination),
              `.${path.basename(destination)}.${randomUUID()}.tmp`
            );
            try {
              await fs.writeFile(temp, content);
              if (existing) {
                await fs.rm(destination, { force: true });
              }
              await fs.rename(temp, destination);
            } finally {
              await fs.rm(temp, { force: true }).catch(() => undefined);
            }

            return toolResult("job_publish_result", {
              job_id: state.job_id,
              source_path: toCadgptPath(source),
              destination_path: toCadgptPath(destination),
              absolute_destination_path: destination,
              bytes: content.length,
              sha256: sha256(content),
              overwritten: Boolean(existing),
              classification: "final_job_result",
            });
          }
        );
      } catch (error) {
        return toolError("job_publish_result", error);
      }
    }
  );

  server.registerTool(
    "job_runtime_end",
    {
      title: "End Job Runtime",
      description:
        "End the active Reasoning/Dynamic Job runtime context and delete its current-run raw/intermediate working directory. No Job runtime history is retained.",
      inputSchema: {
        job_id: z.string().min(1).max(160).optional(),
      },
    },
    async ({ job_id }) => {
      try {
        const lease = currentToolLease();
        const state = jobWorkspaceForExecution(lease.workId);
        if (
          state &&
          job_id &&
          state.job_id.toLowerCase() !== job_id.trim().toLowerCase()
        ) {
          throw new Error(
            `JOB_WORKSPACE_OWNER_MISMATCH: active runtime belongs to '${state.job_id}', not '${job_id}'.`
          );
        }
        const cleanup = await cleanupJobWorkspaceForExecution(
          lease.workId
        );
        return toolResult("job_runtime_end", {
          ...cleanup,
          history_retained: false,
        });
      } catch (error) {
        return toolError("job_runtime_end", error);
      }
    }
  );
}
