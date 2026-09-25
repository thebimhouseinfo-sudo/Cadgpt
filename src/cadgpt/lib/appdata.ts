import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "..", "..", "..");

export type AppDataArea =
  | "data"
  | "libraries"
  | "registry"
  | "workspace"
  | "runtime"
  | "state"
  | "logs";

/**
 * CadGPT user/runtime data root.
 *
 * Default on Windows: %LOCALAPPDATA%\CadGPT.
 * CADGPT_APPDATA_ROOT may override this for development/tests.
 *
 * The historical relative value "appdata" is treated as unset so old source
 * checkouts automatically stop using the repository as user AppData.
 */
export function getAppDataRoot(): string {
  const configuredRaw = (process.env.CADGPT_APPDATA_ROOT || "").trim();
  const configured =
    configuredRaw.toLowerCase() === "appdata" ? "" : configuredRaw;

  if (configured) {
    return path.isAbsolute(configured)
      ? path.resolve(configured)
      : path.resolve(REPO_ROOT, configured);
  }

  if (process.platform === "win32") {
    const local = (process.env.LOCALAPPDATA || "").trim();
    if (local) return path.resolve(local, "CadGPT");
  }

  return path.resolve(os.homedir(), ".local", "share", "CadGPT");
}

export function getAppDataPath(area: AppDataArea, ...parts: string[]): string {
  return path.join(getAppDataRoot(), area, ...parts);
}

export function getLispLibrariesRoot(): string {
  return getAppDataPath("libraries", "lisp");
}

export function getJobLibrariesRoot(): string {
  return getAppDataPath("libraries", "jobs");
}

export function getUserRegistryRoot(): string {
  return getAppDataPath("registry", "user");
}

export function getUserCapabilitiesPath(): string {
  return path.join(getUserRegistryRoot(), "capabilities.json");
}

export function getUserLibrariesManifestPath(): string {
  return path.join(getUserRegistryRoot(), "libraries.json");
}

export function getWorkspaceRoot(): string {
  return getAppDataPath("workspace");
}

export function getLispDraftRoot(): string {
  return path.join(getWorkspaceRoot(), "lisp-draft");
}

export function getJobDraftRoot(): string {
  return path.join(getWorkspaceRoot(), "job-draft");
}

export function getDynamicLispRoot(): string {
  return getAppDataPath("runtime", "dynamic-lisp");
}

export function getRunDataRoot(): string {
  return getAppDataPath("data", "runs");
}

export async function ensureAppDataLayout(): Promise<void> {
  const directories = [
    getAppDataRoot(),
    getLispLibrariesRoot(),
    getJobLibrariesRoot(),
    getUserRegistryRoot(),
    getRunDataRoot(),
    getLispDraftRoot(),
    getJobDraftRoot(),
    getDynamicLispRoot(),
    path.join(getAppDataRoot(), "drawings"),
    getAppDataPath("state"),
    getAppDataPath("logs"),
  ];
  await Promise.all(directories.map((dir) => fs.mkdir(dir, { recursive: true })));
}

export function getTrayStatePath(): string {
  return getAppDataPath("state", "tray-ready.json");
}
