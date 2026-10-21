import path from "node:path";

// Explicit user command authorizes editing one existing Job source package.
// The command is observed through the CadGPT admission/control flow, not
// inferred from a Builder owner_id supplied by a tool caller.
const pendingCommands = new Set<string>();
const grants = new Map<string, { target: string; executionId: string | null }>();
const newPackagesByExecution = new Map<string, Set<string>>();

function key(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function observeExplicitJobUpdateCommand(sessionKey: string, userTurn: string): boolean {
  if (!/^cg\/jobupdate$/i.test(userTurn.trim())) return false;
  pendingCommands.add(sessionKey);
  return true;
}

export function activateJobUpdateGrant(sessionKey: string, targetRoot: string): void {
  if (!pendingCommands.delete(sessionKey)) {
    throw new Error("JOB_UPDATE_EXPLICIT_COMMAND_REQUIRED: issue cg/jobupdate before selecting a Job.");
  }
  grants.set(sessionKey, { target: key(targetRoot), executionId: null });
}

export function hasJobUpdateGrantForWork(sessionKey: string, executionId: string): boolean {
  const grant = grants.get(sessionKey);
  return Boolean(grant && (!grant.executionId || grant.executionId === executionId));
}

export function assertJobUpdateGrant(sessionKey: string, executionId: string, root: string): void {
  const grant = grants.get(sessionKey);
  if (!grant || grant.target !== key(root) ||
      (grant.executionId && grant.executionId !== executionId)) {
    throw new Error("JOB_UPDATE_EXPLICIT_COMMAND_REQUIRED: cg/jobupdate must authorize this exact existing Job.");
  }
  if (!grant.executionId) grant.executionId = executionId;
}

export function recordNewJobPackage(executionId: string, root: string): void {
  let roots = newPackagesByExecution.get(executionId);
  if (!roots) {
    roots = new Set<string>();
    newPackagesByExecution.set(executionId, roots);
  }
  roots.add(key(root));
}

export function isNewJobPackageForExecution(executionId: string, root: string): boolean {
  return newPackagesByExecution.get(executionId)?.has(key(root)) ?? false;
}

export function clearJobUpdateGrantForSession(sessionKey: string): void {
  pendingCommands.delete(sessionKey);
  grants.delete(sessionKey);
}

export function clearJobUpdateGrantForExecution(executionId: string): void {
  for (const [sessionKey, grant] of grants) {
    if (grant.executionId === executionId) grants.delete(sessionKey);
  }
  newPackagesByExecution.delete(executionId);
}
