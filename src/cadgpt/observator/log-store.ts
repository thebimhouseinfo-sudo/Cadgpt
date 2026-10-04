import fs from "node:fs/promises";
import path from "node:path";

import { getDrawingStorageRoot } from "../lib/appdata.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";

export interface ObservationLogRecord {
  [key: string]: unknown;
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function requireSafeSegment(value: string, field: string): string {
  const clean = value.trim();
  if (!SAFE_SEGMENT.test(clean) || clean === "." || clean === "..") {
    throw new Error(
      `${field} must contain only letters, numbers, dot, underscore or dash and cannot be a path segment`
    );
  }
  return clean;
}

export function getDrawingsRoot(): string {
  return getDrawingStorageRoot();
}

export function getDrawingRoot(drawingAnchor: string): string {
  return path.join(
    getDrawingsRoot(),
    requireSafeSegment(drawingAnchor, "drawing_anchor")
  );
}

export function getObservationLogPath(
  drawingAnchor: string,
  logName = "entities"
): string {
  const safeLogName = requireSafeSegment(logName, "log_name");
  return path.join(
    getDrawingRoot(drawingAnchor),
    "observator",
    `${safeLogName}.jsonl`
  );
}

export async function appendObservationRecords(
  drawingAnchor: string,
  records: ObservationLogRecord[],
  logName = "entities"
): Promise<{
  drawing_anchor: string;
  log_name: string;
  path: string;
  appended: number;
}> {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("records must be a non-empty array");
  }

  const safeDrawingAnchor = requireSafeSegment(
    drawingAnchor,
    "drawing_anchor"
  );
  const safeLogName = requireSafeSegment(logName, "log_name");
  const logPath = getObservationLogPath(
    safeDrawingAnchor,
    safeLogName
  );
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const now = new Date().toISOString();
  const lines = records.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("every record must be an object");
    }
    return JSON.stringify({
      recorded_at: now,
      drawing_anchor: safeDrawingAnchor,
      ...record,
    });
  });

  return withFileMutationLocks([logPath], async () => {
    await fs.appendFile(
      logPath,
      `${lines.join("\n")}\n`,
      "utf8"
    );
    return {
      drawing_anchor: safeDrawingAnchor,
      log_name: safeLogName,
      path: logPath,
      appended: lines.length,
    };
  });
}
