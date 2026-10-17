import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getAppDataRoot, getJobLibrariesRoot, getLispLibrariesRoot, getTempJobsRoot } from "./appdata.js";
import { isPathInside, resolveAbsoluteMutationPath } from "./path-security.js";

/**
 * V5 source-ownership authority. This is NOT a general AppData write grant.
 * The invoker must first prove its role and exact target identity.
 */
export type OwnedSource =
  | { kind: "reusable-job"; libraryId: string; relativeFolder: string }
  | { kind: "reusable-lisp"; libraryId: string; relativeFolder: string }
  | { kind: "temp-job"; id: string };

const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeSegments(value: string): string[] {
  const segments = value.replaceAll("\\", "/").split("/");
  if (!segments.length || segments.some((part) => !SEGMENT.test(part) || part === "." || part === "..")) {
    throw new Error("V5_INVALID_OWNED_RELATIVE_PATH");
  }
  return segments;
}

/** Resolve an exact *directory* grant from validated owner metadata. */
export function ownedSourceRoot(owner: OwnedSource): string {
  if (owner.kind === "temp-job") {
    if (!UUID.test(owner.id)) throw new Error("V5_INVALID_TEMP_JOB_ID");
    return path.join(getTempJobsRoot(), owner.id);
  }
  if (!SEGMENT.test(owner.libraryId) || owner.libraryId === "." || owner.libraryId === "..") {
    throw new Error("V5_INVALID_LIBRARY_ID");
  }
  const parts = safeSegments(owner.relativeFolder);
  return path.join(
    owner.kind === "reusable-job" ? getJobLibrariesRoot() : getLispLibrariesRoot(),
    owner.libraryId, ...parts
  );
}

/**
 * Before allocating source directories, require every existing ancestor to
 * resolve to the same exact owner path. A junction to another Job in the
 * SAME managed library is cross-owner write, not an authorized alias.
 */
export async function assertOwnedSourceRootSafe(owner: OwnedSource): Promise<string> {
  const root = ownedSourceRoot(owner);
  const base = owner.kind === "temp-job" ? getTempJobsRoot() :
    owner.kind === "reusable-job" ? getJobLibrariesRoot() : getLispLibrariesRoot();
  await fs.mkdir(base, { recursive: true });
  const expectedBase = await fs.realpath(base);
  if (!isPathInside(root, base) || root === base) {
    throw new Error("V5_OWNER_ROOT_OUTSIDE_LIBRARY");
  }
  const rel = path.relative(base, root);
  const expected = path.resolve(expectedBase, rel);
  const actual = await resolveAbsoluteMutationPath(root, { allowedRoots: [base], forCreate: true });
  // Symlink/junction alias (even to a sibling within the same library) changes
  // identity and must not make a new source owner.
  const norm = (v: string) => process.platform === "win32" ? path.resolve(v).toLowerCase() : path.resolve(v);
  if (norm(actual) !== norm(expected)) throw new Error("V5_OWNER_ROOT_ALIAS_BLOCKED");
  return root;
}

/**
 * Resolves an owned target; canonicalization also checks a real parent, so
 * junction/symlink escape does not inherit owner permissions.
 */
export async function resolveOwnedSourceMutation(
  target: string,
  owner: OwnedSource,
  options: { forCreate?: boolean } = {}
): Promise<string> {
  const root = await assertOwnedSourceRootSafe(owner);
  if (!path.isAbsolute(target) || !isPathInside(target, root) || path.resolve(target) === path.resolve(root)) {
    throw new Error("V5_SOURCE_OUTSIDE_OWNER");
  }
  return resolveAbsoluteMutationPath(target, { allowedRoots: [root], forCreate: options.forCreate === true });
}

export function newTempJobId(): string {
  return randomUUID();
}

/** Kept separate from writable ownership: being inside AppData is not permission. */
export function isManagedV5OwnerRoot(root: string): boolean {
  return isPathInside(root, getAppDataRoot()) &&
    [getJobLibrariesRoot(), getLispLibrariesRoot(), getTempJobsRoot()].some((area) => isPathInside(root, area));
}
