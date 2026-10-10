import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

import { getAppDataPath } from "./appdata.js";
import { getRepoRoot } from "./path-security.js";

// Epoch 2 introduces Job Steps, HYBRID-by-default, fresh workflow loading,
// and explicit user-visible platform/source failures. Existing User Jobs
// may need updated instructions before they are safe to run again.
export const JOB_LOCAL_COMPAT_EPOCH = 2;

/**
 * Hash the small, version-controlled behavior contract, not User Job sources.
 * This O(1) source check catches future contract text drift even when a
 * developer forgets to bump the integer epoch. Actual AppData scanning stays
 * gated behind an explicit user-visible CONTRACT UPDATE.
 */
export async function getJobContractFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  for (const name of [
    "knowledge/jobs/JOB_RULES.md",
    "knowledge/jobs/REASONING_HARNESS.md",
    "knowledge/jobs/LOCAL_COMPAT_UPDATE.md",
  ]) {
    const text = await fs.readFile(path.join(getRepoRoot(), name));
    hash.update(name);
    hash.update("\0");
    hash.update(text);
    hash.update("\n");
  }
  return hash.digest("hex");
}

interface JobLocalCompatState {
  checked_epoch?: number;
  checked_fingerprint?: string;
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
  source_fingerprint: string;
  checked_fingerprint: string | null;
  update_reason: "epoch_changed" | "contract_changed" | null;
  update_required: boolean;
  pending_actions: string[];
  report_summary: string | null;
}> {
  const state = await readState();
  const checkedEpoch = Number(
    state.checked_epoch ?? 0
  );
  const sourceFingerprint = await getJobContractFingerprint();
  const checkedFingerprint = typeof state.checked_fingerprint === "string"
    ? state.checked_fingerprint
    : null;
  const epochChanged = checkedEpoch !== JOB_LOCAL_COMPAT_EPOCH;
  const fingerprintChanged = checkedFingerprint !== sourceFingerprint;
  return {
    source_epoch: JOB_LOCAL_COMPAT_EPOCH,
    checked_epoch: checkedEpoch,
    source_fingerprint: sourceFingerprint,
    checked_fingerprint: checkedFingerprint,
    update_reason: epochChanged
      ? "epoch_changed"
      : fingerprintChanged ? "contract_changed" : null,
    update_required: epochChanged || fingerprintChanged,
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
  const sourceFingerprint = await getJobContractFingerprint();
  const next: JobLocalCompatState = {
    checked_epoch: JOB_LOCAL_COMPAT_EPOCH,
    checked_fingerprint: sourceFingerprint,
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
