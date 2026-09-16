import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd());
const DEFAULT_ROOTS = ["lisp", "jobs"];

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

function configuredRootNames(): string[] {
  const raw = process.env.CADGPT_FILE_ROOTS?.trim();
  const values = raw ? raw.split(";") : DEFAULT_ROOTS;
  const roots = values.map((item) => item.trim()).filter(Boolean);
  if (!roots.length) throw new Error("CADGPT_FILE_ROOTS contains no usable roots");
  return roots;
}

export function getRepoRoot(): string {
  return REPO_ROOT;
}

export function getAllowedRoots(): string[] {
  return configuredRootNames().map((item) => {
    if (path.isAbsolute(item)) {
      const absolute = path.resolve(item);
      if (!isInside(absolute, REPO_ROOT)) {
        throw new Error(`Configured file root escapes CadGPT repository: ${item}`);
      }
      return absolute;
    }
    const resolved = path.resolve(REPO_ROOT, item);
    if (!isInside(resolved, REPO_ROOT)) {
      throw new Error(`Configured file root escapes CadGPT repository: ${item}`);
    }
    return resolved;
  });
}

function assertInsideAllowed(candidate: string): void {
  const allowed = getAllowedRoots();
  if (!allowed.some((root) => isInside(candidate, root))) {
    throw new Error(
      `Path is outside CadGPT editable roots (${allowed.map((r) => path.relative(REPO_ROOT, r)).join(", ")}): ${candidate}`
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

/**
 * Resolve a user/tool supplied path inside the explicit CadGPT file sandbox.
 * Existing paths are realpath-resolved to prevent symlink escapes. For new
 * paths, the nearest existing parent is realpath-resolved before creation.
 */
export async function resolveAllowedPath(
  inputPath: string,
  options: { forCreate?: boolean } = {}
): Promise<string> {
  const trimmed = inputPath.trim();
  if (!trimmed) throw new Error("Path is empty");

  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(REPO_ROOT, trimmed);

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

export function toRepoRelative(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");
}
