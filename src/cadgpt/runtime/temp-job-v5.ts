import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getTempJobsRoot, getDrawingStorageRoot } from "../lib/appdata.js";
import { getBoundDrawingsForExecution } from "../session/drawing-binding.js";
import { newTempJobId, ownedSourceRoot, resolveOwnedSourceMutation } from "../lib/owned-source.js";
import { resolveAbsoluteMutationPath } from "../lib/path-security.js";
import { activeWorkForSession } from "../lib/work-registration.js";
import { withFileMutationLocks } from "./file-scheduler.js";

const META = ".temp-job.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type TempMeta = {
  schema: 1;
  id: string;
  owner_execution: string;
  owner_session: string;
  owner_pid?: number;
  state: "active" | "done";
  created_at: string;
  result_folder?: string;
  result_anchor?: string;
};
const active = new Map<string, string>();

function safeRelativeSource(relative: string): void {
  if (!relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative) ||
      relative.replaceAll("\\", "/").split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("TEMP_JOB_INVALID_RELATIVE_SOURCE");
  }
}
function assertId(id: string): void {
  if (!UUID.test(id)) throw new Error("TEMP_JOB_INVALID_ID");
}
async function readMeta(id: string): Promise<TempMeta> {
  assertId(id);
  const root = ownedSourceRoot({ kind: "temp-job", id });
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("TEMP_JOB_UNSAFE_ROOT");
  const metaFile = path.join(root, META);
  const metaStat = await fs.lstat(metaFile);
  if (!metaStat.isFile() || metaStat.isSymbolicLink()) throw new Error("TEMP_JOB_UNSAFE_METADATA");
  const meta: TempMeta = JSON.parse(await fs.readFile(metaFile, "utf8"));
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
      owner_session: session, owner_pid: process.pid,
      state: "active", created_at: new Date().toISOString(),
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
  safeRelativeSource(relative);
  const target = path.resolve(root, relative);
  if (path.basename(target) === META) throw new Error("TEMP_JOB_METADATA_PROTECTED");
  const resolved = await resolveOwnedSourceMutation(target, { kind: "temp-job", id }, { forCreate: true });
  const ext = path.extname(resolved).toLowerCase();
  if (![".lsp", ".dcl", ".json", ".py", ".txt", ".csv", ".md", ".yaml", ".yml"].includes(ext)) {
    throw new Error("TEMP_JOB_UNSUPPORTED_SOURCE_TYPE");
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await withFileMutationLocks([resolved], async () => {
    const safe = await resolveOwnedSourceMutation(target, { kind: "temp-job", id }, { forCreate: true });
    await fs.writeFile(safe, content, { flag: "wx" }); // never silently overwrite
  });
  return { id, path: resolved, bytes: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") };
}
/** Safe FIX → RE-RUN source replacement, never a blind overwrite. */
export async function updateTempSource(
  id: string, execution: string, session: string, relative: string,
  content: string, expectedSha256: string,
) {
  const meta = await assertOwned(id, execution, session);
  if (meta.state !== "active") throw new Error("TEMP_JOB_ALREADY_DONE");
  const root = ownedSourceRoot({ kind: "temp-job", id });
  safeRelativeSource(relative);
  const target = path.resolve(root, relative);
  if (path.basename(target) === META) throw new Error("TEMP_JOB_METADATA_PROTECTED");
  const resolved = await resolveOwnedSourceMutation(target, { kind: "temp-job", id });
  const ext = path.extname(resolved).toLowerCase();
  if (![".lsp", ".dcl", ".json", ".py", ".txt", ".csv", ".md", ".yaml", ".yml"].includes(ext)) {
    throw new Error("TEMP_JOB_UNSUPPORTED_SOURCE_TYPE");
  }
  return withFileMutationLocks([resolved], async () => {
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
  });
}
/** Verified file-only Temp Python source, owned by the current Builder Work. */
export async function getOwnedTempPython(
  id: string, execution: string, session: string, relative: string,
): Promise<string> {
  const meta = await assertOwned(id, execution, session);
  if (meta.state !== "active") throw new Error("TEMP_JOB_ALREADY_DONE");
  safeRelativeSource(relative);
  const owner = { kind: "temp-job" as const, id };
  const source = path.resolve(ownedSourceRoot(owner), relative);
  if (path.extname(source).toLowerCase() !== ".py") throw new Error("TEMP_JOB_PYTHON_REQUIRED");
  const resolved = await resolveOwnedSourceMutation(source, owner);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("TEMP_JOB_PYTHON_UNSAFE_SOURCE");
  return resolved;
}

/** Resolve a Temp Lisp for the same Builder execution; LOAD is handled by existing bound-CAD proxy. */
export async function getOwnedTempLisp(
  id: string, execution: string, session: string, relative: string,
): Promise<string> {
  const meta = await assertOwned(id, execution, session);
  if (meta.state !== "active") throw new Error("TEMP_JOB_ALREADY_DONE");
  safeRelativeSource(relative);
  const owner = { kind: "temp-job" as const, id };
  const source = path.resolve(ownedSourceRoot(owner), relative);
  if (path.extname(source).toLowerCase() !== ".lsp") throw new Error("TEMP_JOB_LISP_REQUIRED");
  const resolved = await resolveOwnedSourceMutation(source, owner);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("TEMP_JOB_LISP_UNSAFE_SOURCE");
  return resolved;
}
/**
 * User-specified name only: no result is created for scratch-only Temp Jobs.
 * The bound drawing and persisted Anchor are checked on every creation.
 */
export async function createTempResult(
  id: string, execution: string, session: string, folderName: string,
) {
  const meta = await assertOwned(id, execution, session);
  if (meta.state !== "active") throw new Error("TEMP_JOB_ALREADY_DONE");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(folderName) ||
      folderName.includes("..")) throw new Error("TEMP_JOB_RESULT_NAME_INVALID");
  if (meta.result_folder) throw new Error("TEMP_JOB_RESULT_ALREADY_SET");
  const bindings = getBoundDrawingsForExecution(execution);
  if (bindings.length !== 1) throw new Error("TEMP_JOB_BOUND_DRAWING_REQUIRED");
  const binding = bindings[0];
  if (!binding.anchor_verified_readback ||
      typeof binding.drawing_anchor !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(binding.drawing_anchor)) {
    throw new Error("TEMP_JOB_VERIFIED_ANCHOR_REQUIRED");
  }
  const drawingsRoot = await fs.realpath(getDrawingStorageRoot());
  const drawingPath = path.join(drawingsRoot, binding.drawing_anchor);
  const realDrawing = await fs.realpath(drawingPath);
  if (path.dirname(realDrawing) !== drawingsRoot) throw new Error("TEMP_JOB_DRAWING_PATH_ESCAPE");
  const intendedJobsPath = path.join(realDrawing, "jobs");
  await fs.mkdir(intendedJobsPath, { recursive: true });
  const jobsPath = await fs.realpath(intendedJobsPath);
  if (path.dirname(jobsPath) !== realDrawing) throw new Error("TEMP_JOB_JOBS_PATH_ESCAPE");
  const result = path.join(jobsPath, folderName);
  await fs.mkdir(result); // no overwrite, no implicit rename
  meta.result_folder = folderName;
  meta.result_anchor = binding.drawing_anchor;
  const root = ownedSourceRoot({ kind: "temp-job", id });
  const metadataPath = path.join(root, META);
  const tempMetadata = path.join(root, "." + randomUUID() + ".json");
  try {
    await fs.writeFile(tempMetadata, JSON.stringify(meta, null, 2), { flag: "wx" });
    await fs.rename(tempMetadata, metadataPath);
  } catch (error) {
    // Result publication was not reported successful. Roll back only a still
    // empty directory we just created; never delete user result files.
    await fs.rmdir(result).catch(() => {});
    throw error;
  } finally {
    await fs.rm(tempMetadata, { force: true }).catch(() => {});
  }
  return { id, folder_name: folderName, drawing_anchor: binding.drawing_anchor, path: result };
}
async function resolveOwnedResultTarget(target: string, root: string): Promise<string> {
  if (path.resolve(target) === path.resolve(root)) throw new Error("TEMP_JOB_RESULT_FILE_REQUIRED");
  return resolveAbsoluteMutationPath(target, { allowedRoots: [root], forCreate: true });
}
/** Write a persisted Temp Job artifact only into its human-named, bound Drawing Anchor folder. */
export async function writeTempResult(
  id: string, execution: string, session: string, relativeFile: string, content: string,
) {
  const meta = await assertOwned(id, execution, session);
  if (meta.state !== "active") throw new Error("TEMP_JOB_ALREADY_DONE");
  if (!meta.result_folder || !meta.result_anchor) throw new Error("TEMP_JOB_RESULT_NOT_CREATED");
  safeRelativeSource(relativeFile);
  const binding = getBoundDrawingsForExecution(execution);
  if (binding.length !== 1 || !binding[0].anchor_verified_readback ||
      binding[0].drawing_anchor !== meta.result_anchor) {
    throw new Error("TEMP_JOB_RESULT_DRAWING_MISMATCH");
  }
  const root = await fs.realpath(getDrawingStorageRoot());
  const drawing = await fs.realpath(path.join(root, meta.result_anchor));
  if (path.dirname(drawing) !== root) throw new Error("TEMP_JOB_DRAWING_PATH_ESCAPE");
  const jobs = await fs.realpath(path.join(drawing, "jobs"));
  if (path.dirname(jobs) !== drawing) throw new Error("TEMP_JOB_JOBS_PATH_ESCAPE");
  const result = await fs.realpath(path.join(jobs, meta.result_folder));
  if (path.dirname(result) !== jobs) throw new Error("TEMP_JOB_RESULT_PATH_ESCAPE");
  const target = path.resolve(result, relativeFile);
  const resolved = await resolveOwnedResultTarget(target, result);
  const ext = path.extname(resolved).toLowerCase();
  if (![".json", ".csv", ".txt", ".md", ".yaml", ".yml"].includes(ext)) {
    throw new Error("TEMP_JOB_UNSUPPORTED_RESULT_TYPE");
  }
  await withFileMutationLocks([resolved], async () => {
    const safe = await resolveOwnedResultTarget(target, result);
    await fs.mkdir(path.dirname(safe), { recursive: true });
    await fs.writeFile(safe, content, { flag: "wx" });
  });
  return { id, result_name: meta.result_folder, path: resolved, bytes: Buffer.byteLength(content) };
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
function wasOwnerProcessTerminated(pid: number | undefined): boolean {
  if (!Number.isSafeInteger(pid) || !pid || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
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
      const activeOwner = (live && live.executionId === meta.owner_execution) || active.has(item);
      const abandonedAfterCrash = meta.state === "active" && !activeOwner &&
        wasOwnerProcessTerminated(meta.owner_pid);
      if ((meta.state !== "done" && !abandonedAfterCrash) || activeOwner) {
        skipped.push({ id: item, reason: "active_or_unverified_owner" }); continue;
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
