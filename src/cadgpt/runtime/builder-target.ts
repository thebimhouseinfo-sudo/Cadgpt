import path from "node:path";

/** One exact final source package per Builder execution; no checkout or approval. */
const targets = new Map<string, string>();
const normalized = (value: string) => process.platform === "win32"
  ? path.resolve(value).toLowerCase() : path.resolve(value);

export function assertBuilderTarget(executionId: string, ownedRoot: string): void {
  if (!executionId || !path.isAbsolute(ownedRoot)) throw new Error("V5_BUILDER_TARGET_INVALID");
  const target = normalized(ownedRoot);
  const current = targets.get(executionId);
  if (current && current !== target) throw new Error("V5_BUILDER_TARGET_OWNERSHIP_MISMATCH");
  if (!current) targets.set(executionId, target);
}

export function currentBuilderTarget(executionId: string): string | null {
  return targets.get(executionId) ?? null;
}

export function clearBuilderTarget(executionId: string): void {
  targets.delete(executionId);
}
