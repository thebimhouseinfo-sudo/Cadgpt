import {
  cleanupJobRuntimeForExecution,
  cleanupJobRuntimeForSystemLease,
} from "./job-runtime.js";
import {
  activeJobSystemLeasesForSession,
  releaseJobSystemLease,
} from "./system-lease.js";

export interface JobTransitionCleanup {
  foreground: Record<string, unknown>;
  released_system_jobs: Array<{
    tool_id: string;
    job_id: string;
    job_name: string;
    cleanup: Record<string, unknown>;
    cleanup_error?: string;
  }>;
}

/**
 * Current online-model execution is sequential: starting a new Job means any
 * prior inline Reasoning Job authority in this logical chat is stale. Release
 * foreground/SYSTEM authority but preserve runtime/result bytes so interrupted
 * raw queues can be resumed later. A future true background worker must own a
 * distinct lifecycle before this policy is broadened.
 */
export async function releasePriorJobAuthorityForStart(input: {
  executionId: string;
  sessionKey: string;
}): Promise<JobTransitionCleanup> {
  const foreground =
    await cleanupJobRuntimeForExecution(
      input.executionId
    ).catch((error) => ({
      active: false,
      cleanup_error:
        error instanceof Error
          ? error.message
          : String(error),
    }));

  const releasedSystemJobs: JobTransitionCleanup["released_system_jobs"] =
    [];

  for (const lease of activeJobSystemLeasesForSession(
    input.sessionKey
  )) {
    let cleanup: Record<string, unknown> = {
      active: false,
    };
    let cleanupError: string | undefined;

    try {
      cleanup =
        await cleanupJobRuntimeForSystemLease(
          lease.tool_id
        );
    } catch (error) {
      cleanupError =
        error instanceof Error
          ? error.message
          : String(error);
    } finally {
      releaseJobSystemLease(
        lease.tool_id,
        input.sessionKey
      );
    }

    releasedSystemJobs.push({
      tool_id: lease.tool_id,
      job_id: lease.job_id,
      job_name: lease.job_name,
      cleanup,
      ...(cleanupError
        ? { cleanup_error: cleanupError }
        : {}),
    });
  }

  return {
    foreground,
    released_system_jobs:
      releasedSystemJobs,
  };
}
