import {
  activeDetachedJobRuntimeToolIds,
  activeForegroundJobRuntimeExecutionIds,
  cleanupJobRuntimeForExecution,
  cleanupJobRuntimeForSystemLease,
} from "./job-runtime.js";
import {
  activeJobSystemLeasesForSession,
  allActiveJobSystemLeases,
  jobSystemLeaseHasInFlightCall,
  releaseJobSystemLease,
} from "./system-lease.js";
import {
  activeJobWorkExecutionIds,
  hasActiveToolLeaseForExecution,
  retireIdleJobWorkForExecution,
} from "../lib/work-registration.js";
import { cleanupExecutionState } from "./execution-cleanup.js";

export interface JobTransitionCleanup {
  foreground: Record<string, unknown>;
  released_system_jobs: Array<{
    tool_id: string;
    job_id: string;
    job_name: string;
    cleanup: Record<string, unknown>;
    cleanup_error?: string;
  }>;
  retired_other_sessions: {
    system_jobs: string[];
    foreground_executions: string[];
    job_work_executions: string[];
  };
}

// Serialize host-close and Job-start transitions within one driver process.
let transitionTail: Promise<void> = Promise.resolve();
async function serializeJobTransition<T>(action: () => Promise<T>): Promise<T> {
  const prior = transitionTail;
  let release!: () => void;
  transitionTail = new Promise<void>((resolve) => { release = resolve; });
  await prior;
  try {
    return await action();
  } finally {
    release();
  }
}

/**
 * Host-close cleanup is separate from normal new-Job admission. Only an
 * explicit terminal host-close may retire idle authorities across chats.
 * A new Job in Chat B must never call this cross-chat cleanup path.
 * Never terminate an in-flight tool or SYSTEM file call.
 */
async function terminalizeIdleJobAuthoritiesUnlocked(input: {
  excludeSessionKey?: string;
  excludeExecutionId?: string;
  reason: "new_job" | "cad_host_closed";
}): Promise<JobTransitionCleanup["retired_other_sessions"]> {
  const systemLeases = allActiveJobSystemLeases().filter(
    (lease) => lease.session_key !== input.excludeSessionKey
  );
  const systemIds = new Set(systemLeases.map((lease) => lease.tool_id.toLowerCase()));
  const orphanSystemIds = activeDetachedJobRuntimeToolIds().filter(
    (id) => !systemIds.has(id.toLowerCase()) &&
      !allActiveJobSystemLeases().some((lease) =>
        lease.tool_id.toLowerCase() === id.toLowerCase())
  );
  const foregroundIds = activeForegroundJobRuntimeExecutionIds().filter(
    (id) => id !== input.excludeExecutionId
  );
  const jobWorkIds = activeJobWorkExecutionIds().filter(
    (id) => id !== input.excludeExecutionId
  );

  for (const lease of systemLeases) {
    if (jobSystemLeaseHasInFlightCall(lease.tool_id)) {
      throw new Error(
        `JOB_TRANSITION_BUSY: detached Job '${lease.job_id}' is running an actual SYSTEM tool call; do not interrupt it mid-operation.`
      );
    }
  }
  for (const toolId of orphanSystemIds) {
    if (jobSystemLeaseHasInFlightCall(toolId)) {
      throw new Error(
        `JOB_TRANSITION_BUSY: detached Job '${toolId}' is completing a SYSTEM call.`
      );
    }
  }
  for (const executionId of new Set([...foregroundIds, ...jobWorkIds])) {
    if (hasActiveToolLeaseForExecution(executionId)) {
      throw new Error(
        `JOB_TRANSITION_BUSY: prior execution '${executionId}' has a live tool call; retry after its safe boundary.`
      );
    }
  }

  // All guards passed. Revoke SYSTEM leases and old Job work synchronously
  // before any await; new calls from an old chat are now rejected.
  for (const lease of systemLeases) {
    releaseJobSystemLease(lease.tool_id, lease.session_key);
  }
  for (const executionId of jobWorkIds) {
    retireIdleJobWorkForExecution(executionId);
  }
  for (const toolId of [...systemLeases.map((lease) => lease.tool_id), ...orphanSystemIds]) {
    await cleanupJobRuntimeForSystemLease(toolId);
  }
  for (const executionId of foregroundIds) {
    await cleanupJobRuntimeForExecution(executionId);
  }
  for (const executionId of jobWorkIds) {
    await cleanupExecutionState(executionId);
  }
  return {
    system_jobs: systemLeases.map((lease) => lease.job_id),
    foreground_executions: foregroundIds,
    job_work_executions: jobWorkIds,
  };
}

export async function terminalizeIdleJobAuthorities(input: {
  excludeSessionKey?: string;
  excludeExecutionId?: string;
  reason: "new_job" | "cad_host_closed";
}): Promise<JobTransitionCleanup["retired_other_sessions"]> {
  return serializeJobTransition(() => terminalizeIdleJobAuthoritiesUnlocked(input));
}

/** Replace prior Job authority only inside this chat. Other chats keep running. */
export async function releasePriorJobAuthorityForStart(input: {
  executionId: string;
  sessionKey: string;
}): Promise<JobTransitionCleanup> {
  return serializeJobTransition(async () => {
  const localLeases = activeJobSystemLeasesForSession(input.sessionKey);
  for (const lease of localLeases) {
    if (jobSystemLeaseHasInFlightCall(lease.tool_id)) {
      throw new Error(
        `JOB_TRANSITION_BUSY: Job '${lease.job_id}' has an in-flight SYSTEM operation.`
      );
    }
  }
  // A user-requested Job transition is scoped to the *calling chat*.
  // Other logical chats (including detached SYSTEM tails) retain their
  // leases, runtime bytes and Work authority. Same-Job-root exclusivity is
  // independently enforced by prepareJobRuntimeForExecution().
  const retired: JobTransitionCleanup["retired_other_sessions"] = {
    system_jobs: [],
    foreground_executions: [],
    job_work_executions: [],
  };
  const foreground = await cleanupJobRuntimeForExecution(input.executionId)
    .catch((error) => ({
      active: false,
      cleanup_error: error instanceof Error ? error.message : String(error),
    }));

  const releasedSystemJobs: JobTransitionCleanup["released_system_jobs"] = [];
  for (const lease of localLeases) {
    // Previous SYSTEM authority is revoked, while pending files survive.
    releaseJobSystemLease(lease.tool_id, input.sessionKey);
    let cleanup: Record<string, unknown> = { active: false };
    let cleanupError: string | undefined;
    try {
      cleanup = await cleanupJobRuntimeForSystemLease(lease.tool_id);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error);
    }
    releasedSystemJobs.push({
      tool_id: lease.tool_id,
      job_id: lease.job_id,
      job_name: lease.job_name,
      cleanup,
      ...(cleanupError ? { cleanup_error: cleanupError } : {}),
    });
  }
  return {
    foreground,
    released_system_jobs: releasedSystemJobs,
    retired_other_sessions: retired,
  };
  });
}
