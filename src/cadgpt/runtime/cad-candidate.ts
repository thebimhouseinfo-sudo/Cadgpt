import { randomUUID } from "node:crypto";

import { runtimeStateSnapshot } from "../lib/runtime-state.js";
import { hasOtherActiveCadWork } from "../lib/work-registration.js";

export interface CadCandidateState {
  candidateId: string;
  ownerExecutionId: string;
  generation: number;
  snapshotId: string;
  sourceFingerprint: string;
  startedAt: string;
}

let candidateGeneration = 0;
let activeCandidate: CadCandidateState | null = null;

async function stopCadBackendIfLoaded(): Promise<void> {
  if (!runtimeStateSnapshot().loaded_families.includes("cad")) return;
  const { cadUpstream } = await import("./cad-upstream.js");
  if (cadUpstream.status().enabled || cadUpstream.status().connected) {
    await cadUpstream.deactivate();
  }
}

export function candidateStatus(): CadCandidateState | null {
  return activeCandidate ? { ...activeCandidate } : null;
}

export function assertCadCandidateAccess(executionId: string): void {
  if (!activeCandidate) return;
  if (activeCandidate.ownerExecutionId !== executionId) {
    throw new Error(
      "CAD_CANDIDATE_RESERVED: CAD MCP is reserved by another cad-mcp-dev candidate execution."
    );
  }
}

export async function beginCadCandidate(input: {
  ownerExecutionId: string;
  snapshotId: string;
  sourceFingerprint: string;
}): Promise<CadCandidateState> {
  if (activeCandidate) {
    if (activeCandidate.ownerExecutionId === input.ownerExecutionId) {
      throw new Error("CAD_CANDIDATE_ACTIVE: this execution already owns an active candidate runtime.");
    }
    throw new Error("CAD_CANDIDATE_RESERVED: another execution already owns the candidate runtime.");
  }

  if (hasOtherActiveCadWork(input.ownerExecutionId)) {
    throw new Error(
      "CAD_CANDIDATE_BUSY: another CAD/hybrid work execution is active. Finish that work before starting live candidate validation."
    );
  }

  // The normal CAD backend must be stopped before the candidate generation can
  // own it. The next CAD call by this execution starts a fresh Python process
  // from the candidate source tree.
  await stopCadBackendIfLoaded();

  candidateGeneration += 1;
  activeCandidate = {
    candidateId: `cad_candidate_${randomUUID()}`,
    ownerExecutionId: input.ownerExecutionId,
    generation: candidateGeneration,
    snapshotId: input.snapshotId,
    sourceFingerprint: input.sourceFingerprint,
    startedAt: new Date().toISOString(),
  };
  return { ...activeCandidate };
}

function requireOwner(executionId: string): CadCandidateState {
  if (!activeCandidate) throw new Error("NO_CAD_CANDIDATE: no candidate runtime is active.");
  if (activeCandidate.ownerExecutionId !== executionId) {
    throw new Error("CAD_CANDIDATE_RESERVED: candidate runtime belongs to another execution.");
  }
  return activeCandidate;
}

export async function acceptCadCandidate(executionId: string): Promise<CadCandidateState> {
  const candidate = requireOwner(executionId);
  // Stop the candidate process so the next normal CAD work starts a clean
  // known accepted generation rather than inheriting dev-session process state.
  await stopCadBackendIfLoaded();
  activeCandidate = null;
  return candidate;
}

export async function abortCadCandidate(executionId: string): Promise<CadCandidateState | null> {
  if (!activeCandidate) return null;
  const candidate = requireOwner(executionId);
  await stopCadBackendIfLoaded();
  activeCandidate = null;
  return candidate;
}

export async function releaseCadCandidateForExecution(executionId: string): Promise<void> {
  if (!activeCandidate || activeCandidate.ownerExecutionId !== executionId) return;
  await stopCadBackendIfLoaded().catch(() => undefined);
  activeCandidate = null;
}
