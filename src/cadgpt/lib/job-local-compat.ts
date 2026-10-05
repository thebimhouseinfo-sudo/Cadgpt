import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getAppDataPath } from "./appdata.js";

export const JOB_LOCAL_COMPAT_EPOCH = 1;

interface JobLocalCompatState {
  checked_epoch?: number;
  checked_at?: string;
  scanned_user_jobs?: number;
  report_summary?: string;
  pending_actions?: string[];
}

function statePath(): string {
  return getAppDataPath(
    "state",
    "job-local-compat.json"
  );
}

async function readState(): Promise<JobLocalCompatState> {
  try {
    return JSON.parse(
      await fs.readFile(statePath(), "utf8")
    ) as JobLocalCompatState;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code ===
      "ENOENT"
    ) {
      return {};
    }
    throw error;
  }
}

export async function getJobLocalCompatStatus(): Promise<{
  source_epoch: number;
  checked_epoch: number;
  update_required: boolean;
  pending_actions: string[];
  report_summary: string | null;
}> {
  const state = await readState();
  const checkedEpoch = Number(
    state.checked_epoch ?? 0
  );
  return {
    source_epoch: JOB_LOCAL_COMPAT_EPOCH,
    checked_epoch: checkedEpoch,
    update_required:
      checkedEpoch !== JOB_LOCAL_COMPAT_EPOCH,
    pending_actions: Array.isArray(
      state.pending_actions
    )
      ? state.pending_actions.map(String)
      : [],
    report_summary:
      typeof state.report_summary === "string"
        ? state.report_summary
        : null,
  };
}

export async function markJobLocalCompatChecked(input: {
  scanned_user_jobs: number;
  report_summary: string;
  pending_actions: string[];
}): Promise<void> {
  const target = statePath();
  await fs.mkdir(path.dirname(target), {
    recursive: true,
  });
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`
  );
  const next: JobLocalCompatState = {
    checked_epoch: JOB_LOCAL_COMPAT_EPOCH,
    checked_at: new Date().toISOString(),
    scanned_user_jobs:
      input.scanned_user_jobs,
    report_summary: input.report_summary,
    pending_actions: input.pending_actions,
  };
  try {
    await fs.writeFile(
      temp,
      `${JSON.stringify(next, null, 2)}\n`,
      "utf8"
    );
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(
      () => undefined
    );
  }
}
