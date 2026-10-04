import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { adoptSessionAdmission, assertSessionClaimed } from "./admission.js";

export type WorkOwnerType = "skill" | "job" | "direct-cad" | "file";
export type ExecutionPath = "file" | "cad" | "hybrid";

export interface HumanPowerGrant {
  grantId: string;
  task: string;
  reason: string;
  errorDescription: string;
  expectedBehavior: string;
  activatedAt: string;
}

export interface WorkRegistration {
  executionId: string;
  authorityToken: string;
  sessionKey: string;
  ownerType: WorkOwnerType;
  ownerId: string;
  jobId?: string;
  executionPath: ExecutionPath;
  capabilities: string[];
  driverEpoch: number;
  generation: number;
  callSequence: number;
  createdAt: string;
  lastActivityAt: string;
  humanPower?: HumanPowerGrant;
  closing?: boolean;
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
  Number(process.env.CADGPT_WORK_IDLE_MS || 30 * 60 * 1000)
);

export function getWorkIdleTimeoutMs(): number {
  return WORK_IDLE_MS;
}
const DRIVER_EPOCH = Date.now();
const registrations = new Map<string, WorkRegistration>();
const activeBySession = new Map<string, string>();
const generationBySession = new Map<string, number>();
const stoppedBySession = new Set<string>();
const leaseStorage = new AsyncLocalStorage<ToolLease>();
const activeLeases = new Map<string, ToolLease>();
const humanPowerCleanupPending = new Map<string, HumanPowerGrant>();
let expirationHandler: ((executionId: string) => void | Promise<void>) | null = null;

function safeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "work";
}

function sessionTag(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex").slice(0, 12);
}

const FILE_FAMILIES = new Set([
  "filesystem",
  "lisp-authoring",
  "job-authoring",
  "library",
  "registry",
  "skills",
  "cad-mcp-dev",
]);
const CAD_FAMILIES = new Set(["cad", "observator"]);

function assertFamilyAllowedForWork(
  work: WorkRegistration,
  family: string
): void {
  if (work.humanPower) return;

  if (
    FILE_FAMILIES.has(family) &&
    work.executionPath !== "file" &&
    work.executionPath !== "hybrid"
  ) {
    throw new Error(
      `EXECUTION_PATH_MISMATCH: tool family '${family}' requires FILE or HYBRID work, but current work is '${work.executionPath}'.`
    );
  }

  if (
    CAD_FAMILIES.has(family) &&
    work.executionPath !== "cad" &&
    work.executionPath !== "hybrid"
  ) {
    throw new Error(
      `EXECUTION_PATH_MISMATCH: tool family '${family}' requires CAD or HYBRID work, but current work is '${work.executionPath}'.`
    );
  }

  if (family === "cad-mcp-dev") {
    if (!isDevelopmentBuild()) {
      throw new Error("DEVELOPMENT_ONLY: cad-mcp-dev is unavailable in production builds.");
    }
    if (
      work.ownerId !== "cad-mcp-dev" &&
      !work.capabilities.includes("cad-mcp-dev")
    ) {
      throw new Error(
        "CAD_MCP_DEV_REQUIRED: explicitly enable cad-mcp-dev for this work before using CAD MCP development tools."
      );
    }
  }
}

function hasActiveLeaseForWork(executionId: string): boolean {
  return [...activeLeases.values()].some(
    (lease) => lease.workId === executionId
  );
}

function cleanup(): void {
  const now = Date.now();
  for (const [executionId, work] of registrations) {
    if (now - Date.parse(work.lastActivityAt) <= WORK_IDLE_MS) continue;
    if (hasActiveLeaseForWork(executionId)) continue;
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

export function markSessionWorkStopped(sessionKey: string): void {
  stoppedBySession.add(sessionKey);
}

export function clearSessionWorkStopBarrier(sessionKey: string): void {
  stoppedBySession.delete(sessionKey);
}

export function sessionWorkStartBlocked(sessionKey: string): boolean {
  return stoppedBySession.has(sessionKey);
}

function assertSessionWorkStartAllowed(sessionKey: string): void {
  if (stoppedBySession.has(sessionKey)) {
    throw new Error(
      "WORK_STOPPED_RESTART_REQUIRED: cg/stop revoked work authority. Start a new explicit CadGPT workflow (for example @cg/cg/list, cg/cl, or cg/cj) before creating new work."
    );
  }
}

export function createWorkRegistration(input: {
  sessionKey: string;
  ownerType: WorkOwnerType;
  ownerId: string;
  executionPath: ExecutionPath;
}): WorkRegistration {
  cleanup();
  assertSessionClaimed(input.sessionKey);
  assertSessionWorkStartAllowed(input.sessionKey);

  const ownerId = safeId(input.ownerId);
  if (ownerId === "cad-mcp-dev" && input.ownerId.trim() !== "cad-mcp-dev") {
    throw new Error(
      "RESERVED_OWNER_ID: cad-mcp-dev must be requested by its exact canonical owner_id."
    );
  }
  if (ownerId === "cad-mcp-dev" && input.ownerType !== "skill") {
    throw new Error(
      "CAD_MCP_DEV_OWNER_TYPE: cad-mcp-dev requires owner_type=skill."
    );
  }
  if (ownerId === "cad-mcp-dev" && !isDevelopmentBuild()) {
    throw new Error("DEVELOPMENT_ONLY: cad-mcp-dev is unavailable in production builds.");
  }

  if (ownerId === "cad-mcp-dev" && input.executionPath === "cad") {
    throw new Error(
      "CAD_MCP_DEV_PATH: cad-mcp-dev source work requires execution_path=file or hybrid; use hybrid when live AutoCAD validation is expected."
    );
  }

  if (
    ownerId === "cad-mcp-dev" &&
    [...registrations.values()].some(
      (work) =>
        (work.ownerId === "cad-mcp-dev" ||
          work.capabilities.includes("cad-mcp-dev")) &&
        work.sessionKey !== input.sessionKey
    )
  ) {
    throw new Error(
      "CAD_MCP_DEV_BUSY: another CadGPT execution owns the mutable CAD MCP source tree."
    );
  }

  const priorId = activeBySession.get(input.sessionKey);
  if (priorId && hasActiveLeaseForWork(priorId)) {
    throw new Error(
      "WORK_BUSY: current CadGPT work still has an active ToolLease; wait for it to finish before replacing work."
    );
  }
  if (priorId) {
    registrations.delete(priorId);
    if (expirationHandler) {
      void Promise.resolve(expirationHandler(priorId)).catch(
        () => undefined
      );
    }
  }

  const generation = (generationBySession.get(input.sessionKey) || 0) + 1;
  generationBySession.set(input.sessionKey, generation);
  const executionId =
    `exec:${ownerId}@${sessionTag(input.sessionKey)}:e${DRIVER_EPOCH}:g${generation}`;
  const now = new Date().toISOString();
  const work: WorkRegistration = {
    executionId,
    authorityToken: randomBytes(24).toString("base64url"),
    sessionKey: input.sessionKey,
    ownerType: input.ownerType,
    ownerId,
    ...(input.ownerType === "job" ? { jobId: ownerId } : {}),
    executionPath: input.executionPath,
    capabilities: ownerId === "cad-mcp-dev" ? ["cad-mcp-dev"] : [],
    driverEpoch: DRIVER_EPOCH,
    generation,
    callSequence: 0,
    createdAt: now,
    lastActivityAt: now,
  };
  registrations.set(executionId, work);
  activeBySession.set(input.sessionKey, executionId);
  return { ...work, capabilities: [...work.capabilities] };
}


export function createSuccessorWorkRegistration(input: {
  previousExecutionId: string;
  authorityToken: string;
  sessionKey: string;
  executionPath: "hybrid";
}): WorkRegistration {
  const previous = validateWorkHandle(
    input.previousExecutionId,
    input.authorityToken,
    input.sessionKey
  );
  if (previous.executionPath !== "file") {
    throw new Error(
      `WORK_UPGRADE_REQUIRES_FILE: current work is '${previous.executionPath}'.`
    );
  }
  if (activeBySession.get(input.sessionKey) !== previous.executionId) {
    throw new Error(
      "WORK_UPGRADE_STALE: the requested FILE work is no longer active."
    );
  }
  if (hasActiveLeaseForWork(previous.executionId)) {
    throw new Error(
      "WORK_BUSY: cannot stage a work upgrade while FILE work has an active ToolLease."
    );
  }

  const generation =
    Math.max(
      generationBySession.get(input.sessionKey) || 0,
      previous.generation
    ) + 1;
  generationBySession.set(input.sessionKey, generation);
  const executionId =
    `exec:${previous.ownerId}@${sessionTag(input.sessionKey)}:e${DRIVER_EPOCH}:g${generation}`;
  const now = new Date().toISOString();
  const successor: WorkRegistration = {
    executionId,
    authorityToken: randomBytes(24).toString("base64url"),
    sessionKey: input.sessionKey,
    ownerType: previous.ownerType,
    ownerId: previous.ownerId,
    ...(previous.jobId ? { jobId: previous.jobId } : {}),
    executionPath: input.executionPath,
    capabilities: [...previous.capabilities],
    ...(previous.humanPower
      ? { humanPower: { ...previous.humanPower } }
      : {}),
    driverEpoch: DRIVER_EPOCH,
    generation,
    callSequence: 0,
    createdAt: now,
    lastActivityAt: now,
  };
  registrations.set(executionId, successor);
  return { ...successor, capabilities: [...successor.capabilities] };
}

export function commitSuccessorWorkRegistration(input: {
  previousExecutionId: string;
  previousAuthorityToken: string;
  successorExecutionId: string;
  successorAuthorityToken: string;
  sessionKey: string;
}): WorkRegistration {
  const previous = validateWorkHandle(
    input.previousExecutionId,
    input.previousAuthorityToken,
    input.sessionKey
  );
  const successor = validateWorkHandle(
    input.successorExecutionId,
    input.successorAuthorityToken,
    input.sessionKey
  );
  if (activeBySession.get(input.sessionKey) !== previous.executionId) {
    throw new Error(
      "WORK_UPGRADE_STALE: active work changed before successor commit."
    );
  }
  if (
    successor.executionPath !== "hybrid" ||
    successor.ownerType !== previous.ownerType ||
    successor.ownerId !== previous.ownerId ||
    successor.generation <= previous.generation
  ) {
    throw new Error(
      "WORK_UPGRADE_INVALID_SUCCESSOR: staged HYBRID work does not match the active FILE work."
    );
  }
  if (
    hasActiveLeaseForWork(previous.executionId) ||
    hasActiveLeaseForWork(successor.executionId)
  ) {
    throw new Error(
      "WORK_BUSY: cannot commit work upgrade while a ToolLease is active."
    );
  }

  if (previous.humanPower) {
    humanPowerCleanupPending.delete(previous.executionId);
    humanPowerCleanupPending.set(
      successor.executionId,
      { ...previous.humanPower }
    );
  }
  registrations.delete(previous.executionId);
  activeBySession.set(input.sessionKey, successor.executionId);
  successor.lastActivityAt = new Date().toISOString();
  return { ...successor, capabilities: [...successor.capabilities] };
}

export function activateHumanPower(input: {
  task: string;
  reason: string;
  errorDescription: string;
  expectedBehavior: string;
}): HumanPowerGrant {
  const lease = currentToolLease();
  const work = registrations.get(lease.workId);
  if (!work || work.closing) {
    throw new Error("NO_ACTIVE_WORK: Human Power requires the current active work execution.");
  }
  if (work.humanPower) {
    throw new Error(
      `HUMAN_POWER_ALREADY_ACTIVE: grant ${work.humanPower.grantId} already owns this execution.`
    );
  }
  const grant: HumanPowerGrant = {
    grantId: `hp_${randomUUID()}`,
    task: input.task.trim(),
    reason: input.reason.trim(),
    errorDescription: input.errorDescription.trim(),
    expectedBehavior: input.expectedBehavior.trim(),
    activatedAt: new Date().toISOString(),
  };
  if (
    !grant.task ||
    !grant.reason ||
    !grant.errorDescription ||
    !grant.expectedBehavior
  ) {
    throw new Error(
      "HUMAN_POWER_CONTEXT_REQUIRED: task, reason, error_description and expected_behavior are required."
    );
  }
  work.humanPower = grant;
  humanPowerCleanupPending.set(work.executionId, { ...grant });
  work.lastActivityAt = new Date().toISOString();
  return { ...grant };
}

export function humanPowerForExecution(
  executionId: string
): HumanPowerGrant | null {
  cleanup();
  const work = registrations.get(executionId);
  return work?.humanPower ? { ...work.humanPower } : null;
}

export function isHumanPowerActive(executionId: string): boolean {
  return humanPowerForExecution(executionId) !== null;
}

export function consumeHumanPowerCleanup(
  executionId: string
): HumanPowerGrant | null {
  const grant = humanPowerCleanupPending.get(executionId) ?? null;
  humanPowerCleanupPending.delete(executionId);
  return grant ? { ...grant } : null;
}

export function currentHumanPower(): HumanPowerGrant | null {
  try {
    const lease = currentToolLease();
    return humanPowerForExecution(lease.workId);
  } catch {
    return null;
  }
}

export function deactivateHumanPower(): HumanPowerGrant | null {
  const lease = currentToolLease();
  const work = registrations.get(lease.workId);
  if (!work || work.closing) return null;
  const prior = work.humanPower ? { ...work.humanPower } : null;
  delete work.humanPower;
  humanPowerCleanupPending.delete(work.executionId);
  work.lastActivityAt = new Date().toISOString();
  return prior;
}

export function enableWorkCapability(
  executionId: string | undefined,
  authorityToken: string | undefined,
  sessionKey: string,
  capability: "cad-mcp-dev"
): WorkRegistration {
  const work = validateWorkHandle(executionId, authorityToken, sessionKey);
  if (capability !== "cad-mcp-dev") {
    throw new Error(`UNSUPPORTED_WORK_CAPABILITY: ${capability}`);
  }
  if (!isDevelopmentBuild()) {
    throw new Error("DEVELOPMENT_ONLY: cad-mcp-dev is unavailable in production builds.");
  }
  if (work.executionPath !== "file" && work.executionPath !== "hybrid") {
    throw new Error(
      "CAD_MCP_DEV_PATH: cad-mcp-dev capability requires FILE or HYBRID work."
    );
  }
  const otherDevOwner = [...registrations.values()].find(
    (candidate) =>
      candidate.executionId !== work.executionId &&
      !candidate.closing &&
      (candidate.ownerId === "cad-mcp-dev" ||
        candidate.capabilities.includes("cad-mcp-dev"))
  );
  if (otherDevOwner) {
    throw new Error(
      "CAD_MCP_DEV_BUSY: another CadGPT execution owns the mutable CAD MCP source tree."
    );
  }
  if (!work.capabilities.includes(capability)) {
    work.capabilities.push(capability);
  }
  work.lastActivityAt = new Date().toISOString();
  return { ...work, capabilities: [...work.capabilities] };
}

export function adoptWorkSession(
  executionId: string | undefined,
  authorityToken: string | undefined,
  targetSessionKey: string
): WorkRegistration {
  cleanup();
  if (!executionId || !authorityToken) {
    throw new Error("NO_ACTIVE_WORK: execution_id and authority_token are required.");
  }

  const work = registrations.get(executionId);
  if (
    !work ||
    work.closing === true ||
    work.authorityToken !== authorityToken ||
    work.driverEpoch !== DRIVER_EPOCH
  ) {
    throw new Error(
      "NO_ACTIVE_WORK: work handle is stale, invalid, or unavailable for continuation."
    );
  }

  if (work.sessionKey === targetSessionKey) {
    assertSessionClaimed(targetSessionKey);
    work.lastActivityAt = new Date().toISOString();
    return { ...work, capabilities: [...work.capabilities] };
  }

  if (hasActiveLeaseForWork(work.executionId)) {
    throw new Error(
      "WORK_BUSY: cannot move CadGPT work to a replacement MCP session while a ToolLease is active."
    );
  }

  const targetActiveId = activeBySession.get(targetSessionKey);
  if (targetActiveId && targetActiveId !== work.executionId) {
    throw new Error(
      "WORK_SESSION_CONFLICT: replacement MCP session already owns different active CadGPT work."
    );
  }

  const sourceSessionKey = work.sessionKey;
  adoptSessionAdmission(sourceSessionKey, targetSessionKey);

  if (activeBySession.get(sourceSessionKey) === work.executionId) {
    activeBySession.delete(sourceSessionKey);
  }
  work.sessionKey = targetSessionKey;
  work.lastActivityAt = new Date().toISOString();
  activeBySession.set(targetSessionKey, work.executionId);
  generationBySession.set(
    targetSessionKey,
    Math.max(generationBySession.get(targetSessionKey) || 0, work.generation)
  );

  return { ...work, capabilities: [...work.capabilities] };
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
    work.closing === true ||
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
  if (hasActiveLeaseForWork(work.executionId)) {
    throw new Error(
      "WORK_BUSY: cannot stop CadGPT work while a ToolLease is still active."
    );
  }
  registrations.delete(work.executionId);
  if (activeBySession.get(sessionKey) === work.executionId) activeBySession.delete(sessionKey);
  return { ...work, capabilities: [...work.capabilities] };
}

export function activeExecutionForSession(sessionKey: string): string | null {
  cleanup();
  return activeBySession.get(sessionKey) ?? null;
}

export function activeWorkForSession(sessionKey: string): WorkRegistration | null {
  cleanup();
  const executionId = activeBySession.get(sessionKey);
  if (!executionId) return null;
  const work = registrations.get(executionId);
  if (!work || work.closing) return null;
  work.lastActivityAt = new Date().toISOString();
  return { ...work, capabilities: [...work.capabilities] };
}

export function releaseSessionWork(sessionKey: string): string | null {
  const executionId = activeBySession.get(sessionKey) ?? null;
  activeBySession.delete(sessionKey);
  if (!executionId) return null;

  const work = registrations.get(executionId);
  if (!work) return executionId;

  if (hasActiveLeaseForWork(executionId)) {
    // Session authority is gone immediately, but resource cleanup must wait for
    // the in-flight capability call to release its final ToolLease.
    work.closing = true;
    work.lastActivityAt = new Date().toISOString();
    return null;
  }

  registrations.delete(executionId);
  // Keep generationBySession for the lifetime of this driver epoch so a
  // recovered/recreated MCP session cannot reuse an earlier execution ID.
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
      capabilities: [...active.capabilities],
      human_power: active.humanPower
        ? {
            active: true,
            grant_id: active.humanPower.grantId,
            task: active.humanPower.task,
            activated_at: active.humanPower.activatedAt,
          }
        : { active: false },
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
    capabilities: [...active.capabilities],
    human_power: active.humanPower
      ? {
          active: true,
          grant_id: active.humanPower.grantId,
          task: active.humanPower.task,
          activated_at: active.humanPower.activatedAt,
        }
      : { active: false },
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
  sessionKey: string;
}): ToolLease {
  assertSessionClaimed(input.sessionKey);
  const work = validateWorkHandle(
    input.executionId,
    input.authorityToken,
    input.sessionKey
  );
  assertFamilyAllowedForWork(work, input.family);

  if (
    input.family === "cad-mcp-dev" &&
    [...activeLeases.values()].some(
      (lease) =>
        lease.workId === work.executionId &&
        lease.family === "cad-mcp-dev"
    )
  ) {
    throw new Error(
      "CAD_MCP_DEV_BUSY: another cad-mcp-dev tool call is still active for this source execution."
    );
  }

  // Work authority is session/generation scoped. Session claim admits CadGPT;
  // execution_id + authority_token are the actual work credentials.
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
    if (work) {
      work.lastActivityAt = new Date().toISOString();
      if (work.closing && !hasActiveLeaseForWork(work.executionId)) {
        registrations.delete(work.executionId);
        if (expirationHandler) {
          await Promise.resolve(expirationHandler(work.executionId)).catch(
            () => undefined
          );
        }
      }
    }
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

export function hasActiveCadCapabilityLease(): boolean {
  return [...activeLeases.values()].some(
    (lease) => lease.family === "cad" || lease.family === "observator"
  );
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
