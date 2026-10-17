import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getTempJobsRoot } from "../lib/appdata.js";
import { newTempJobId, ownedSourceRoot, resolveOwnedSourceMutation } from "../lib/owned-source.js";
import { activeWorkForSession } from "../lib/work-registration.js";

const META = ".temp-job.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type TempMeta = {
  schema: 1;
  id: string;
  owner_execution: string;
  owner_session: string;
  state: "active" | "done";
  created_at: string;
};
const active = new Map<string, string>();

function assertId(id: string): void {
  if (!UUID.test(id)) throw new Error("TEMP_JOB_INVALID_ID");
}
async function readMeta(id: string): Promise<TempMeta> {
  assertId(id);
  const root = ownedSourceRoot({ kind: "temp-job", id });
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("TEMP_JOB_UNSAFE_ROOT");
  const meta: TempMeta = JSON.parse(await fs.readFile(path.join(root, META), "utf8"));
  if (meta.schema !== 1 || meta.id !== id ||
      !["active", "done"].includes(meta.state) ||
      typeof meta.owner_execution !== "string" ||
      typeof meta.owner_session !== "string") throw new Error("TEMP_JOB_INVALID_METADATA");
  return meta;
}
async function assertOwned(id: string, execution: string, session: string): Promise<TempMeta> {
  const meta = await readMeta(id);
  if (meta.owner_execution !== execution || meta.owner_session !== session) {
    throw new Error("TEMP_JOB_NOT_OWNED");
  }
  const current = activeWorkForSession(session);
  if (!current || current.executionId !== execution || current.ownerType === "job") {
    throw new Error("TEMP_JOB_BUILDER_WORK_REQUIRED");
  }
  return meta;
}
export async function createTempJob(execution: string, session: string) {
  const current = activeWorkForSession(session);
  if (!current || current.executionId !== execution || current.ownerType === "job") {
    throw new Error("TEMP_JOB_BUILDER_WORK_REQUIRED");
  }
  await fs.mkdir(getTempJobsRoot(), { recursive: true });
  for (let n = 0; n < 5; n++) {
    const id = newTempJobId();
    const root = ownedSourceRoot({ kind: "temp-job", id });
    try { await fs.mkdir(root, { recursive: false }); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    const meta: TempMeta = {
      schema: 1, id, owner_execution: execution,
      owner_session: session, state: "active", created_at: new Date().toISOString(),
    };
    try { await fs.writeFile(path.join(root, META), JSON.stringify(meta, null, 2), { flag: "wx" }); }
    catch (err) { await fs.rm(root, { recursive: true }); throw err; }
    active.set(id, execution);
    return { id, root };
  }
  throw new Error("TEMP_JOB_ID_COLLISION");
}
export async function writeTempSource(
  id: string, execution: string, session: string, relative: string, content: string,
) {
  const meta = await assertOwned(id, execution, session);
  if (meta.state !== "active") throw new Error("TEMP_JOB_ALREADY_DONE");
  const root = ownedSourceRoot({ kind: "temp-job", id });
  const target = path.resolve(root, relative);
  if (path.basename(target) === META) throw new Error("TEMP_JOB_METADATA_PROTECTED");
  const resolved = await resolveOwnedSourceMutation(target, { kind: "temp-job", id }, { forCreate: true });
  const ext = path.extname(resolved).toLowerCase();
  if (![".lsp", ".dcl", ".json", ".py", ".txt", ".csv", ".md", ".yaml", ".yml"].includes(ext)) {
    throw new Error("TEMP_JOB_UNSUPPORTED_SOURCE_TYPE");
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, { flag: "wx" }); // never silently overwrite
  return { id, path: resolved, bytes: Buffer.byteLength(content) };
}
/** Safe FIX → RE-RUN source replacement, never a blind overwrite. */
export async function updateTempSource(
  id: string, execution: string, session: string, relative: string,
  content: string, expectedSha256: string,
) {
  const meta = await assertOwned(id, execution, session);
  if (meta.state !== "active") throw new Error("TEMP_JOB_ALREADY_DONE");
  const root = ownedSourceRoot({ kind: "temp-job", id });
  const target = path.resolve(root, relative);
  if (path.basename(target) === META) throw new Error("TEMP_JOB_METADATA_PROTECTED");
  const resolved = await resolveOwnedSourceMutation(target, { kind: "temp-job", id });
  const ext = path.extname(resolved).toLowerCase();
  if (![".lsp", ".dcl", ".json", ".py", ".txt", ".csv", ".md", ".yaml", ".yml"].includes(ext)) {
    throw new Error("TEMP_JOB_UNSUPPORTED_SOURCE_TYPE");
  }
  const old = await fs.readFile(resolved);
  const sha = createHash("sha256").update(old).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256) || sha !== expectedSha256.toLowerCase()) {
    throw new Error("TEMP_JOB_SOURCE_CONFLICT");
  }
  const tmp = path.join(path.dirname(resolved), "." + randomUUID() + ".tmp");
  try {
    await fs.writeFile(tmp, content, { flag: "wx" });
    // Recheck immediately before atomic replacement (same-work call concurrency
    // must still serialize by target at the FILE scheduler boundary).
    const latest = createHash("sha256").update(await fs.readFile(resolved)).digest("hex");
    if (latest !== sha) throw new Error("TEMP_JOB_SOURCE_CONFLICT");
    await fs.rename(tmp, resolved);
  } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
  return { id, path: resolved, sha256: createHash("sha256").update(content).digest("hex") };
}
export async function finishTempJob(id: string, execution: string, session: string) {
  const meta = await assertOwned(id, execution, session);
  if (meta.state !== "active") return { id, state: "done" };
  meta.state = "done";
  const root = ownedSourceRoot({ kind: "temp-job", id });
  const src = path.join(root, META), tmp = path.join(root, ".temp-job-write.json");
  await fs.writeFile(tmp, JSON.stringify(meta, null, 2), { flag: "wx" });
  await fs.rename(tmp, src);
  active.delete(id);
  return { id, state: "done" };
}
export async function clearTempJobs(id?: string) {
  const ids = id ? [id] : (await fs.readdir(getTempJobsRoot(), { withFileTypes: true })
    .catch((err: NodeJS.ErrnoException) => err.code === "ENOENT" ? [] : Promise.reject(err)))
    .filter(e => e.isDirectory() && UUID.test(e.name)).map(e => e.name);
  const removed: string[] = [], skipped: Array<{ id: string; reason: string }> = [];
  for (const item of ids) {
    assertId(item);
    try {
      const meta = await readMeta(item);
      const live = activeWorkForSession(meta.owner_session);
      if (meta.state !== "done" ||
          (live && live.executionId === meta.owner_execution) ||
          active.has(item)) {
        skipped.push({ id: item, reason: "active_or_unfinished" }); continue;
      }
      const root = ownedSourceRoot({ kind: "temp-job", id: item });
      // Verify nested entries; never follow a symlink/junction into another owner.
      async function assertTreeSafe(folder: string): Promise<void> {
        for (const e of await fs.readdir(folder, { withFileTypes: true })) {
          const child = path.join(folder, e.name);
          const stat = await fs.lstat(child);
          if (stat.isSymbolicLink()) throw new Error("TEMP_JOB_SYMLINK_BLOCKED");
          if (stat.isDirectory()) await assertTreeSafe(child);
          else if (!stat.isFile()) throw new Error("TEMP_JOB_SPECIAL_FILE_BLOCKED");
        }
      }
      await assertTreeSafe(root);
      await fs.rm(root, { recursive: true, force: false });
      removed.push(item);
    } catch (err) { skipped.push({ id: item, reason: String(err) }); }
  }
  return { removed, skipped };
}
