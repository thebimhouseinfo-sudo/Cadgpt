import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd());

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
 * Beta default: <repo>/appdata
 * Packaged target: an absolute per-user location such as %LOCALAPPDATA%\CadGPT.
 *
 * User-provided Lisp/Job folders are import sources only. CadGPT copies them
 * into managed libraries under AppData and subsequently reads/writes only the
 * managed AppData copy.
 */
export function getAppDataRoot(): string {
  const configured = (process.env.CADGPT_APPDATA_ROOT || "appdata").trim() || "appdata";
  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(REPO_ROOT, configured);
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
    getAppDataPath("state"),
    getAppDataPath("logs"),
  ];
  await Promise.all(directories.map((dir) => fs.mkdir(dir, { recursive: true })));
}
