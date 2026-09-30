import type { Request, Response } from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  extractRequestId,
  type SessionManager,
} from "./mcp-session-manager.js";
import { buildLegacyDiscoverFallback } from "./mcp-discover-compat.js";
import {
  extractHeaderlessCadConfirmToken,
  isHeaderlessCadConfirmCall,
} from "./headerless-recovery.js";
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
    if (!sessions.matchesTransportIdentity(sessionId, req)) {
      logContinuityRequest(req, "route_transport_identity_rejected", {
        transport_session: continuityFingerprint(sessionId),
      });
      sessions.sendBadRequest(
        res,
        "CadGPT connector conversation identity is missing or does not match this MCP transport.",
        extractRequestId(req.body)
      );
      return;
    }

    const recovered = await sessions.tryRecover(sessionId, req, res, req.body);
    logContinuityRequest(req, recovered ? "route_recovered_transport" : "route_transport_recovery_miss");
    if (recovered) return;
  }

  if (
    !sessionId &&
    sessionRecovery &&
    isHeaderlessCadConfirmCall(req.body)
  ) {
    const requestLogicalKey = logicalConversationKeyFromRequest(req);
    if (!requestLogicalKey) {
      logContinuityRequest(req, "route_cad_confirmation_identity_missing");
      sessions.sendBadRequest(
        res,
        "CadGPT confirmation requires the connector conversation identity.",
        extractRequestId(req.body)
      );
      return;
    }

    const confirmationToken = extractHeaderlessCadConfirmToken(req.body);
    if (confirmationToken) {
      const pendingLogicalKey =
        resolveCadPrepareSessionByToken(confirmationToken);
      if (!pendingLogicalKey) {
        logContinuityRequest(req, "route_cad_confirmation_token_unresolved");
        sessions.sendBadRequest(
          res,
          "CadGPT workspace selection is missing or stale. Use cg/list and select one drawing again.",
          extractRequestId(req.body)
        );
        return;
      }
      if (requestLogicalKey !== pendingLogicalKey) {
        logContinuityRequest(req, "route_cad_confirmation_identity_rejected", {
          pending_logical_session: continuityFingerprint(pendingLogicalKey),
          presented_logical_session: continuityFingerprint(requestLogicalKey),
        });
        sessions.sendBadRequest(
          res,
          "CadGPT confirmation does not belong to this connector conversation.",
          extractRequestId(req.body)
        );
        return;
      }
    }

    const recovered = await sessions.recoverLogical(
      requestLogicalKey,
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
        recovered_logical_session: continuityFingerprint(requestLogicalKey),
        token_present: Boolean(confirmationToken),
      }
    );
    if (recovered) return;
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
