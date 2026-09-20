import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";

import { validateAdmissionToken } from "./admission.js";

export type WorkOwnerType = "skill" | "job" | "direct-cad" | "file";
export type ExecutionPath = "file" | "cad" | "hybrid";

export interface WorkRegistration {
  executionId: string;
  authorityToken: string;
  admissionToken: string;
  sessionKey: string;
  ownerType: WorkOwnerType;
  ownerId: string;
  jobId?: string;
  executionPath: ExecutionPath;
  driverEpoch: number;
  generation: number;
  callSequence: number;
  createdAt: string;
  lastActivityAt: string;
}

export interface ToolLease {
  leaseId: string;
  family: string;
  tool: string;
  targetId: string;
  workId: string;
  ownerId: string;
  sessionKey: string;
  driverEpoch: number;
  generation: number;
  callSequence: number;
  acquiredAt: string;
}

const WORK_IDLE_MS = Math.max(
  60_000,
  Number(process.env.CADGPT_WORK_IDLE_MS || 10 * 60 * 1000)
);
const DRIVER_EPOCH = Date.now();
const registrations = new Map<string, WorkRegistration>();
const activeBySession = new Map<string, string>();
const generationBySession = new Map<string, number>();
const leaseStorage = new AsyncLocalStorage<ToolLease>();
const activeLeases = new Map<string, ToolLease>();
let expirationHandler: ((executionId: string) => void | Promise<void>) | null = null;

function safeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "work";
}

function sessionTag(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex").slice(0, 12);
}

function cleanup(): void {
  const now = Date.now();
  for (const [executionId, work] of registrations) {
    if (now - Date.parse(work.lastActivityAt) <= WORK_IDLE_MS) continue;
    if ([...activeLeases.values()].some((lease) => lease.workId === executionId)) continue;
    registrations.delete(executionId);
    if (activeBySession.get(work.sessionKey) === executionId) {
      activeBySession.delete(work.sessionKey);
    }
    if (expirationHandler) {
      void Promise.resolve(expirationHandler(executionId)).catch(() => undefined);
    }
  }
}

export function setWorkExpirationHandler(
  handler: ((executionId: string) => void | Promise<void>) | null
): void {
  expirationHandler = handler;
}

export function isDevelopmentBuild(): boolean {
  return (process.env.CADGPT_BUILD_PROFILE || "production").trim().toLowerCase() === "development";
}

export function createWorkRegistration(input: {
  sessionKey: string;
  admissionToken: string;
  ownerType: WorkOwnerType;
  ownerId: string;
  executionPath: ExecutionPath;
}): WorkRegistration {
  cleanup();
  validateAdmissionToken(input.admissionToken, input.sessionKey);

  if (input.ownerId === "cad-mcp-dev" && !isDevelopmentBuild()) {
    throw new Error("DEVELOPMENT_ONLY: cad-mcp-dev is unavailable in production builds.");
  }

  const priorId = activeBySession.get(input.sessionKey);
  if (priorId) registrations.delete(priorId);

  const generation = (generationBySession.get(input.sessionKey) || 0) + 1;
  generationBySession.set(input.sessionKey, generation);
  const ownerId = safeId(input.ownerId);
  const executionId =
    `exec:${ownerId}@${sessionTag(input.sessionKey)}:e${DRIVER_EPOCH}:g${generation}`;
  const now = new Date().toISOString();
  const work: WorkRegistration = {
    executionId,
    authorityToken: randomBytes(24).toString("base64url"),
    admissionToken: input.admissionToken,
    sessionKey: input.sessionKey,
    ownerType: input.ownerType,
    ownerId,
    ...(input.ownerType === "job" ? { jobId: ownerId } : {}),
    executionPath: input.executionPath,
    driverEpoch: DRIVER_EPOCH,
    generation,
    callSequence: 0,
    createdAt: now,
    lastActivityAt: now,
  };
  registrations.set(executionId, work);
  activeBySession.set(input.sessionKey, executionId);
  return { ...work };
}

export function validateWorkHandle(
  executionId: string | undefined,
  authorityToken: string | undefined,
  sessionKey: string
): WorkRegistration {
  cleanup();
  if (!executionId || !authorityToken) {
    throw new Error("NO_ACTIVE_WORK: execution_id and authority_token are required.");
  }
  const work = registrations.get(executionId);
  if (
    !work ||
    work.sessionKey !== sessionKey ||
    work.authorityToken !== authorityToken ||
    work.driverEpoch !== DRIVER_EPOCH
  ) {
    throw new Error(
      "NO_ACTIVE_WORK: work handle is stale, invalid, or belongs to another ChatGPT session."
    );
  }
  work.lastActivityAt = new Date().toISOString();
  return work;
}

export function releaseWorkRegistration(
  executionId: string | undefined,
  authorityToken: string | undefined,
  sessionKey: string
): WorkRegistration {
  const work = validateWorkHandle(executionId, authorityToken, sessionKey);
  registrations.delete(work.executionId);
  if (activeBySession.get(sessionKey) === work.executionId) activeBySession.delete(sessionKey);
  return { ...work };
}

export function activeExecutionForSession(sessionKey: string): string | null {
  cleanup();
  return activeBySession.get(sessionKey) ?? null;
}

export function releaseSessionWork(sessionKey: string): string | null {
  const executionId = activeBySession.get(sessionKey) ?? null;
  if (executionId) registrations.delete(executionId);
  activeBySession.delete(sessionKey);
  generationBySession.delete(sessionKey);
  return executionId;
}

export function workStatus(
  sessionKey: string,
  executionId?: string,
  authorityToken?: string
): Record<string, unknown> {
  cleanup();
  if (!executionId && !authorityToken) {
    const activeId = activeBySession.get(sessionKey);
    if (!activeId) return { active: false, idle_timeout_ms: WORK_IDLE_MS };
    const active = registrations.get(activeId);
    if (!active) return { active: false, idle_timeout_ms: WORK_IDLE_MS };
    return {
      active: true,
      execution_id: active.executionId,
      owner_type: active.ownerType,
      owner_id: active.ownerId,
      execution_path: active.executionPath,
      generation: active.generation,
      last_activity_at: active.lastActivityAt,
      idle_timeout_ms: WORK_IDLE_MS,
      note: "Authority token is intentionally omitted from status output.",
    };
  }
  const active = validateWorkHandle(executionId, authorityToken, sessionKey);
  return {
    active: true,
    execution_id: active.executionId,
    owner_type: active.ownerType,
    owner_id: active.ownerId,
    execution_path: active.executionPath,
    generation: active.generation,
    last_activity_at: active.lastActivityAt,
    idle_timeout_ms: WORK_IDLE_MS,
  };
}

export function acquireToolLease(input: {
  tool: string;
  family: string;
  targetId?: string;
  executionId?: string;
  authorityToken?: string;
  admissionToken?: string;
  sessionKey: string;
}): ToolLease {
  validateAdmissionToken(input.admissionToken, input.sessionKey);
  const work = validateWorkHandle(
    input.executionId,
    input.authorityToken,
    input.sessionKey
  );
  // Work authority is session/generation scoped. Each tool invocation must carry
  // the latest valid current-turn admission token for the same session; it does
  // not need to equal the token that originally created the work registration.
  work.callSequence += 1;
  work.lastActivityAt = new Date().toISOString();
  const targetId = safeId(input.targetId || input.family || "target");
  const lease: ToolLease = {
    leaseId:
      `tool:cadgpt:${safeId(input.family)}@${work.ownerId}@${targetId}` +
      `:s${sessionTag(work.sessionKey)}:e${work.driverEpoch}:g${work.generation}:c${work.callSequence}`,
    family: input.family,
    tool: input.tool,
    targetId,
    workId: work.executionId,
    ownerId: work.ownerId,
    sessionKey: work.sessionKey,
    driverEpoch: work.driverEpoch,
    generation: work.generation,
    callSequence: work.callSequence,
    acquiredAt: new Date().toISOString(),
  };
  activeLeases.set(lease.leaseId, lease);
  return lease;
}

export async function runWithToolLease<T>(
  lease: ToolLease,
  callback: () => Promise<T>
): Promise<T> {
  try {
    return await leaseStorage.run(lease, callback);
  } finally {
    activeLeases.delete(lease.leaseId);
    const work = registrations.get(lease.workId);
    if (work) work.lastActivityAt = new Date().toISOString();
  }
}

export function currentToolLease(): ToolLease {
  const lease = leaseStorage.getStore();
  if (!lease) throw new Error("NO_TOOL_LEASE: operation requires an active CadGPT ToolLease.");
  return lease;
}

export function activeWorkCount(): number {
  cleanup();
  return registrations.size;
}

export function activeToolLeaseCount(): number {
  return activeLeases.size;
}

export function hasActiveCadWork(): boolean {
  return [...registrations.values()].some(
    (work) => work.executionPath === "cad" || work.executionPath === "hybrid"
  );
}

export function hasOtherActiveCadWork(executionId: string): boolean {
  return [...registrations.values()].some(
    (work) =>
      work.executionId !== executionId &&
      (work.executionPath === "cad" || work.executionPath === "hybrid")
  );
}

export function executionSupportsCad(executionId: string): boolean {
  const work = registrations.get(executionId);
  return Boolean(
    work && (work.executionPath === "cad" || work.executionPath === "hybrid")
  );
}

export function sweepExpiredWork(): void {
  cleanup();
}
