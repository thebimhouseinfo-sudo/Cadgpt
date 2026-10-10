import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface JobSystemLease {
  tool_id: string;
  job_id: string;
  job_name: string;
  job_root?: string;
  session_key: string;
  readable_roots: string[];
  writable_roots: string[];
  acquired_at: string;
  lease_nonce: string;
}

const leases = new Map<string, JobSystemLease>();
const inFlightByLeaseKey = new Map<string, number>();
const leaseStorage = new AsyncLocalStorage<JobSystemLease>();

function leaseKey(value: string): string {
  return value.trim().toLowerCase();
}

function cloneLease(lease: JobSystemLease): JobSystemLease {
  return {
    ...lease,
    readable_roots: [...lease.readable_roots],
    writable_roots: [...lease.writable_roots],
  };
}

export function jobSystemLeaseForSession(
  toolId: string,
  sessionKey: string
): JobSystemLease | null {
  const lease = leases.get(leaseKey(toolId));
  if (!lease) return null;
  if (lease.session_key !== sessionKey) {
    throw new Error(
      `SYSTEM_LEASE_BUSY: '${lease.tool_id}' is owned by another CadGPT session.`
    );
  }
  return cloneLease(lease);
}

export function acquireJobSystemLease(input: {
  toolId: string;
  jobId: string;
  jobName: string;
  jobRoot?: string;
  sessionKey: string;
  readableRoots: string[];
  writableRoots: string[];
}): JobSystemLease {
  const key = leaseKey(input.toolId);
  if (!key) throw new Error("SYSTEM_LEASE_ID_REQUIRED: tool_id is required.");

  const existing = leases.get(key);
  if (existing) {
    if (existing.session_key !== input.sessionKey) {
      throw new Error(
        `SYSTEM_LEASE_BUSY: '${existing.tool_id}' is owned by another CadGPT session.`
      );
    }
    return cloneLease(existing);
  }

  const lease: JobSystemLease = {
    tool_id: input.toolId.trim(),
    job_id: input.jobId.trim(),
    job_name: input.jobName.trim() || input.jobId.trim(),
    job_root: input.jobRoot ? path.resolve(input.jobRoot) : undefined,
    session_key: input.sessionKey,
    readable_roots: [...new Set(input.readableRoots.map((root) => path.resolve(root)))],
    writable_roots: [...new Set(input.writableRoots.map((root) => path.resolve(root)))],
    acquired_at: new Date().toISOString(),
    lease_nonce: randomUUID(),
  };
  leases.set(key, lease);
  return cloneLease(lease);
}

export function getJobSystemLease(
  toolId: string,
  sessionKey: string
): JobSystemLease {
  const lease = jobSystemLeaseForSession(toolId, sessionKey);
  if (!lease) {
    throw new Error(
      `NO_SYSTEM_LEASE: '${toolId}' has no active Job SYSTEM lease.`
    );
  }
  return lease;
}

export function releaseJobSystemLease(
  toolId: string,
  sessionKey: string
): JobSystemLease {
  const lease = getJobSystemLease(toolId, sessionKey);
  leases.delete(leaseKey(toolId));
  return lease;
}

/** Internal lifecycle inspection; not an MCP capability or cross-session file authority. */
export function allActiveJobSystemLeases(): JobSystemLease[] {
  return [...leases.values()].map(cloneLease);
}

/** A detached SYSTEM call must finish before authority can be handed off. */
export function jobSystemLeaseHasInFlightCall(toolId: string): boolean {
  return (inFlightByLeaseKey.get(leaseKey(toolId)) ?? 0) > 0;
}

export function activeJobSystemLeasesForSession(
  sessionKey: string
): JobSystemLease[] {
  return [...leases.values()]
    .filter((lease) => lease.session_key === sessionKey)
    .map(cloneLease)
    .sort((a, b) => a.job_id.localeCompare(b.job_id));
}

export function releaseJobSystemLeasesForSession(
  sessionKey: string
): JobSystemLease[] {
  const released: JobSystemLease[] = [];
  for (const [key, lease] of leases) {
    if (lease.session_key !== sessionKey) continue;
    leases.delete(key);
    released.push(cloneLease(lease));
  }
  return released;
}

export async function runWithJobSystemLease<T>(
  lease: JobSystemLease,
  callback: () => Promise<T>
): Promise<T> {
  const key = leaseKey(lease.tool_id);
  const active = leases.get(key);
  if (!active || active.session_key !== lease.session_key ||
      active.lease_nonce !== lease.lease_nonce) {
    throw new Error("SYSTEM_LEASE_TERMINATED: this detached Job authority was superseded.");
  }
  inFlightByLeaseKey.set(key, (inFlightByLeaseKey.get(key) ?? 0) + 1);
  try {
    return await leaseStorage.run(lease, callback);
  } finally {
    const remaining = (inFlightByLeaseKey.get(key) ?? 1) - 1;
    if (remaining <= 0) inFlightByLeaseKey.delete(key);
    else inFlightByLeaseKey.set(key, remaining);
  }
}

export function currentJobSystemLease(): JobSystemLease | null {
  const lease = leaseStorage.getStore();
  return lease ? cloneLease(lease) : null;
}
