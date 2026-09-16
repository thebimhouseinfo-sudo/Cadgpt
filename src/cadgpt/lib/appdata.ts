import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd());

export type AppDataArea = "data" | "lisp-draft" | "runtime" | "state" | "logs";

/**
 * CadGPT user/runtime data root.
 *
 * Beta default: <repo>/appdata
 * Packaged target: an absolute user-data path such as %LOCALAPPDATA%\CadGPT.
 *
 * CADGPT_APPDATA_ROOT is trusted installation configuration, not a model/user
 * supplied path. Relative values are resolved from the CadGPT installation
 * root so the beta layout can live inside the repository without changing
 * runtime code later.
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

export function getDynamicLispRoot(): string {
  return getAppDataPath("runtime", "dynamic-lisp");
}

export function getRunDataRoot(): string {
  return getAppDataPath("data", "runs");
}

export function getLispDraftRoot(): string {
  return getAppDataPath("lisp-draft");
}

export async function ensureAppDataLayout(): Promise<void> {
  const directories = [
    getAppDataRoot(),
    getRunDataRoot(),
    getLispDraftRoot(),
    getDynamicLispRoot(),
    getAppDataPath("state"),
    getAppDataPath("logs"),
  ];
  await Promise.all(directories.map((dir) => fs.mkdir(dir, { recursive: true })));
}
