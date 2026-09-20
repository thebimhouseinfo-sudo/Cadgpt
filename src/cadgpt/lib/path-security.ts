import fs from "node:fs/promises";
import path from "node:path";

import { getAppDataRoot } from "./appdata.js";

const REPO_ROOT = path.resolve(process.cwd());
const APPDATA_READABLE_ROOTS = ["data", "libraries", "workspace"];
const APPDATA_WRITABLE_ROOTS = ["data", "workspace"];

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isPathInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeForCompare(candidate);
  const normalizedRoot = normalizeForCompare(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + path.sep)
  );
}

export function getRepoRoot(): string {
  return REPO_ROOT;
}

export function getCadMcpRuntimeRoot(): string {
  return path.resolve(REPO_ROOT, "runtimes", "cad-mcp");
}

export function getAllowedRoots(): string[] {
  const appDataRoot = getAppDataRoot();
  return APPDATA_READABLE_ROOTS.map((name) => path.resolve(appDataRoot, name));
}

export function getWritableRoots(): string[] {
  const appDataRoot = getAppDataRoot();
  return APPDATA_WRITABLE_ROOTS.map((name) => path.resolve(appDataRoot, name));
}

function assertInsideRoots(candidate: string, roots: string[], label: string): void {
  if (!roots.some((root) => isPathInside(candidate, root))) {
    throw new Error(
      `Path is outside CadGPT ${label} roots (${roots.map(toCadgptPath).join(", ")}): ${candidate}`
    );
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
      if (parent === current) {
        throw new Error(`Unable to resolve an existing parent for: ${target}`);
      }
      current = parent;
    }
  }
}

function resolveVirtualPath(inputPath: string): string {
  const normalized = inputPath.replaceAll("\\", "/");
  if (normalized === "appdata" || normalized.startsWith("appdata/")) {
    const suffix =
      normalized === "appdata" ? "" : normalized.slice("appdata/".length);
    return path.resolve(getAppDataRoot(), suffix);
  }
  throw new Error(
    "CadGPT read paths must use appdata/... virtual namespace or an approved absolute managed path"
  );
}

/**
 * Read/validation resolver.
 *
 * Reads may use stable appdata/... virtual paths or absolute paths, but absolute
 * paths are accepted only when they canonicalize inside the managed readable
 * roots. This function is not mutation authority.
 */
export async function resolveAllowedPath(
  inputPath: string,
  options: { forCreate?: boolean; forWrite?: boolean } = {}
): Promise<string> {
  const trimmed = inputPath.trim();
  if (!trimmed) throw new Error("Path is empty");

  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : resolveVirtualPath(trimmed);

  assertInsideRoots(candidate, getAllowedRoots(), "readable AppData");
  if (options.forWrite || options.forCreate) {
    assertInsideRoots(candidate, getWritableRoots(), "generic writable AppData");
  }

  if (!options.forCreate) {
    const real = await fs.realpath(candidate);
    assertInsideRoots(real, getAllowedRoots(), "readable AppData");
    if (options.forWrite) {
      assertInsideRoots(real, getWritableRoots(), "generic writable AppData");
    }
    return real;
  }

  const parent = await nearestExistingParent(path.dirname(candidate));
  const realParent = await fs.realpath(parent);
  assertInsideRoots(realParent, getAllowedRoots(), "readable AppData");
  assertInsideRoots(realParent, getWritableRoots(), "generic writable AppData");
  return candidate;
}

/**
 * Mutation resolver.
 *
 * Mutation tools MUST receive an explicit absolute path. CWD-relative or
 * virtual paths are rejected. The canonical existing target, or canonical
 * nearest existing parent for a create, must remain inside one of allowedRoots.
 */
export async function resolveAbsoluteMutationPath(
  inputPath: string,
  options: {
    allowedRoots?: string[];
    forCreate?: boolean;
    label?: string;
  } = {}
): Promise<string> {
  const trimmed = inputPath.trim();
  if (!trimmed) throw new Error("Mutation path is empty");
  if (!path.isAbsolute(trimmed)) {
    throw new Error(
      "ABSOLUTE_PATH_REQUIRED: every CadGPT file mutation requires an explicit absolute path"
    );
  }

  const roots = (options.allowedRoots ?? getWritableRoots()).map((root) =>
    path.resolve(root)
  );
  const candidate = path.resolve(trimmed);
  assertInsideRoots(candidate, roots, options.label || "mutation");

  if (!options.forCreate) {
    const real = await fs.realpath(candidate);
    assertInsideRoots(real, roots, options.label || "mutation");
    return real;
  }

  const parent = await nearestExistingParent(path.dirname(candidate));
  const realParent = await fs.realpath(parent);
  assertInsideRoots(realParent, roots, options.label || "mutation");

  const relativeTail = path.relative(parent, candidate);
  const resolvedCandidate = path.resolve(realParent, relativeTail);
  assertInsideRoots(resolvedCandidate, roots, options.label || "mutation");
  return resolvedCandidate;
}

export function toCadgptPath(absolutePath: string): string {
  const absolute = path.resolve(absolutePath);
  const appDataRoot = getAppDataRoot();
  if (isPathInside(absolute, appDataRoot)) {
    const rel = path.relative(appDataRoot, absolute).replaceAll("\\", "/");
    return rel ? `appdata/${rel}` : "appdata";
  }
  return path.relative(REPO_ROOT, absolute).replaceAll("\\", "/");
}

export function toRepoRelative(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");
}
