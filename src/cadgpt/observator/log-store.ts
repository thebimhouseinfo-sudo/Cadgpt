import fs from "node:fs/promises";
import path from "node:path";

import { getDrawingsRoot } from "../lib/appdata.js";

export interface ObservationLogRecord {
  [key: string]: unknown;
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function requireSafeSegment(value: string, field: string): string {
  const clean = value.trim();
  if (!SAFE_SEGMENT.test(clean) || clean === "." || clean === "..") {
    throw new Error(`${field} must contain only letters, numbers, dot, underscore or dash and cannot be a path segment`);
  }
  return clean;
}

export function getDrawingRoot(drawingId: string): string {
  return path.join(getDrawingsRoot(), requireSafeSegment(drawingId, "drawing_id"));
}

export function getObservationLogPath(drawingId: string, logName = "entities"): string {
  const safeLogName = requireSafeSegment(logName, "log_name");
  return path.join(getDrawingRoot(drawingId), "observator", `${safeLogName}.jsonl`);
}

export async function appendObservationRecords(
  drawingId: string,
  records: ObservationLogRecord[],
  logName = "entities"
): Promise<{ drawing_id: string; log_name: string; path: string; appended: number }> {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("records must be a non-empty array");
  }

  const safeDrawingId = requireSafeSegment(drawingId, "drawing_id");
  const logPath = getObservationLogPath(safeDrawingId, logName);
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const now = new Date().toISOString();
  const lines = records.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("every record must be an object");
    }
    return JSON.stringify({ recorded_at: now, drawing_id: safeDrawingId, ...record });
  });

  await fs.appendFile(logPath, `${lines.join("\n")}\n`, "utf8");
  return {
    drawing_id: safeDrawingId,
    log_name: requireSafeSegment(logName, "log_name"),
    path: logPath,
    appended: lines.length,
  };
}
