import { randomUUID } from "node:crypto";

export type AdmissionMode = "active" | "control" | "inactive";

export type AdmissionInvocationSource = "mention" | "plugin";

export interface AdmissionDecision {
  mode: AdmissionMode;
  claimed: boolean;
  reason:
    | "explicit_cadgpt"
    | "explicit_cadgpt_plugin"
    | "control_command"
    | "user_did_not_invoke_cadgpt";
  admission_token?: string;
  next:
    | "continue_cadgpt"
    | "run_control_command_only"
    | "stop_cadgpt_continue_normal_chat_or_requested_plugin";
}

export interface AdmissionProof {
  token: string;
  sessionKey: string;
  userTurn: string;
  mode: "active" | "control";
  invocationSource: AdmissionInvocationSource;
  createdAt: number;
}

const ADMISSION_TTL_MS = Math.max(
  60_000,
  Number(process.env.CADGPT_ADMISSION_TTL_MS || 30 * 60 * 1000)
);
const proofs = new Map<string, AdmissionProof>();

function cleanup(): void {
  const now = Date.now();
  for (const [token, proof] of proofs) {
    if (now - proof.createdAt > ADMISSION_TTL_MS) proofs.delete(token);
  }
}

function hasExplicitInvocation(userTurn: string): boolean {
  return /(?:^|[^A-Za-z0-9._-])@cadgpt\b/i.test(userTurn);
}

function isControlOnly(userTurn: string): boolean {
  const value = userTurn.trim();
  return /^@cadgpt(?:\s+(?:help|status|stop))?\s*$/i.test(value);
}

export function checkAdmission(
  sessionKey: string,
  userTurnRaw: string,
  invocationSource: AdmissionInvocationSource = "mention"
): AdmissionDecision {
  cleanup();

  // A new admission check represents a new current-turn decision for this MCP session.
  // Revoke every older proof first so a token minted for a previous @cadgpt turn
  // cannot authorize a later turn that did not invoke CadGPT.
  revokeSessionAdmissions(sessionKey);

  const userTurn = userTurnRaw?.trim() || "";
  const invokedByMention = Boolean(userTurn && hasExplicitInvocation(userTurn));
  const invokedByPlugin = invocationSource === "plugin";

  if (!userTurn || (!invokedByMention && !invokedByPlugin)) {
    return {
      mode: "inactive",
      claimed: false,
      reason: "user_did_not_invoke_cadgpt",
      next: "stop_cadgpt_continue_normal_chat_or_requested_plugin",
    };
  }

  if (isControlOnly(userTurn)) {
    const token = randomUUID();
    proofs.set(token, {
      token,
      sessionKey,
      userTurn,
      mode: "control",
      invocationSource,
      createdAt: Date.now(),
    });
    return {
      mode: "control",
      claimed: true,
      reason: "control_command",
      admission_token: token,
      next: "run_control_command_only",
    };
  }

  const token = randomUUID();
  proofs.set(token, {
    token,
    sessionKey,
    userTurn,
    mode: "active",
    invocationSource,
    createdAt: Date.now(),
  });
  return {
    mode: "active",
    claimed: true,
    reason: invokedByPlugin && !invokedByMention ? "explicit_cadgpt_plugin" : "explicit_cadgpt",
    admission_token: token,
    next: "continue_cadgpt",
  };
}

export function validateAdmissionToken(
  token: string | undefined,
  sessionKey: string,
  required: "active" | "control_or_active" = "active"
): AdmissionProof {
  cleanup();
  if (!token) {
    throw new Error(
      "ADMISSION_REQUIRED: call cadgpt_admission first using the exact current user turn."
    );
  }
  const proof = proofs.get(token);
  if (!proof || proof.sessionKey !== sessionKey) {
    throw new Error(
      "ADMISSION_REQUIRED: admission token is missing, stale, invalid, or belongs to another ChatGPT session."
    );
  }
  if (required === "active" && proof.mode !== "active") {
    throw new Error(
      "ACTIVE_ADMISSION_REQUIRED: CONTROL authority cannot enter discovery, FILE, CAD, or work execution."
    );
  }
  return proof;
}

export function revokeAdmissionToken(token: string | undefined): void {
  if (token) proofs.delete(token);
}

export function revokeSessionAdmissions(sessionKey: string): void {
  for (const [token, proof] of proofs) {
    if (proof.sessionKey === sessionKey) proofs.delete(token);
  }
}
