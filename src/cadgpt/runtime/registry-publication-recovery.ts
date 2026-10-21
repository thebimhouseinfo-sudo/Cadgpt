import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  getUserRegistryRoot, getUserCapabilitiesPath, getUserLibrariesManifestPath,
} from "../lib/appdata.js";

const JOURNAL = ".v5-publication-recovery.json";
type Snapshot = { format: 1; manifest: string | null; capabilities: string | null };

async function atomicBytes(target: string, bytes: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), "." + randomUUID() + ".tmp");
  try {
    await fs.writeFile(temp, bytes, { flag: "wx" });
    await fs.rename(temp, target);
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}

export async function readRegistrySnapshot(): Promise<Snapshot> {
  const optional = async (target: string): Promise<string | null> => {
    try { return await fs.readFile(target, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  return {
    format: 1,
    manifest: await optional(getUserLibrariesManifestPath()),
    capabilities: await optional(getUserCapabilitiesPath()),
  };
}

export async function beginRegistryPublication(snapshot: Snapshot): Promise<void> {
  const root = getUserRegistryRoot();
  await fs.mkdir(root, { recursive: true });
  const journal = path.join(root, JOURNAL);
  await fs.writeFile(journal, JSON.stringify(snapshot) + "\n", { flag: "wx" });
}

export async function endRegistryPublication(): Promise<void> {
  await fs.rm(path.join(getUserRegistryRoot(), JOURNAL), { force: true });
}

/** Revert incomplete two-file publish before exposing a newly started runtime. */
export async function recoverInterruptedRegistryPublication(): Promise<boolean> {
  const journal = path.join(getUserRegistryRoot(), JOURNAL);
  let data: string;
  try { data = await fs.readFile(journal, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const snapshot = JSON.parse(data) as Snapshot;
  if (snapshot.format !== 1 ||
      (snapshot.manifest !== null && typeof snapshot.manifest !== "string") ||
      (snapshot.capabilities !== null && typeof snapshot.capabilities !== "string")) {
    throw new Error("V5_REGISTRY_RECOVERY_INVALID_JOURNAL");
  }
  const restore = async (target: string, value: string | null) => {
    if (value === null) await fs.rm(target, { force: true });
    else await atomicBytes(target, value);
  };
  await restore(getUserLibrariesManifestPath(), snapshot.manifest);
  await restore(getUserCapabilitiesPath(), snapshot.capabilities);
  await endRegistryPublication();
  return true;
}
