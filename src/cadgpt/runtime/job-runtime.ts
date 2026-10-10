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
import { drawingMetadataRootsForExecution } from "./drawing-persistence.js";

export interface JobRuntimeContext {
  execution_id: string;
  job_id: string;
  job_name: string;
  job_root: string;
  runtime_root: string;
  result_roots: Set<string>;
  runtime_reset: boolean;
  runtime_created: boolean;
  runtime_existing_entries: number;
  recovery_pending: boolean;
}

export interface PrepareJobRuntimeOptions {
  /**
   * Direct Jobs require deterministic clean scratch for every dispatch.
   * Reasoning Jobs preserve runtime bytes so interrupted raw queues can resume.
   */
  resetRuntime?: boolean;
}

const contextsByExecution =
  new Map<string, JobRuntimeContext>();
const contextsBySystemToolId =
  new Map<string, JobRuntimeContext>();
const executionByJobRoot =
  new Map<string, string>();

// Only Reasoning Jobs need file-tool write boundaries. Direct Python Jobs
// use their existing fixed executor; this marker never applies to them.
// Keep the boundary after job_runtime_finish until the parent Work ends.
const reasoningScopedExecutions = new Set<string>();

export function reasoningJobStorageScopeWasEntered(executionId: string): boolean {
  return reasoningScopedExecutions.has(executionId);
}

export function clearReasoningJobStorageScopeForExecution(executionId: string): void {
  reasoningScopedExecutions.delete(executionId);
}

/**
 * Job Steps is only a per-Job checklist; never a workflow engine or a
 * persistent source of truth. It stays under Job-owned runtime scratch.
 */
export const JOB_STEPS_FILENAME = "JOB_STEPS.md";

export function jobStepsPath(context: JobRuntimeContext): string {
  return path.join(context.runtime_root, JOB_STEPS_FILENAME);
}

/** Reset ONLY the ✓/✗ progress marks, preserving Job steps and raw/result data. */
export async function resetJobStepsForRuntime(runtimeRoot: string): Promise<boolean> {
  const file = path.join(runtimeRoot, JOB_STEPS_FILENAME);
  return withFileMutationLocks([file], async () => {
    let info;
    try {
      info = await fs.lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("JOB_STEPS_NOT_REGULAR_FILE: refusing to alter unexpected Job Steps asset.");
    }
    const original = await fs.readFile(file, "utf8");
    const restored = original.replace(
      /^(\s*-\s*)\[(?:✓|✗|v|x|X)\](?=\s)/gm,
      "$1[ ]"
    );
    if (restored === original) return false;
    const tmp = path.join(runtimeRoot, `.${JOB_STEPS_FILENAME}.${process.pid}.${Date.now()}.tmp`);
    try {
      await fs.writeFile(tmp, restored, { encoding: "utf8", flag: "wx" });
      await fs.rename(tmp, file);
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
    return true;
  });
}

function systemToolKey(toolId: string): string {
  return toolId.trim().toLowerCase();
}

function jobRootKey(jobRoot: string): string {
  const resolved = path.resolve(jobRoot);
  return process.platform === "win32"
    ? resolved.toLowerCase()
    : resolved;
}

async function canonicalExistingPath(
  target: string
): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code ===
      "ENOENT"
    ) {
      return path.resolve(target);
    }
    throw error;
  }
}

async function managedJobRootForFile(
  jobFile: string
): Promise<string> {
  const absolute =
    await canonicalExistingPath(jobFile);
  const root = path.dirname(absolute);
  const [librariesRoot, draftRoot] =
    await Promise.all([
      canonicalExistingPath(
        getJobLibrariesRoot()
      ),
      canonicalExistingPath(
        getJobDraftRoot()
      ),
    ]);
  if (
    !isPathInside(root, librariesRoot) &&
    !isPathInside(root, draftRoot)
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

/** Foreground Job contexts retained across logical MCP sessions. */
/** Detached runtime contexts can outlive the original ChatGPT execution. */
export function activeDetachedJobRuntimeToolIds(): string[] {
  return [...contextsBySystemToolId.keys()];
}

export function activeForegroundJobRuntimeExecutionIds(): string[] {
  return [...contextsByExecution.keys()];
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

async function cleanupJobRuntimeContext(
  context: JobRuntimeContext,
  ownerId: string,
  options: { resetJobSteps?: boolean } = {}
): Promise<Record<string, unknown>> {
  let removedEmptyResultRoots = 0;
  const jobsParents = new Set<string>();
  try {
    // FINISH, STOP, failed Job, or new Job: restore the Job Steps marks.
    // On an internal re-prepare of the same active Job, keep its progress.
    const stepsReset = options.resetJobSteps === false
      ? false
      : await resetJobStepsForRuntime(context.runtime_root);
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
      job_steps_path: jobStepsPath(context),
      job_steps_reset: stepsReset,
      removed_empty_result_roots:
        removedEmptyResultRoots,
    };
  } finally {
    const rootKey = jobRootKey(context.job_root);
    if (executionByJobRoot.get(rootKey) === ownerId) {
      executionByJobRoot.delete(rootKey);
    }
  }
}

export function detachJobRuntimeForSystemLease(
  executionId: string,
  toolId: string
): JobRuntimeContext {
  const context = contextsByExecution.get(executionId);
  if (!context) {
    throw new Error(
      "JOB_RUNTIME_NOT_PREPARED: call job_runtime_prepare before acquiring a Job SYSTEM lease."
    );
  }
  if (
    context.job_id.toLowerCase() !==
    toolId.trim().toLowerCase()
  ) {
    throw new Error(
      `SYSTEM_LEASE_JOB_MISMATCH: active Job '${context.job_id}' cannot acquire tool_id '${toolId}'.`
    );
  }

  const key = systemToolKey(toolId);
  if (contextsBySystemToolId.has(key)) {
    throw new Error(
      `SYSTEM_LEASE_BUSY: Job SYSTEM runtime '${toolId}' is already active.`
    );
  }

  const rootKey = jobRootKey(context.job_root);
  if (executionByJobRoot.get(rootKey) !== executionId) {
    throw new Error(
      "JOB_RUNTIME_OWNERSHIP_LOST: foreground execution no longer owns this Job runtime."
    );
  }

  contextsByExecution.delete(executionId);
  contextsBySystemToolId.set(key, context);
  executionByJobRoot.set(rootKey, `system:${key}`);
  return context;
}

export async function cleanupJobRuntimeForSystemLease(
  toolId: string
): Promise<Record<string, unknown>> {
  const key = systemToolKey(toolId);
  const context = contextsBySystemToolId.get(key);
  contextsBySystemToolId.delete(key);
  if (!context) {
    return {
      active: false,
      removed_empty_result_roots: 0,
    };
  }
  return cleanupJobRuntimeContext(
    context,
    `system:${key}`
  );
}

export async function cleanupJobRuntimeForExecution(
  executionId: string,
  options: { resetJobSteps?: boolean } = {}
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
  return cleanupJobRuntimeContext(context, executionId, options);
}

export async function prepareJobRuntimeForExecution(
  executionId: string,
  jobId: string,
  jobFile: string,
  options: PrepareJobRuntimeOptions = {}
): Promise<JobRuntimeContext> {
  const jobRoot =
    await managedJobRootForFile(jobFile);
  const runtimeRoot = path.join(jobRoot, "runtime");
  const current =
    contextsByExecution.get(executionId);

  if (
    current &&
    jobRootKey(current.job_root) !==
      jobRootKey(jobRoot)
  ) {
    await cleanupJobRuntimeForExecution(
      executionId
    );
  }

  return withFileMutationLocks(
    [jobRoot, runtimeRoot],
    async () => {
      const rootKey = jobRootKey(jobRoot);
      const existingExecution =
        executionByJobRoot.get(rootKey);
      if (
        existingExecution &&
        existingExecution !== executionId
      ) {
        throw new Error(
          `JOB_RUNTIME_BUSY: Job runtime is already owned by another active execution (${existingExecution}). Finish that Job run before starting the same Job elsewhere.`
        );
      }

      if (
        contextsByExecution.get(executionId) &&
        jobRootKey(
          contextsByExecution.get(executionId)!
            .job_root
        ) === jobRootKey(jobRoot)
      ) {
        await cleanupJobRuntimeForExecution(
          executionId,
          { resetJobSteps: false }
        );
      }

      // Claim before the first filesystem await. The per-root mutation
      // lock keeps another execution from observing an unclaimed gap while
      // runtime ownership changes. Reasoning Jobs preserve runtime bytes for
      // crash/relaunch recovery; Direct Jobs explicitly request a reset.
      executionByJobRoot.set(
        rootKey,
        executionId
      );
      try {
        const resetRuntime =
          options.resetRuntime === true;
        let runtimeCreated = false;

        if (resetRuntime) {
          await fs.rm(runtimeRoot, {
            recursive: true,
            force: true,
          });
          await fs.mkdir(runtimeRoot, {
            recursive: true,
          });
          runtimeCreated = true;
        } else {
          try {
            const stat = await fs.stat(runtimeRoot);
            if (!stat.isDirectory()) {
              throw new Error(
                "JOB_RUNTIME_CONFLICT: runtime path exists but is not a directory."
              );
            }
          } catch (error) {
            if (
              (error as NodeJS.ErrnoException)
                .code !== "ENOENT"
            ) {
              throw error;
            }
            await fs.mkdir(runtimeRoot, {
              recursive: true,
            });
            runtimeCreated = true;
          }
        }

        // A freshly claimed run resets stale ✓/✗ marks (including after a
        // driver crash), but repeated prepare in the SAME active execution
        // keeps its progress; none of this touches actual raw/results.
        if (!current || jobRootKey(current.job_root) !== rootKey) {
          await resetJobStepsForRuntime(runtimeRoot);
        }
        const runtimeEntries =
          (await fs.readdir(runtimeRoot)).filter(
            (entry) => entry !== JOB_STEPS_FILENAME
          );
        const context: JobRuntimeContext = {
          execution_id: executionId,
          job_id: jobId,
          job_name: jobNameForRoot(jobRoot),
          job_root: jobRoot,
          runtime_root: runtimeRoot,
          result_roots: new Set<string>(),
          runtime_reset: resetRuntime,
          runtime_created: runtimeCreated,
          runtime_existing_entries:
            runtimeEntries.length,
          recovery_pending:
            !resetRuntime &&
            runtimeEntries.length > 0,
        };
        contextsByExecution.set(
          executionId,
          context
        );
        if (!resetRuntime) reasoningScopedExecutions.add(executionId);
        return context;
      } catch (error) {
        if (
          executionByJobRoot.get(rootKey) ===
          executionId
        ) {
          executionByJobRoot.delete(rootKey);
        }
        throw error;
      }
    }
  );
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
  const authorizedDrawingRoots =
    drawingMetadataRootsForExecution(
      executionId
    ).map((root) => path.resolve(root));
  if (
    !authorizedDrawingRoots.some(
      (root) => root === resolvedDrawingRoot
    )
  ) {
    throw new Error(
      "JOB_RESULT_DRAWING_ROOT_NOT_AUTHORIZED: result namespace must derive from the current execution's tool-authorized drawing root."
    );
  }

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
