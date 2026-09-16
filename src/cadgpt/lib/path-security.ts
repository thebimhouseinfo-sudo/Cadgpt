import fs from "node:fs/promises";
import path from "node:path";

import { getAppDataRoot } from "./appdata.js";

const REPO_ROOT = path.resolve(process.cwd());
const DEFAULT_SOURCE_ROOTS = ["lisp", "jobs"];
const APPDATA_EDITABLE_ROOTS = ["data", "lisp-draft"];

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeForCompare(candidate);
  const normalizedRoot = normalizeForCompare(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + path.sep)
  );
}

function configuredSourceRootNames(): string[] {
  const raw = process.env.CADGPT_FILE_ROOTS?.trim();
  const values = raw ? raw.split(";") : DEFAULT_SOURCE_ROOTS;
  const roots = values.map((item) => item.trim()).filter(Boolean);
  if (!roots.length) throw new Error("CADGPT_FILE_ROOTS contains no usable roots");
  return roots;
}

export function getRepoRoot(): string {
  return REPO_ROOT;
}

function getSourceRoots(): string[] {
  return configuredSourceRootNames().map((item) => {
    if (path.isAbsolute(item)) {
      const absolute = path.resolve(item);
      if (!isInside(absolute, REPO_ROOT)) {
        throw new Error(`Configured source root escapes CadGPT repository: ${item}`);
      }
      return absolute;
    }
    const resolved = path.resolve(REPO_ROOT, item);
    if (!isInside(resolved, REPO_ROOT)) {
      throw new Error(`Configured source root escapes CadGPT repository: ${item}`);
    }
    return resolved;
  });
}

function getEditableAppDataRoots(): string[] {
  const appDataRoot = getAppDataRoot();
  return APPDATA_EDITABLE_ROOTS.map((name) => path.resolve(appDataRoot, name));
}

export function getAllowedRoots(): string[] {
  return [...getSourceRoots(), ...getEditableAppDataRoots()];
}

function assertInsideAllowed(candidate: string): void {
  const allowed = getAllowedRoots();
  if (!allowed.some((root) => isInside(candidate, root))) {
    throw new Error(
      `Path is outside CadGPT editable roots (${allowed.map(toCadgptPath).join(", ")}): ${candidate}`
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
  return path.resolve(REPO_ROOT, inputPath);
}

/**
 * Resolve a user/tool supplied path inside the explicit CadGPT file sandbox.
 * Existing paths are realpath-resolved to prevent symlink escapes. For new
 * paths, the nearest existing parent is realpath-resolved before creation.
 *
 * `appdata/...` is a stable virtual namespace: in Beta it maps to repo/appdata,
 * while packaged builds may map the same paths to %LOCALAPPDATA%/CadGPT.
 */
export async function resolveAllowedPath(
  inputPath: string,
  options: { forCreate?: boolean } = {}
): Promise<string> {
  const trimmed = inputPath.trim();
  if (!trimmed) throw new Error("Path is empty");

  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : resolveVirtualPath(trimmed);

  // Lexical boundary first: reject ../ and foreign absolute paths early.
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

/** Stable display/tool path independent of where packaged appdata lives. */
export function toCadgptPath(absolutePath: string): string {
  const absolute = path.resolve(absolutePath);
  const appDataRoot = getAppDataRoot();
  if (isInside(absolute, appDataRoot)) {
    const rel = path.relative(appDataRoot, absolute).replaceAll("\\", "/");
    return rel ? `appdata/${rel}` : "appdata";
  }
  return path.relative(REPO_ROOT, absolute).replaceAll("\\", "/");
}

/** Repository-only compatibility helper. */
export function toRepoRelative(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");
}
