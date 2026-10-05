import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getJobDraftRoot, getUserCapabilitiesPath } from "../lib/appdata.js";
import {
  isPathInside,
  resolveAllowedPath,
  resolveAbsoluteMutationPath,
  toCadgptPath,
} from "../lib/path-security.js";
import {
  currentToolLease,
  currentWorkRegistration,
} from "../lib/work-registration.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import {
  authorizeJobDefinitionRootForExecution,
  beginJobWorkspaceForExecution,
  cleanupJobWorkspaceForExecution,
  jobWorkspaceForExecution,
} from "../runtime/job-workspace.js";
import { drawingMetadataRootsForExecution } from "../runtime/drawing-persistence.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";
import { getInternalJob } from "../lib/internal-jobs.js";

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

async function reasoningDraftPath(
  jobId: string,
  draftPath?: string
): Promise<string | null> {
  if (getInternalJob(jobId)) {
    throw new Error(
      "DIRECT_JOB_NO_DATA: Internal Direct Jobs do not own runtime working data."
    );
  }

  let entries: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(
      await fs.readFile(getUserCapabilitiesPath(), "utf8")
    ) as { entries?: Array<Record<string, unknown>> };
    entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const needle = jobId.trim().toLowerCase();
  const match = entries.find(
    (entry) =>
      entry.kind === "job" &&
      String(entry.id || "").trim().toLowerCase() === needle
  );
  if (!match) {
    if (!draftPath) {
      throw new Error(
        `JOB_DRAFT_PATH_REQUIRED: unregistered Job '${jobId}' requires its absolute reasoning JOB.md draft_path.`
      );
    }
    const candidate = path.resolve(draftPath);
    const draftRoot = path.resolve(getJobDraftRoot());
    if (
      !path.isAbsolute(draftPath) ||
      !isPathInside(candidate, draftRoot) ||
      path.basename(candidate).toLowerCase() !== "job.md"
    ) {
      throw new Error(
        "JOB_DRAFT_REASONING_REQUIRED: unregistered Job runtime storage is allowed only for an absolute reasoning JOB.md under appdata/workspace/job-draft/**."
      );
    }
    const stat = await fs.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        "JOB_DRAFT_REASONING_REQUIRED: draft_path must be a regular reasoning JOB.md file."
      );
    }
    return await resolveAllowedPath(candidate, {
      allowedRoots: [getJobDraftRoot()],
    });
  }
  if (
    path.extname(String(match.relative_path || "")).toLowerCase() === ".py"
  ) {
    throw new Error(
      "DIRECT_JOB_NO_DATA: Direct Jobs are execution-only and do not own runtime working storage."
    );
  }
  return null;
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
        draft_path: z
          .string()
          .optional()
          .describe(
            "Required only for an unregistered pre-promotion Reasoning Job: absolute JOB.md path under appdata/workspace/job-draft/**. Direct .py drafts are not eligible for runtime working storage."
          ),
      },
    },
    async ({ job_id, draft_path }) => {
      try {
        const lease = currentToolLease();
        const work = currentWorkRegistration();
        const requested = job_id.trim();
        const canonicalDraft = await reasoningDraftPath(
          requested,
          draft_path
        );
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
        if (canonicalDraft) {
          await authorizeJobDefinitionRootForExecution(
            lease.workId,
            path.dirname(canonicalDraft)
          );
        }
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
        const canonicalWorkspaceRoot = await fs.realpath(state.root);
        if (!isPathInside(source, canonicalWorkspaceRoot)) {
          throw new Error(
            "JOB_RESULT_SOURCE_SCOPE: final result source must be inside the active Job working directory."
          );
        }
        const sourceStat = await fs.lstat(source);
        if (!sourceStat.isFile()) {
          throw new Error(
            "JOB_RESULT_SOURCE_INVALID: final result source must be a regular file."
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
        const drawingRoot = drawingRoots[0];
        const resultRoot = path.join(
          drawingRoot,
          state.job_id
        );
        const destinationRequest = path.resolve(
          resultRoot,
          destinationRelative
        );
        if (!isPathInside(destinationRequest, resultRoot)) {
          throw new Error(
            "JOB_RESULT_PATH_INVALID: destination escapes the Job result folder."
          );
        }

        return await withFileMutationLocks(
          [source, resultRoot, destinationRequest],
          async () => {
            const resultRootStat = await fs
              .lstat(resultRoot)
              .catch((error) => {
                if (
                  (error as NodeJS.ErrnoException).code === "ENOENT"
                ) {
                  return null;
                }
                throw error;
              });
            if (
              resultRootStat?.isSymbolicLink() ||
              (resultRootStat && !resultRootStat.isDirectory())
            ) {
              throw new Error(
                "JOB_RESULT_SCOPE: Job result namespace must be a regular directory."
              );
            }

            const safeResultRoot =
              await resolveAbsoluteMutationPath(
                resultRoot,
                {
                  allowedRoots: [drawingRoot],
                  forCreate: true,
                  label: "Job drawing result",
                }
              );
            if (!resultRootStat) {
              await fs.mkdir(safeResultRoot);
            }

            const destination =
              await resolveAbsoluteMutationPath(
                path.join(
                  safeResultRoot,
                  destinationRelative
                ),
                {
                  allowedRoots: [safeResultRoot],
                  forCreate: true,
                  label: "Job drawing result",
                }
              );
            const content = await fs.readFile(source);
            await fs.mkdir(path.dirname(destination), {
              recursive: true,
            });

            const requestedDestinationStat = await fs
              .lstat(destinationRequest)
              .catch((error) => {
                if (
                  (error as NodeJS.ErrnoException).code === "ENOENT"
                ) {
                  return null;
                }
                throw error;
              });
            if (requestedDestinationStat?.isSymbolicLink()) {
              throw new Error(
                "JOB_RESULT_SCOPE: final result destination must not be a symlink."
              );
            }

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

            const token = randomUUID();
            const temp = path.join(
              path.dirname(destination),
              `.${path.basename(destination)}.${token}.tmp`
            );
            const backup = existing
              ? path.join(
                  path.dirname(destination),
                  `.${path.basename(destination)}.${token}.bak`
                )
              : null;
            try {
              await fs.writeFile(temp, content);
              if (backup) {
                await fs.rename(destination, backup);
              }
              try {
                await fs.rename(temp, destination);
              } catch (error) {
                if (backup) {
                  await fs.rename(backup, destination).catch(
                    () => undefined
                  );
                }
                throw error;
              }
              if (backup) {
                await fs.rm(backup, { force: true });
              }
            } finally {
              await fs.rm(temp, { force: true }).catch(() => undefined);
              if (backup) {
                const destinationExists = await fs
                  .stat(destination)
                  .then(() => true, () => false);
                if (destinationExists) {
                  await fs.rm(backup, { force: true }).catch(
                    () => undefined
                  );
                }
              }
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
