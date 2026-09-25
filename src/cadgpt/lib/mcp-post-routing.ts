import type { Request, Response } from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  extractRequestId,
  type SessionManager,
} from "./mcp-session-manager.js";
import { buildLegacyDiscoverFallback } from "./mcp-discover-compat.js";
import { extractHeaderlessCadConfirmToken } from "./headerless-recovery.js";

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

  const discoverFallback = buildLegacyDiscoverFallback(req.body);
  if (discoverFallback) {
    console.log("[MCP] server/discover -> legacy initialize fallback");
    res.status(200).json(discoverFallback);
    return;
  }

  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing) {
    await sessions.handleExisting(existing, req, res, req.body);
    return;
  }

  if (isInitializeRequest(req.body)) {
    await sessions.createNew(req, res, req.body);
    return;
  }

  if (sessionId && sessionRecovery) {
    if (await sessions.tryRecover(sessionId, req, res, req.body)) return;
  }

  if (!sessionId && sessionRecovery) {
    const confirmationToken = extractHeaderlessCadConfirmToken(req.body);
    const recoveryId = confirmationToken
      ? resolveCadPrepareSessionByToken(confirmationToken)
      : undefined;
    if (
      recoveryId &&
      (await sessions.tryRecover(recoveryId, req, res, req.body))
    ) {
      return;
    }
  }

  if (sessionId) {
    sessions.sendNotFound(res, extractRequestId(req.body));
  } else {
    sessions.sendBadRequest(
      res,
      "Mcp-Session-Id is required",
      extractRequestId(req.body)
    );
  }
}
