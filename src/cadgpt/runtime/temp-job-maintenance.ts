import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getTempJobsRoot } from "../lib/appdata.js";
import { activeWorkForSession } from "../lib/work-registration.js";

type TempRecord = { executionId: string; sessionKey: string; root: string };
const records = new Map<string, TempRecord>();
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tempJobWritableRootForExecution(executionId: string): string | null {
  for (const rec of records.values()) {
    if (rec.executionId === executionId &&
        activeWorkForSession(rec.sessionKey)?.executionId === executionId) return rec.root;
  }
  return null;
}

export async function createOwnedTempJob(executionId: string, sessionKey: string) {
  const existing = [...records.values()].find(
    (rec) => rec.executionId === executionId &&
      activeWorkForSession(rec.sessionKey)?.executionId === executionId
  );
  if (existing) return { id: path.basename(existing.root), root: existing.root, reused: true };
  const id = randomUUID();
  const root = path.join(getTempJobsRoot(), id);
  await fs.mkdir(root, { recursive: true });
  records.set(id, { executionId, sessionKey, root });
  return { id, root, reused: false };
}

export async function clearInactiveTempJobs(): Promise<{ removed: string[]; skipped: string[]; errors: string[] }> {
  const root = getTempJobsRoot();
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const removed: string[] = [], skipped: string[] = [], errors: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) {
      skipped.push(entry.name); // No cleanup of unrecognized/unowned items.
      continue;
    }
    const rec = records.get(entry.name);
    if (!rec) {
      skipped.push(entry.name); // Unknown directories require explicit future ownership reconciliation.
      continue;
    }
    if (activeWorkForSession(rec.sessionKey)?.executionId === rec.executionId) {
      skipped.push(entry.name);
      continue;
    }
    try {
      await fs.rm(path.join(root, entry.name), { recursive: true, force: false });
      records.delete(entry.name);
      removed.push(entry.name);
    } catch (e) {
      errors.push(entry.name + ": " + String(e));
    }
  }
  return { removed, skipped, errors };
}
