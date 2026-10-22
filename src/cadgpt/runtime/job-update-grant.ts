import path from "node:path";

// Explicit user command authorizes editing one existing Job/Lisp source package.
// The command is observed through the CadGPT admission/control flow, not
// inferred from a Builder owner_id supplied by a tool caller.
const pendingCommands = new Set<string>();
const grants = new Map<string, { target: string }>();
const recentSources = new Map<string, string>();

export function rememberSourceForSession(sessionKey: string, root: string): void {
  if (grants.has(sessionKey) && grants.get(sessionKey)!.target !== key(root)) {
    clearJobUpdateGrantForSession(sessionKey);
  }
  recentSources.set(sessionKey, path.resolve(root));
}
export function recentSourceForSession(sessionKey: string): string | null {
  return recentSources.get(sessionKey) ?? null;
}
export function jobUpdateTargetForSession(sessionKey: string): string | null {
  return grants.get(sessionKey)?.target ?? null;
}
// Positive evidence of creation by this logical session, not an inference from
// missing Registry entries. Work cleanup must not discard unfinished authoring.
const newPackagesBySession = new Map<string, Set<string>>();
let publicationBarrier: Promise<void> = Promise.resolve();
const sourceMutations = new Set<Promise<void>>();

/** Independent source edits stay concurrent; publication fences only source I/O. */
export async function withSourceMutation<T>(callback: () => Promise<T>): Promise<T> {
  const operation = publicationBarrier.then(callback);
  const settled = operation.then(() => undefined, () => undefined);
  sourceMutations.add(settled);
  try { return await operation; }
  finally { sourceMutations.delete(settled); }
}

export function withSourcePublication<T>(callback: () => Promise<T>): Promise<T> {
  const operation = Promise.all([publicationBarrier, ...sourceMutations]).then(callback);
  publicationBarrier = operation.then(() => undefined, () => undefined);
  return operation;
}

function key(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function observeExplicitJobUpdateCommand(sessionKey: string, userTurn: string): boolean {
  if (!/^cg\/update$/i.test(userTurn.trim())) return false;
  pendingCommands.add(sessionKey);
  return true;
}

export function activateJobUpdateGrant(sessionKey: string, targetRoot: string): void {
  if (!pendingCommands.delete(sessionKey) && grants.get(sessionKey)?.target !== key(targetRoot)) {
    throw new Error("JOB_UPDATE_EXPLICIT_COMMAND_REQUIRED: issue cg/update before selecting a Job or Lisp.");
  }
  grants.set(sessionKey, { target: key(targetRoot) });
}

export function hasJobUpdateGrantForWork(sessionKey: string, _executionId: string): boolean {
  const grant = grants.get(sessionKey);
  return Boolean(grant);
}

export function assertJobUpdateGrant(sessionKey: string, _executionId: string, root: string): void {
  const grant = grants.get(sessionKey);
  if (!grant || grant.target !== key(root)) {
    throw new Error("JOB_UPDATE_EXPLICIT_COMMAND_REQUIRED: cg/update must authorize this exact existing Job or Lisp.");
  }
}

export function recordNewSourcePackage(sessionKey: string, root: string): void {
  let roots = newPackagesBySession.get(sessionKey);
  if (!roots) {
    roots = new Set<string>();
    newPackagesBySession.set(sessionKey, roots);
  }
  roots.add(key(root));
}

export function isNewSourcePackageForSession(sessionKey: string, root: string): boolean {
  return newPackagesBySession.get(sessionKey)?.has(key(root)) ?? false;
}

/** Called only after successful shared Registry publication, never on failure. */
export function finishSourceAuthoringInLibrary(libraryRoot: string, relativePaths: string[]): void {
  const published = relativePaths.map(relative => key(path.resolve(libraryRoot, relative.replaceAll("\\", "/"))));
  for (const [session, roots] of newPackagesBySession) {
    for (const root of roots) {
      if (published.some(file => file.startsWith(root + path.sep))) roots.delete(root);
    }
    if (!roots.size) newPackagesBySession.delete(session);
  }
}

export function clearSourceAuthoringForSession(sessionKey: string): void {
  newPackagesBySession.delete(sessionKey);
  recentSources.delete(sessionKey);
  clearJobUpdateGrantForSession(sessionKey);
}

export function clearJobUpdateGrantForSession(sessionKey: string): void {
  pendingCommands.delete(sessionKey);
  grants.delete(sessionKey);
}
