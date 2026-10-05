import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { getJobRunRoot } from "../lib/appdata.js";
import { toCadgptPath } from "../lib/path-security.js";
import { isWorkExecutionActive } from "../lib/work-registration.js";

interface JobWorkspaceState {
  execution_id: string;
  job_id: string;
  root: string;
}

const jobWorkspaceByExecution = new Map<string, JobWorkspaceState>();
const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const MARKER = ".cadgpt-job-workspace.json";

function safeJobId(value: string): string {
  const jobId = value.trim();
  if (!SAFE_JOB_ID.test(jobId) || jobId === "." || jobId === "..") {
    throw new Error("JOB_WORKSPACE_ID_INVALID: job_id must be a safe CadGPT id.");
  }
  return jobId;
}

function executionSegment(executionId: string): string {
  return createHash("sha256").update(executionId).digest("hex").slice(0, 24);
}

async function removeIfEmpty(target: string): Promise<void> {
  try {
    await fs.rmdir(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
  }
}

async function pruneStaleJobWorkspaces(jobRoot: string): Promise<void> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(jobRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(jobRoot, entry.name);
    let executionId = "";
    try {
      const marker = JSON.parse(
        await fs.readFile(path.join(candidate, MARKER), "utf8")
      ) as { execution_id?: unknown };
      executionId =
        typeof marker.execution_id === "string" ? marker.execution_id : "";
    } catch {
      executionId = "";
    }
    if (executionId && isWorkExecutionActive(executionId)) continue;
    await fs.rm(candidate, { recursive: true, force: true });
  }
}

async function writeMarker(state: JobWorkspaceState): Promise<void> {
  await fs.writeFile(
    path.join(state.root, MARKER),
    JSON.stringify(
      {
        version: 1,
        execution_id: state.execution_id,
        job_id: state.job_id,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

export function jobWorkspaceForExecution(
  executionId: string
): JobWorkspaceState | null {
  const state = jobWorkspaceByExecution.get(executionId);
  return state ? { ...state } : null;
}

export function jobWorkspaceRootsForExecution(
  executionId: string
): string[] {
  const state = jobWorkspaceByExecution.get(executionId);
  return state ? [state.root] : [];
}

export async function beginJobWorkspaceForExecution(
  executionId: string,
  requestedJobId: string
): Promise<JobWorkspaceState> {
  const jobId = safeJobId(requestedJobId);
  const prior = jobWorkspaceByExecution.get(executionId);
  if (prior) {
    jobWorkspaceByExecution.delete(executionId);
    await fs.rm(prior.root, { recursive: true, force: true });
    await removeIfEmpty(path.dirname(prior.root));
  }

  const jobRoot = path.join(getJobRunRoot(), jobId);
  await fs.mkdir(jobRoot, { recursive: true });
  await pruneStaleJobWorkspaces(jobRoot);

  const root = path.join(jobRoot, executionSegment(executionId));
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });

  const state: JobWorkspaceState = {
    execution_id: executionId,
    job_id: jobId,
    root,
  };
  await writeMarker(state);
  jobWorkspaceByExecution.set(executionId, state);
  return { ...state };
}

export async function ensureJobWorkspaceForExecution(
  executionId: string,
  requestedJobId: string
): Promise<JobWorkspaceState> {
  const jobId = safeJobId(requestedJobId);
  const current = jobWorkspaceByExecution.get(executionId);
  if (current && current.job_id === jobId) {
    try {
      const stat = await fs.stat(current.root);
      if (stat.isDirectory()) return { ...current };
    } catch {
      // Recreate below.
    }
  }
  return beginJobWorkspaceForExecution(executionId, jobId);
}

export async function transferJobWorkspaceForExecution(
  previousExecutionId: string,
  successorExecutionId: string
): Promise<boolean> {
  const state = jobWorkspaceByExecution.get(previousExecutionId);
  if (!state) return false;
  jobWorkspaceByExecution.delete(previousExecutionId);
  const transferred: JobWorkspaceState = {
    ...state,
    execution_id: successorExecutionId,
  };
  jobWorkspaceByExecution.set(successorExecutionId, transferred);
  await writeMarker(transferred).catch(() => undefined);
  return true;
}

export async function cleanupJobWorkspaceForExecution(
  executionId: string
): Promise<Record<string, unknown>> {
  const state = jobWorkspaceByExecution.get(executionId);
  jobWorkspaceByExecution.delete(executionId);
  if (!state) {
    return {
      execution_id: executionId,
      deleted: false,
      path: null,
    };
  }

  await fs.rm(state.root, { recursive: true, force: true });
  await removeIfEmpty(path.dirname(state.root));
  return {
    execution_id: executionId,
    job_id: state.job_id,
    deleted: true,
    path: toCadgptPath(state.root),
    absolute_path: state.root,
  };
}
