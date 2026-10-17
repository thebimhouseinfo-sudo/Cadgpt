/**
 * Small V5 execution-scoped Save witness. It is not a Job lock or manager.
 * A verified CAD-facing Save can satisfy the final persistence requirement;
 * any subsequent CAD operation conservatively invalidates that witness.
 */
const witnessed = new Map<string, string>();

export function noteVerifiedBoundSave(executionId: string, documentIdentity: string): void {
  if (!executionId || !documentIdentity) throw new Error("BOUND_SAVE_WITNESS_ID_REQUIRED");
  witnessed.set(executionId, documentIdentity);
}

export function invalidateBoundSave(executionId: string): void {
  witnessed.delete(executionId);
}

export function hasVerifiedBoundSave(executionId: string, documentIdentity: string): boolean {
  return witnessed.get(executionId) === documentIdentity;
}

export function clearBoundSaveForExecution(executionId: string): void {
  witnessed.delete(executionId);
}
