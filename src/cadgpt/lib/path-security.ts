import fs from "node:fs/promises";
import path from "node:path";

import { getAppDataRoot } from "./appdata.js";

const REPO_ROOT = path.resolve(process.cwd());
const APPDATA_EDITABLE_ROOTS = ["data", "libraries", "workspace"];

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeForCompare(candidate);
  const normalizedRoot = normalizeForCompare(root);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + path.sep);
}

export function getRepoRoot(): string {
  return REPO_ROOT;
}

export function getAllowedRoots(): string[] {
  const appDataRoot = getAppDataRoot();
  return APPDATA_EDITABLE_ROOTS.map((name) => path.resolve(appDataRoot, name));
}

function assertInsideAllowed(candidate: string): void {
  const allowed = getAllowedRoots();
  if (!allowed.some((root) => isInside(candidate, root))) {
    throw new Error(`Path is outside CadGPT managed AppData roots (${allowed.map(toCadgptPath).join(", ")}): ${candidate}`);
  }
}

async function nearestExistingParent(target: string): Promise<string> {
  let current = target;
  while (true) {
    try {
      await fs.lstat(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new Error(`Unable to resolve an existing parent for: ${target}`);
      current = parent;
    }
  }
}

function resolveVirtualPath(inputPath: string): string {
  const normalized = inputPath.replaceAll("\\", "/");
  if (normalized === "appdata" || normalized.startsWith("appdata/")) {
    const suffix = normalized === "appdata" ? "" : normalized.slice("appdata/".length);
    return path.resolve(getAppDataRoot(), suffix);
  }
  throw new Error("CadGPT editable file paths must use the appdata/... virtual namespace");
}

/**
 * Resolve a tool-supplied path inside managed AppData only.
 *
 * External user library source folders are deliberately NOT part of this
 * sandbox. They are readable only by the explicit library_import workflow,
 * which copies them into AppData without ever writing back to the source.
 */
export async function resolveAllowedPath(
  inputPath: string,
  options: { forCreate?: boolean } = {}
): Promise<string> {
  const trimmed = inputPath.trim();
  if (!trimmed) throw new Error("Path is empty");
  if (path.isAbsolute(trimmed)) throw new Error("Absolute paths are not editable through CadGPT file tools");

  const candidate = resolveVirtualPath(trimmed);
  assertInsideAllowed(candidate);

  if (!options.forCreate) {
    const real = await fs.realpath(candidate);
    assertInsideAllowed(real);
    return real;
  }

  const parent = await nearestExistingParent(path.dirname(candidate));
  const realParent = await fs.realpath(parent);
  assertInsideAllowed(realParent);
  return candidate;
}

/** Stable display/tool path independent of where packaged AppData lives. */
export function toCadgptPath(absolutePath: string): string {
  const absolute = path.resolve(absolutePath);
  const appDataRoot = getAppDataRoot();
  if (isInside(absolute, appDataRoot)) {
    const rel = path.relative(appDataRoot, absolute).replaceAll("\\", "/");
    return rel ? `appdata/${rel}` : "appdata";
  }
  return path.relative(REPO_ROOT, absolute).replaceAll("\\", "/");
}

export function toRepoRelative(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");
}
