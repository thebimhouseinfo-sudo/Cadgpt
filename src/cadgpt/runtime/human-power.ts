import fs from "node:fs/promises";
import path from "node:path";

import { getAppDataPath } from "../lib/appdata.js";
import { getRepoRoot, isPathInside, toCadgptPath } from "../lib/path-security.js";
import {
  humanPowerForExecution,
  type HumanPowerGrant,
} from "../lib/work-registration.js";
import { withFileMutationLocks } from "./file-scheduler.js";

export interface HumanPowerSourceAuditInput {
  executionId: string;
  target: string;
  action: "create" | "edit";
  fixSummary: string;
  sha256Before?: string | null;
  sha256After: string;
}

export function humanPowerErrorLogPath(): string {
  return getAppDataPath("logs", "human-power-error-log.jsonl");
}

export function isCadGptSourcePath(target: string): boolean {
  return isPathInside(path.resolve(target), getRepoRoot());
}

async function appendEvent(
  event: Record<string, unknown>
): Promise<string> {
  const logPath = humanPowerErrorLogPath();
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await withFileMutationLocks([logPath], async () => {
    await fs.appendFile(
      logPath,
      `${JSON.stringify(event)}\n`,
      "utf8"
    );
  });
  return logPath;
}

export async function logHumanPowerStart(
  executionId: string,
  grant: HumanPowerGrant
): Promise<string> {
  return appendEvent({
    event: "HUMAN_POWER_STARTED",
    timestamp: new Date().toISOString(),
    execution_id: executionId,
    grant_id: grant.grantId,
    task: grant.task,
    reason: grant.reason,
    error_description: grant.errorDescription,
    expected_behavior: grant.expectedBehavior,
  });
}

export async function logHumanPowerStop(
  executionId: string,
  grant: HumanPowerGrant | null,
  outcome: string
): Promise<string> {
  return appendEvent({
    event: "HUMAN_POWER_STOPPED",
    timestamp: new Date().toISOString(),
    execution_id: executionId,
    grant_id: grant?.grantId ?? null,
    task: grant?.task ?? null,
    outcome,
  });
}

export async function auditHumanPowerSourceMutation(
  input: HumanPowerSourceAuditInput
): Promise<string> {
  const grant = humanPowerForExecution(input.executionId);
  if (!grant) {
    throw new Error(
      "HUMAN_POWER_REQUIRED: source mutation outside normal CadGPT roots requires active Human Power."
    );
  }
  const fixSummary = input.fixSummary.trim();
  if (!fixSummary) {
    throw new Error(
      "HUMAN_POWER_SOURCE_FIX_REQUIRED: explain exactly how the source change fixes the recorded error."
    );
  }
  if (!isCadGptSourcePath(input.target)) {
    throw new Error(
      "HUMAN_POWER_SOURCE_SCOPE: audited source mutation must target the CadGPT repository."
    );
  }

  return appendEvent({
    event: "HUMAN_POWER_SOURCE_CHANGED",
    timestamp: new Date().toISOString(),
    execution_id: input.executionId,
    grant_id: grant.grantId,
    task: grant.task,
    error_description: grant.errorDescription,
    expected_behavior: grant.expectedBehavior,
    fix_summary: fixSummary,
    action: input.action,
    path: toCadgptPath(input.target),
    absolute_path: path.resolve(input.target),
    sha256_before: input.sha256Before ?? null,
    sha256_after: input.sha256After,
  });
}
