import type { Request, Response } from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  extractRequestId,
  type SessionManager,
} from "./mcp-session-manager.js";
import { buildLegacyDiscoverFallback } from "./mcp-discover-compat.js";
import { extractHeaderlessCadConfirmToken } from "./headerless-recovery.js";
import { logicalConversationKeyFromRequest } from "./logical-conversation.js";
import {
  continuityFingerprint,
  logContinuityRequest,
} from "./continuity-diagnostics.js";

export async function routeMcpPost(options: {
  req: Request;
  res: Response;
  sessions: SessionManager;
  sessionRecovery: boolean;
  resolveCadPrepareSessionByToken: (token: string) => string | undefined;
}): Promise<void> {
  const {
    req,
    res,
    sessions,
    sessionRecovery,
    resolveCadPrepareSessionByToken,
  } = options;
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  logContinuityRequest(req, "request_received", {
    session_recovery_enabled: sessionRecovery,
  });

  const discoverFallback = buildLegacyDiscoverFallback(req.body);
  if (discoverFallback) {
    console.log("[MCP] server/discover -> legacy initialize fallback");
    logContinuityRequest(req, "route_legacy_discover_fallback");
    res.status(200).json(discoverFallback);
    return;
  }

  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing) {
    logContinuityRequest(req, "route_existing_transport");
    await sessions.handleExisting(existing, req, res, req.body);
    return;
  }

  if (isInitializeRequest(req.body)) {
    logContinuityRequest(req, "route_new_initialize");
    await sessions.createNew(req, res, req.body);
    return;
  }

  if (sessionId && sessionRecovery) {
    const recovered = await sessions.tryRecover(sessionId, req, res, req.body);
    logContinuityRequest(req, recovered ? "route_recovered_transport" : "route_transport_recovery_miss");
    if (recovered) return;
  }

  if (!sessionId && sessionRecovery) {
    const confirmationToken = extractHeaderlessCadConfirmToken(req.body);
    const pendingLogicalKey = confirmationToken
      ? resolveCadPrepareSessionByToken(confirmationToken)
      : undefined;
    if (pendingLogicalKey) {
      const requestLogicalKey = logicalConversationKeyFromRequest(req);
      if (!requestLogicalKey || requestLogicalKey !== pendingLogicalKey) {
        logContinuityRequest(req, "route_cad_confirmation_identity_rejected", {
          pending_logical_session: continuityFingerprint(pendingLogicalKey),
          presented_logical_session: continuityFingerprint(
            requestLogicalKey ?? undefined
          ),
        });
        sessions.sendBadRequest(
          res,
          "CadGPT confirmation does not belong to this connector conversation.",
          extractRequestId(req.body)
        );
        return;
      }

      const recovered = await sessions.recoverLogical(
        pendingLogicalKey,
        req,
        res,
        req.body
      );
      logContinuityRequest(
        req,
        recovered
          ? "route_recovered_by_cad_confirmation"
          : "route_cad_confirmation_recovery_miss",
        {
          recovered_logical_session: continuityFingerprint(
            pendingLogicalKey
          ),
        }
      );
      if (recovered) return;
    } else if (confirmationToken) {
      logContinuityRequest(req, "route_cad_confirmation_token_unresolved");
    }
  }

  if (sessionId) {
    logContinuityRequest(req, "route_session_not_found");
    sessions.sendNotFound(res, extractRequestId(req.body));
  } else {
    logContinuityRequest(req, "route_missing_session_id");
    sessions.sendBadRequest(
      res,
      "Mcp-Session-Id is required",
      extractRequestId(req.body)
    );
  }
}
