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
  next:
    | "continue_cadgpt"
    | "run_control_command_only"
    | "stop_cadgpt_continue_normal_chat_or_requested_plugin";
}

export interface SessionClaim {
  sessionKey: string;
  source: "mention" | "plugin";
  claimedAt: number;
  lastAccessedAt: number;
}

const sessionClaims = new Map<string, SessionClaim>();

function hasExplicitInvocation(userTurn: string): boolean {
  return /(?:^|[^A-Za-z0-9._-])@cadgpt\b/i.test(userTurn);
}

function isControlOnly(userTurn: string): boolean {
  const value = userTurn.trim();
  return (
    /^@cadgpt\s+(?:help|status|stop)\s*$/i.test(value) ||
    /^cadgpt\/(?:help|status|stop)\s*$/i.test(value)
  );
}

function touchClaim(sessionKey: string): SessionClaim | undefined {
  const claim = sessionClaims.get(sessionKey);
  if (!claim) return undefined;
  claim.lastAccessedAt = Date.now();
  return claim;
}

export function checkAdmission(
  sessionKey: string,
  userTurnRaw: string,
  invocationSource: "mention" | "plugin" = "mention"
): AdmissionDecision {
  const userTurn = userTurnRaw?.trim() || "";
  const invokedByMention = Boolean(userTurn && hasExplicitInvocation(userTurn));
  const invokedByPlugin = invocationSource === "plugin";
  const existingClaim = touchClaim(sessionKey);

  if (!userTurn) {
    return {
      mode: "inactive",
      claimed: false,
      reason: "user_did_not_invoke_cadgpt",
      next: "stop_cadgpt_continue_normal_chat_or_requested_plugin",
    };
  }

  if (isControlOnly(userTurn) && (existingClaim || invokedByMention || invokedByPlugin)) {
    return {
      mode: "control",
      claimed: Boolean(existingClaim || invokedByMention || invokedByPlugin),
      reason: "control_command",
      next: "run_control_command_only",
    };
  }

  if (invokedByMention || invokedByPlugin) {
    const source = invokedByPlugin && !invokedByMention ? "plugin" : "mention";
    const now = Date.now();
    sessionClaims.set(sessionKey, {
      sessionKey,
      source,
      claimedAt: existingClaim?.claimedAt ?? now,
      lastAccessedAt: now,
    });
    return {
      mode: "active",
      claimed: true,
      reason: source === "plugin" ? "explicit_cadgpt_plugin" : "explicit_cadgpt",
      next: "continue_cadgpt",
    };
  }

  if (existingClaim) {
    return {
      mode: "active",
      claimed: true,
      reason: "session_continuation",
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

export function assertSessionClaimed(sessionKey: string): SessionClaim {
  const claim = touchClaim(sessionKey);
  if (!claim) {
    throw new Error(
      "CADGPT_SESSION_REQUIRED: launch CadGPT once in this chat with the plugin/icon or @cadgpt."
    );
  }
  return { ...claim };
}

export function revokeSessionAdmissions(sessionKey: string): void {
  sessionClaims.delete(sessionKey);
}

export function isSessionClaimed(sessionKey: string): boolean {
  return Boolean(touchClaim(sessionKey));
}
