import { randomUUID } from "node:crypto";

import { runtimeStateSnapshot } from "../lib/runtime-state.js";
import { hasOtherActiveCadWork } from "../lib/work-registration.js";
import {
  assertCadDevSourceAccess,
  cadDevSourceTransactionStatus,
} from "./cad-dev-source-transaction.js";

export interface CadCandidateState {
  candidateId: string;
  ownerExecutionId: string;
  generation: number;
  snapshotId: string;
  sourceFingerprint: string;
  startedAt: string;
  successfulTools: string[];
  lastSuccessAt: string | null;
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

export function assertCadRuntimeGenerationAccess(
  executionId: string
): void {
  assertCadDevSourceAccess(executionId);
  const sourceTransaction = cadDevSourceTransactionStatus();

  if (
    sourceTransaction &&
    sourceTransaction.ownerExecutionId === executionId
  ) {
    if (
      !activeCandidate ||
      activeCandidate.ownerExecutionId !== executionId
    ) {
      throw new Error(
        "CAD_CANDIDATE_REQUIRED: CAD MCP source is modified but not yet in an active candidate generation. Run cad_mcp_dev_validate(action=all) and cad_mcp_dev_candidate_start before live CAD calls."
      );
    }
  }

  assertCadCandidateAccess(executionId);
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
    successfulTools: [],
    lastSuccessAt: null,
  };
  return { ...activeCandidate };
}

export function assertCadCandidateSourceMutationAllowed(executionId: string): void {
  if (!activeCandidate) return;
  if (activeCandidate.ownerExecutionId === executionId) {
    throw new Error(
      "CAD_CANDIDATE_ACTIVE: source/environment mutation is blocked while the live candidate is reserved. Accept it or rollback first."
    );
  }
  throw new Error(
    "CAD_CANDIDATE_RESERVED: another execution owns the live CAD MCP candidate."
  );
}

export function recordCadCandidateSuccess(
  executionId: string,
  toolName: string
): void {
  if (!activeCandidate || activeCandidate.ownerExecutionId !== executionId) return;
  if (!activeCandidate.successfulTools.includes(toolName)) {
    activeCandidate.successfulTools.push(toolName);
  }
  activeCandidate.lastSuccessAt = new Date().toISOString();
}

function requireOwner(executionId: string): CadCandidateState {
  if (!activeCandidate) throw new Error("NO_CAD_CANDIDATE: no candidate runtime is active.");
  if (activeCandidate.ownerExecutionId !== executionId) {
    throw new Error("CAD_CANDIDATE_RESERVED: candidate runtime belongs to another execution.");
  }
  return activeCandidate;
}

export async function acceptCadCandidate(
  executionId: string,
  validatedTool: string
): Promise<CadCandidateState> {
  const candidate = requireOwner(executionId);
  if (!candidate.successfulTools.includes("cad_refresh_tools")) {
    throw new Error(
      "CAD_CANDIDATE_MANIFEST_NOT_VERIFIED: run cad_refresh_tools successfully in this candidate generation before acceptance."
    );
  }
  if (!candidate.successfulTools.includes(validatedTool)) {
    throw new Error(
      `CAD_CANDIDATE_NOT_LIVE_VALIDATED: '${validatedTool}' has no successful live CAD call in this candidate generation.`
    );
  }
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
