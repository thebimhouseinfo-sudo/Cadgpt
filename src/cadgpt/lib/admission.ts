import { randomUUID } from "node:crypto";

export type AdmissionMode = "active" | "control" | "inactive";

export type AdmissionInvocationSource = "mention" | "plugin" | "session";

export interface AdmissionDecision {
  mode: AdmissionMode;
  claimed: boolean;
  reason:
    | "explicit_cadgpt"
    | "explicit_cadgpt_plugin"
    | "session_continuation"
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

interface SessionClaim {
  source: "mention" | "plugin";
  claimedAt: number;
}

const ADMISSION_TTL_MS = Math.max(
  60_000,
  Number(process.env.CADGPT_ADMISSION_TTL_MS || 30 * 60 * 1000)
);

const proofs = new Map<string, AdmissionProof>();
const sessionClaims = new Map<string, SessionClaim>();

function cleanupProofs(): void {
  const now = Date.now();
  for (const [token, proof] of proofs) {
    if (now - proof.createdAt > ADMISSION_TTL_MS) proofs.delete(token);
  }
}

function revokeSessionProofs(sessionKey: string): void {
  for (const [token, proof] of proofs) {
    if (proof.sessionKey === sessionKey) proofs.delete(token);
  }
}

function hasExplicitInvocation(userTurn: string): boolean {
  return /(?:^|[^A-Za-z0-9._-])@cadgpt\b/i.test(userTurn);
}

function isControlOnly(userTurn: string): boolean {
  return /^@cadgpt\s+(?:help|status|stop)\s*$/i.test(userTurn.trim());
}

function mintProof(
  sessionKey: string,
  userTurn: string,
  mode: "active" | "control",
  invocationSource: AdmissionInvocationSource
): string {
  const token = randomUUID();
  proofs.set(token, {
    token,
    sessionKey,
    userTurn,
    mode,
    invocationSource,
    createdAt: Date.now(),
  });
  return token;
}

export function checkAdmission(
  sessionKey: string,
  userTurnRaw: string,
  invocationSource: "mention" | "plugin" = "mention"
): AdmissionDecision {
  cleanupProofs();

  // Rotate short-lived per-turn proof tokens, but deliberately retain the
  // session claim. A user explicitly launches CadGPT once per ChatGPT/MCP
  // session; later turns in that same session should not require repeated
  // @cadgpt text or repeated UI activation.
  revokeSessionProofs(sessionKey);

  const userTurn = userTurnRaw?.trim() || "";
  const invokedByMention = Boolean(userTurn && hasExplicitInvocation(userTurn));
  const invokedByPlugin = invocationSource === "plugin";
  const existingClaim = sessionClaims.get(sessionKey);

  if (!userTurn) {
    return {
      mode: "inactive",
      claimed: false,
      reason: "user_did_not_invoke_cadgpt",
      next: "stop_cadgpt_continue_normal_chat_or_requested_plugin",
    };
  }

  if (isControlOnly(userTurn) && (invokedByMention || invokedByPlugin || existingClaim)) {
    const token = mintProof(
      sessionKey,
      userTurn,
      "control",
      invokedByPlugin ? "plugin" : invokedByMention ? "mention" : "session"
    );
    return {
      mode: "control",
      claimed: Boolean(existingClaim || invokedByMention || invokedByPlugin),
      reason: "control_command",
      admission_token: token,
      next: "run_control_command_only",
    };
  }

  if (invokedByMention || invokedByPlugin) {
    const source = invokedByPlugin && !invokedByMention ? "plugin" : "mention";
    sessionClaims.set(sessionKey, {
      source,
      claimedAt: existingClaim?.claimedAt ?? Date.now(),
    });
    const token = mintProof(sessionKey, userTurn, "active", source);
    return {
      mode: "active",
      claimed: true,
      reason: source === "plugin" ? "explicit_cadgpt_plugin" : "explicit_cadgpt",
      admission_token: token,
      next: "continue_cadgpt",
    };
  }

  if (existingClaim) {
    const token = mintProof(sessionKey, userTurn, "active", "session");
    return {
      mode: "active",
      claimed: true,
      reason: "session_continuation",
      admission_token: token,
      next: "continue_cadgpt",
    };
  }

  return {
    mode: "inactive",
    claimed: false,
    reason: "user_did_not_invoke_cadgpt",
    next: "stop_cadgpt_continue_normal_chat_or_requested_plugin",
  };
}

export function validateAdmissionToken(
  token: string | undefined,
  sessionKey: string,
  required: "active" | "control_or_active" = "active"
): AdmissionProof {
  cleanupProofs();
  if (!token) {
    throw new Error(
      "ADMISSION_REQUIRED: launch CadGPT once for this ChatGPT session, then call cadgpt_admission for the current turn."
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

export function revokeSessionAdmissions(sessionKey: string): void {
  revokeSessionProofs(sessionKey);
  sessionClaims.delete(sessionKey);
}

export function isSessionClaimed(sessionKey: string): boolean {
  return sessionClaims.has(sessionKey);
}
