import fs from "node:fs/promises";
import path from "node:path";

import {
  getJobDraftRoot,
  getJobLibrariesRoot,
} from "../lib/appdata.js";
import {
  isPathInside,
  toCadgptPath,
} from "../lib/path-security.js";
import { withFileMutationLocks } from "./file-scheduler.js";

export interface JobRuntimeContext {
  execution_id: string;
  job_id: string;
  job_name: string;
  job_root: string;
  runtime_root: string;
  result_roots: Set<string>;
}

const contextsByExecution =
  new Map<string, JobRuntimeContext>();

function managedJobRootForFile(jobFile: string): string {
  const absolute = path.resolve(jobFile);
  const root = path.dirname(absolute);
  if (
    !isPathInside(root, getJobLibrariesRoot()) &&
    !isPathInside(root, getJobDraftRoot())
  ) {
    throw new Error(
      "JOB_RUNTIME_SCOPE: Job runtime must belong to one managed Job library or Job draft package."
    );
  }
  return root;
}

function jobNameForRoot(jobRoot: string): string {
  const name = path.basename(jobRoot).trim();
  if (!name || name === "." || name === "..") {
    throw new Error(
      "JOB_RUNTIME_NAME_INVALID: Job package has no safe folder name."
    );
  }
  return name;
}

async function removeIfEmpty(
  target: string
): Promise<boolean> {
  try {
    const entries = await fs.readdir(target);
    if (entries.length > 0) return false;
    await fs.rmdir(target);
    return true;
  } catch (error) {
    const code =
      (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return true;
    if (code === "ENOTEMPTY") return false;
    throw error;
  }
}

export function activeJobRuntimeForExecution(
  executionId: string
): JobRuntimeContext | null {
  return contextsByExecution.get(executionId) ?? null;
}

export function jobRuntimeWritableRootsForExecution(
  executionId: string
): string[] {
  const context =
    contextsByExecution.get(executionId);
  if (!context) return [];
  return [
    context.runtime_root,
    ...context.result_roots,
  ];
}

export async function cleanupJobRuntimeForExecution(
  executionId: string
): Promise<Record<string, unknown>> {
  const context =
    contextsByExecution.get(executionId);
  contextsByExecution.delete(executionId);
  if (!context) {
    return {
      active: false,
      removed_empty_result_roots: 0,
    };
  }

  let removedEmptyResultRoots = 0;
  const jobsParents = new Set<string>();
  for (const resultRoot of context.result_roots) {
    jobsParents.add(path.dirname(resultRoot));
    if (await removeIfEmpty(resultRoot)) {
      removedEmptyResultRoots += 1;
    }
  }
  for (const jobsRoot of jobsParents) {
    if (path.basename(jobsRoot) === "jobs") {
      await removeIfEmpty(jobsRoot);
    }
  }

  return {
    active: true,
    job_id: context.job_id,
    job_name: context.job_name,
    runtime_root: context.runtime_root,
    removed_empty_result_roots:
      removedEmptyResultRoots,
  };
}

export async function prepareJobRuntimeForExecution(
  executionId: string,
  jobId: string,
  jobFile: string
): Promise<JobRuntimeContext> {
  await cleanupJobRuntimeForExecution(executionId);

  const jobRoot = managedJobRootForFile(jobFile);
  const runtimeRoot = path.join(jobRoot, "runtime");
  await withFileMutationLocks(
    [runtimeRoot],
    async () => {
      await fs.rm(runtimeRoot, {
        recursive: true,
        force: true,
      });
      await fs.mkdir(runtimeRoot, {
        recursive: true,
      });
    }
  );

  const context: JobRuntimeContext = {
    execution_id: executionId,
    job_id: jobId,
    job_name: jobNameForRoot(jobRoot),
    job_root: jobRoot,
    runtime_root: runtimeRoot,
    result_roots: new Set<string>(),
  };
  contextsByExecution.set(executionId, context);
  return context;
}

export async function prepareJobResultLocationForExecution(
  executionId: string,
  drawingRoot: string
): Promise<Record<string, unknown>> {
  const context =
    contextsByExecution.get(executionId);
  if (!context) {
    throw new Error(
      "JOB_RUNTIME_NOT_PREPARED: call job_runtime_prepare before requesting a reasoning Job result location."
    );
  }

  const resolvedDrawingRoot =
    path.resolve(drawingRoot);
  const jobsRoot = path.join(
    resolvedDrawingRoot,
    "jobs"
  );
  const resultRoot = path.join(
    jobsRoot,
    `${context.job_name}-result`
  );
  if (
    !isPathInside(resultRoot, resolvedDrawingRoot)
  ) {
    throw new Error(
      "JOB_RESULT_SCOPE: Job result path escapes the tool-provided drawing root."
    );
  }

  await withFileMutationLocks(
    [jobsRoot, resultRoot],
    async () => {
      await fs.mkdir(resultRoot, {
        recursive: true,
      });
      const stat = await fs.stat(resultRoot);
      if (!stat.isDirectory()) {
        throw new Error(
          "JOB_RESULT_CONFLICT: Job result path exists but is not a directory."
        );
      }
    }
  );
  context.result_roots.add(resultRoot);

  return {
    job_id: context.job_id,
    job_name: context.job_name,
    path: toCadgptPath(resultRoot),
    absolute_path: resultRoot,
    file_access_authorized: true,
  };
}
