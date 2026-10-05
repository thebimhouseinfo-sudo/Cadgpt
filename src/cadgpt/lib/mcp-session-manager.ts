import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createMcpServer,
  disposeLogicalSessionState,
  disposeMcpServerRuntime,
  rehydrateServerForLogicalSession,
} from "../server-factory.js";
import {
  continuityFingerprint,
  logContinuityDiagnostic,
  logContinuityRequest,
} from "./continuity-diagnostics.js";
import { logicalConversationKeyFromRequest } from "./logical-conversation.js";

const DEFAULT_SESSION_TTL_MS = Number(process.env.MCP_SESSION_TTL_MS || 86_400_000);
const DEFAULT_CLEANUP_MS = Number(process.env.MCP_SESSION_CLEANUP_MS || 300_000);
const DEFAULT_DELETE_GRACE_MS = Number(process.env.MCP_SESSION_DELETE_GRACE_MS || 45_000);

export interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  logicalSessionKey: string;
  connectorIdentityBound: boolean;
  lastAccessedAt: number;
}

export interface SessionManagerOptions {
  createServer?: (sessionKey: string) => McpServer;
  sessionTtlMs?: number;
  cleanupMs?: number;
  deleteGraceMs?: number;
  isLogicalSessionPinned?: (
    sessionKey: string
  ) => boolean;
}

export interface SessionManager {
  get(id: string): McpSession | undefined;
  count(): number;
  createNew(req: Request, res: Response, body: unknown): Promise<void>;
  handleExisting(session: McpSession, req: Request, res: Response, body?: unknown): Promise<void>;
  matchesTransportIdentity(id: string, req: Request): boolean;
  tryRecover(id: string, req: Request, res: Response, body: unknown): Promise<boolean>;
  recoverLogical(logicalKey: string, req: Request, res: Response, body: unknown): Promise<boolean>;
  sendNotFound(res: Response, requestId?: string | number | null): void;
  sendBadRequest(res: Response, message: string, requestId?: string | number | null): void;
  startCleanup(): void;
  stopCleanup(): void;
  closeAll(reason?: string): Promise<void>;
}

export function extractRequestId(body: unknown): string | number | null {
  if (!body || typeof body !== "object" || !("id" in body)) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function negotiateProtocol(requested?: string): string {
  if (requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) return requested;
  return LATEST_PROTOCOL_VERSION;
}

function isInitializedNotification(body: unknown): boolean {
  return Boolean(
    body &&
    typeof body === "object" &&
    (body as { method?: unknown }).method ===
      "notifications/initialized"
  );
}

function refreshClientToolSurface(
  server: McpServer,
  logicalSessionKey: string
): void {
  try {
    server.sendToolListChanged();
    logContinuityDiagnostic(
      "tool_surface_refresh_notified",
      {
        logical_session:
          continuityFingerprint(
            logicalSessionKey
          ),
      }
    );
  } catch (error) {
    console.warn(
      "[MCP] tools/list_changed notification failed:",
      error instanceof Error
        ? error.message
        : String(error)
    );
  }
}

function patchSessionHeaders(req: Request, sessionId: string, protocolVersion: string): Request {
  const headers = {
    ...req.headers,
    "mcp-session-id": sessionId,
    "mcp-protocol-version": protocolVersion,
  };
  const omitted = new Set(["mcp-session-id", "mcp-protocol-version"]);
  const raw: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (omitted.has(req.rawHeaders[i]?.toLowerCase())) continue;
    raw.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }
  raw.push("mcp-session-id", sessionId, "mcp-protocol-version", protocolVersion);
  return Object.assign(req, { headers, rawHeaders: raw });
}

async function loopbackPost(
  port: number,
  route: string,
  body: unknown,
  sessionId: string,
  protocolVersion?: string,
  connectorHeaders: Record<string, string> = {}
): Promise<boolean> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-session-id": sessionId,
    ...connectorHeaders,
  };
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return response.ok || response.status === 202;
}

export function createSessionManager(
  port: number,
  options: SessionManagerOptions = {}
): SessionManager {
  const createServer = options.createServer ?? createMcpServer;
  const usesDefaultServerFactory = options.createServer === undefined;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const cleanupMs = options.cleanupMs ?? DEFAULT_CLEANUP_MS;
  const deleteGraceMs = options.deleteGraceMs ?? DEFAULT_DELETE_GRACE_MS;
  const isLogicalSessionPinned =
    options.isLogicalSessionPinned ??
    (() => false);
  const sessions = new Map<string, McpSession>();
  const pending = new Map<string, McpSession>();
  const detached = new Map<string, McpSession>();
  const transportLogical = new Map<string, string>();
  const transportIdentityBound = new Map<string, boolean>();
  const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const opChains = new Map<string, Promise<void>>();
  const recoveryFlights = new Map<string, Promise<McpSession | undefined>>();
  const logicalLastAccess = new Map<string, number>();
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  function clearGrace(id: string): void {
    const timer = graceTimers.get(id);
    if (timer) clearTimeout(timer);
    graceTimers.delete(id);
  }

  function touchTransport(id: string): void {
    clearGrace(id);
    const now = Date.now();
    const session = sessions.get(id) ?? pending.get(id) ?? detached.get(id);
    const logicalKey = session?.logicalSessionKey ?? transportLogical.get(id);
    if (logicalKey) logicalLastAccess.set(logicalKey, now);
    if (session) session.lastAccessedAt = now;
  }

  function logicalHasTransport(logicalKey: string, exceptId?: string): boolean {
    for (const [id, key] of transportLogical) {
      if (id !== exceptId && key === logicalKey) return true;
    }
    return false;
  }

  function finalizeDetached(id: string, reason: string): void {
    const old = detached.get(id);
    if (!old) return;
    detached.delete(id);
    void disposeMcpServerRuntime(old.server, { preserveSessionState: true }).catch(() => undefined);
    void old.transport.close().catch(() => undefined);
    console.log(`[MCP] Detached transport finalized (${reason}): ${id}`);
  }

  function removeTransport(
    id: string,
    reason: string,
    expectedTransport?: StreamableHTTPServerTransport,
    preserveLogicalState = true
  ): void {
    const current = sessions.get(id) ?? pending.get(id) ?? detached.get(id);
    if (expectedTransport && current?.transport !== expectedTransport) return;
    clearGrace(id);
    sessions.delete(id);
    pending.delete(id);
    detached.delete(id);
    opChains.delete(id);
    const logicalKey = current?.logicalSessionKey ?? transportLogical.get(id);
    transportLogical.delete(id);
    transportIdentityBound.delete(id);

    if (current) {
      void disposeMcpServerRuntime(current.server, { preserveSessionState: true }).catch(() => undefined);
      void current.transport.close().catch(() => undefined);
    }

    if (!preserveLogicalState && logicalKey && !logicalHasTransport(logicalKey)) {
      logicalLastAccess.delete(logicalKey);
      void disposeLogicalSessionState(logicalKey).catch(() => undefined);
    }

    console.log(`[MCP] Transport removed (${reason}): ${id}`);
    logContinuityDiagnostic("session_removed", {
      transport_session: continuityFingerprint(id),
      reason,
      preserve_logical_state: preserveLogicalState,
    });
  }

  async function enqueue(id: string, fn: () => Promise<void>): Promise<void> {
    const previous = opChains.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    opChains.set(id, current);
    try {
      await current;
    } finally {
      if (opChains.get(id) === current) opChains.delete(id);
    }
  }

  async function build(
    preferredTransportId?: string,
    preferredLogicalKey?: string,
    connectorIdentityBound = false
  ): Promise<McpSession> {
    const transportId = preferredTransportId ?? randomUUID();
    const logicalSessionKey = preferredLogicalKey ?? transportId;
    const server = createServer(logicalSessionKey);
    if (usesDefaultServerFactory) {
      await rehydrateServerForLogicalSession(server, logicalSessionKey);
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => transportId,
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        const previous = sessions.get(id);
        const detachedPrevious = detached.get(id);
        const replacement: McpSession = {
          server,
          transport,
          logicalSessionKey,
          connectorIdentityBound,
          lastAccessedAt: Date.now(),
        };
        sessions.set(id, replacement);
        pending.delete(id);
        transportLogical.set(id, logicalSessionKey);
        transportIdentityBound.set(id, connectorIdentityBound);
        logicalLastAccess.set(logicalSessionKey, Date.now());
        clearGrace(id);

        if (detachedPrevious && detachedPrevious.transport !== transport) {
          detached.delete(id);
          void disposeMcpServerRuntime(detachedPrevious.server, { preserveSessionState: true }).catch(() => undefined);
        }
        if (previous && previous.transport !== transport) {
          void disposeMcpServerRuntime(previous.server, { preserveSessionState: true }).catch(() => undefined);
          void previous.transport.close().catch(() => undefined);
        }

        console.log(`[MCP] Session initialized: ${id}`);
        logContinuityDiagnostic("session_initialized", {
          transport_session: continuityFingerprint(id),
          logical_session: continuityFingerprint(logicalSessionKey),
          replaced_existing_transport: Boolean(previous),
          recovered_detached_transport: Boolean(detachedPrevious),
        });
      },
      onsessionclosed: (id) => {
        if (!id) return;
        const active = sessions.get(id) ?? pending.get(id);
        if (!active || active.transport !== transport) return;
        sessions.delete(id);
        pending.delete(id);
        opChains.delete(id);
        detached.set(id, active);
        clearGrace(id);

        const timer = setTimeout(() => {
          if (!sessions.has(id)) finalizeDetached(id, "client close grace expired");
          else detached.delete(id);
          graceTimers.delete(id);
        }, deleteGraceMs);
        timer.unref?.();
        graceTimers.set(id, timer);

        console.log(`[MCP] Transport terminated; logical session preserved: ${id}`);
        logContinuityDiagnostic("transport_detached", {
          transport_session: continuityFingerprint(id),
          logical_session: continuityFingerprint(logicalSessionKey),
        });
      },
    });

    transport.onerror = (error) => console.warn("[MCP] transport error:", error.message);
    await server.connect(transport);
    return {
      server,
      transport,
      logicalSessionKey,
      connectorIdentityBound,
      lastAccessedAt: Date.now(),
    };
  }

  async function warmup(
    id: string,
    route: string,
    protocolVersion: string,
    sourceReq: Request
  ): Promise<boolean> {
    const subject = sourceReq.headers["x-openai-subject"];
    const openaiSession = sourceReq.headers["x-openai-session"];
    const connectorHeaders: Record<string, string> = {};
    if (typeof subject === "string") {
      connectorHeaders["x-openai-subject"] = subject;
    } else if (Array.isArray(subject) && subject[0]) {
      connectorHeaders["x-openai-subject"] = subject[0];
    }
    if (typeof openaiSession === "string") {
      connectorHeaders["x-openai-session"] = openaiSession;
    } else if (Array.isArray(openaiSession) && openaiSession[0]) {
      connectorHeaders["x-openai-session"] = openaiSession[0];
    }

    const initialized = await loopbackPost(
      port,
      route,
      {
        jsonrpc: "2.0",
        id: "__cadgpt_recovery__",
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: "cadgpt-session-recovery", version: "0.1.0" },
        },
      },
      id,
      undefined,
      connectorHeaders
    );
    if (!initialized) return false;
    return loopbackPost(
      port,
      route,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      id,
      protocolVersion,
      connectorHeaders
    );
  }

  async function ensureRecovered(
    id: string,
    route: string,
    protocolVersion: string,
    sourceReq: Request
  ): Promise<McpSession | undefined> {
    const already = sessions.get(id);
    if (already) {
      touchTransport(id);
      return already;
    }

    const inFlight = recoveryFlights.get(id);
    if (inFlight) return inFlight;

    let flight!: Promise<McpSession | undefined>;
    flight = (async () => {
      const logicalKey = transportLogical.get(id) ?? detached.get(id)?.logicalSessionKey ?? id;
      const connectorIdentityBound =
        transportIdentityBound.get(id) ??
        detached.get(id)?.connectorIdentityBound ??
        false;
      const replacement = await build(id, logicalKey, connectorIdentityBound);
      pending.set(id, replacement);
      transportLogical.set(id, logicalKey);
      transportIdentityBound.set(id, connectorIdentityBound);
      try {
        if (!(await warmup(id, route, protocolVersion, sourceReq))) {
          removeTransport(id, "recovery warmup failed", replacement.transport, true);
          return undefined;
        }
        const recovered = sessions.get(id);
        if (!recovered || recovered.transport !== replacement.transport) {
          pending.delete(id);
          void disposeMcpServerRuntime(replacement.server, { preserveSessionState: true }).catch(() => undefined);
          void replacement.transport.close().catch(() => undefined);
          return sessions.get(id);
        }
        touchTransport(id);
        console.log(`[MCP] Session recovered: ${id}`);
        logContinuityDiagnostic("session_recovered", {
          transport_session: continuityFingerprint(id),
          logical_session: continuityFingerprint(logicalKey),
        });
        return recovered;
      } catch (error) {
        removeTransport(id, "recovery exception", replacement.transport, true);
        throw error;
      } finally {
        if (recoveryFlights.get(id) === flight) recoveryFlights.delete(id);
      }
    })();
    recoveryFlights.set(id, flight);
    return flight;
  }

  async function ensureColdRecovered(
    id: string,
    logicalKey: string,
    route: string,
    protocolVersion: string,
    sourceReq: Request
  ): Promise<McpSession | undefined> {
    const already = sessions.get(id);
    if (already) {
      return already.logicalSessionKey ===
        logicalKey
        ? already
        : undefined;
    }

    const inFlight =
      recoveryFlights.get(id);
    if (inFlight) {
      const recovered =
        await inFlight;
      return recovered?.logicalSessionKey ===
        logicalKey
        ? recovered
        : undefined;
    }

    let flight!: Promise<
      McpSession | undefined
    >;
    flight = (async () => {
      const replacement =
        await build(
          id,
          logicalKey,
          true
        );
      pending.set(id, replacement);
      transportLogical.set(
        id,
        logicalKey
      );
      transportIdentityBound.set(
        id,
        true
      );

      try {
        if (
          !(await warmup(
            id,
            route,
            protocolVersion,
            sourceReq
          ))
        ) {
          removeTransport(
            id,
            "cold recovery warmup failed",
            replacement.transport,
            true
          );
          return undefined;
        }

        const recovered =
          sessions.get(id);
        if (
          !recovered ||
          recovered.transport !==
            replacement.transport
        ) {
          return undefined;
        }

        touchTransport(id);
        logContinuityDiagnostic(
          "session_cold_recovered",
          {
            transport_session:
              continuityFingerprint(id),
            logical_session:
              continuityFingerprint(
                logicalKey
              ),
          }
        );
        return recovered;
      } catch (error) {
        removeTransport(
          id,
          "cold recovery exception",
          replacement.transport,
          true
        );
        throw error;
      } finally {
        if (
          recoveryFlights.get(id) ===
          flight
        ) {
          recoveryFlights.delete(id);
        }
      }
    })();

    recoveryFlights.set(id, flight);
    return flight;
  }

  function matchesTransportIdentity(id: string, req: Request): boolean {
    if (transportIdentityBound.get(id) !== true) return true;
    const expectedLogicalKey =
      transportLogical.get(id) ??
      sessions.get(id)?.logicalSessionKey ??
      pending.get(id)?.logicalSessionKey ??
      detached.get(id)?.logicalSessionKey;
    const requestLogicalKey = logicalConversationKeyFromRequest(req);
    return Boolean(
      expectedLogicalKey &&
      requestLogicalKey &&
      requestLogicalKey === expectedLogicalKey
    );
  }

  async function expireLogical(logicalKey: string): Promise<void> {
    const ids = [...transportLogical.entries()]
      .filter(([, key]) => key === logicalKey)
      .map(([id]) => id);
    for (const id of ids) removeTransport(id, "logical TTL expired", undefined, true);
    logicalLastAccess.delete(logicalKey);
    await disposeLogicalSessionState(logicalKey).catch(() => undefined);
    console.log("[MCP] Logical session expired");
  }

  return {
    get(id) {
      return sessions.get(id);
    },

    count() {
      return sessions.size;
    },

    sendNotFound(res, requestId = null) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "MCP session not found; reconnect CadGPT and retry." },
        id: requestId,
      });
    },

    sendBadRequest(res, message, requestId = null) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: requestId });
    },

    async createNew(req, res, body) {
      logContinuityRequest(req, "session_manager_create_new");
      const headerId = req.headers["mcp-session-id"] as string | undefined;
      const connectorLogicalKey = logicalConversationKeyFromRequest(req);
      const existingPending = headerId ? pending.get(headerId) : undefined;
      const session =
        existingPending ??
        (await build(
          headerId || undefined,
          connectorLogicalKey || undefined,
          connectorLogicalKey !== null
        ));
      const transportId = headerId || session.transport.sessionId;
      if (headerId) pending.delete(headerId);
      if (transportId) {
        transportLogical.set(transportId, session.logicalSessionKey);
        transportIdentityBound.set(
          transportId,
          session.connectorIdentityBound
        );
      }

      const run = async () => {
        await session.transport.handleRequest(req, res, body);
        if (isInitializedNotification(body)) {
          refreshClientToolSurface(
            session.server,
            session.logicalSessionKey
          );
        }
        const active = session.transport.sessionId;
        if (active) touchTransport(active);
      };
      if (transportId) await enqueue(transportId, run);
      else await run();
    },

    async handleExisting(session, req, res, body) {
      logContinuityRequest(req, "session_manager_handle_existing");
      const existingId =
        session.transport.sessionId ||
        (req.headers["mcp-session-id"] as string | undefined);
      if (
        session.connectorIdentityBound &&
        (!existingId || !matchesTransportIdentity(existingId, req))
      ) {
        const requestLogicalKey = logicalConversationKeyFromRequest(req);
          logContinuityRequest(req, "session_manager_identity_rejected", {
            expected_logical_session: continuityFingerprint(session.logicalSessionKey),
            presented_logical_session: continuityFingerprint(requestLogicalKey ?? undefined),
          });
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "CadGPT connector conversation identity is missing or does not match this MCP transport.",
            },
            id: extractRequestId(body),
          });
        return;
      }
      const id = existingId;
      if (id) touchTransport(id);
      const run = async () => {
        await session.transport.handleRequest(
          req,
          res,
          body
        );
        if (isInitializedNotification(body)) {
          refreshClientToolSurface(
            session.server,
            session.logicalSessionKey
          );
        }
      };
      if (id && req.method !== "GET") await enqueue(id, run);
      else await run();
    },

    matchesTransportIdentity(id, req) {
      return matchesTransportIdentity(id, req);
    },

    async tryRecover(id, req, res, body) {
      logContinuityRequest(req, "session_manager_try_recover", {
        recovery_target: continuityFingerprint(id),
      });
      if (isInitializeRequest(body)) return false;

      const protocol = negotiateProtocol(
        req.headers["mcp-protocol-version"] as
          | string
          | undefined
      );
      const route = req.path || "/mcp";
      const known =
        transportLogical.has(id) ||
        sessions.has(id) ||
        pending.has(id) ||
        detached.has(id);

      let recovered: McpSession | undefined;
      if (known) {
        recovered =
          await ensureRecovered(
            id,
            route,
            protocol,
            req
          );
      } else {
        const logicalKey =
          logicalConversationKeyFromRequest(req);
        if (!logicalKey) {
          logContinuityRequest(
            req,
            "session_manager_cold_recovery_identity_missing",
            {
              recovery_target:
                continuityFingerprint(id),
            }
          );
          return false;
        }

        recovered =
          await ensureColdRecovered(
            id,
            logicalKey,
            route,
            protocol,
            req
          );
      }

      if (!recovered) return false;
      const patched = patchSessionHeaders(
        req,
        id,
        protocol
      );
      await enqueue(id, async () =>
        recovered!.transport.handleRequest(
          patched,
          res,
          body
        )
      );
      touchTransport(id);
      return true;
    },

    async recoverLogical(logicalKey, req, res, body) {
      logContinuityRequest(req, "session_manager_recover_logical", {
        recovery_target: continuityFingerprint(logicalKey),
      });
      if (isInitializeRequest(body)) return false;

      const requestLogicalKey = logicalConversationKeyFromRequest(req);
      if (!requestLogicalKey || requestLogicalKey !== logicalKey) {
        logContinuityRequest(req, "session_manager_logical_identity_rejected", {
          expected_logical_session: continuityFingerprint(logicalKey),
          presented_logical_session: continuityFingerprint(requestLogicalKey ?? undefined),
        });
        return false;
      }

      const candidates = [...transportLogical.entries()]
        .filter(
          ([id, key]) =>
            key === logicalKey &&
            transportIdentityBound.get(id) === true
        )
        .map(([id]) => {
          const session =
            sessions.get(id) ?? pending.get(id) ?? detached.get(id);
          const rank = sessions.has(id)
            ? 3
            : pending.has(id)
              ? 2
              : detached.has(id)
                ? 1
                : 0;
          return {
            id,
            rank,
            lastAccessedAt: session?.lastAccessedAt ?? 0,
          };
        })
        .sort(
          (left, right) =>
            right.rank - left.rank ||
            right.lastAccessedAt - left.lastAccessedAt
        );

      const protocol = negotiateProtocol(
        req.headers["mcp-protocol-version"] as string | undefined
      );
      const route = req.path || "/mcp";

      for (const candidate of candidates) {
        const recovered = await ensureRecovered(
          candidate.id,
          route,
          protocol,
          req
        );
        if (!recovered) continue;
        const patched = patchSessionHeaders(
          req,
          candidate.id,
          protocol
        );
        await enqueue(candidate.id, async () =>
          recovered.transport.handleRequest(patched, res, body)
        );
        touchTransport(candidate.id);
        return true;
      }

      return false;
    },

    startCleanup() {
      if (cleanupTimer) return;
      cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [logicalKey, lastAccessedAt] of logicalLastAccess) {
          if (
            isLogicalSessionPinned(
              logicalKey
            )
          ) {
            continue;
          }
          if (now - lastAccessedAt <= sessionTtlMs) continue;
          void expireLogical(logicalKey);
        }
      }, cleanupMs);
      cleanupTimer.unref?.();
    },

    stopCleanup() {
      if (cleanupTimer) clearInterval(cleanupTimer);
      cleanupTimer = null;
      for (const id of [...graceTimers.keys()]) clearGrace(id);
    },

    async closeAll(reason = "shutdown") {
      if (cleanupTimer) clearInterval(cleanupTimer);
      cleanupTimer = null;
      for (const id of [...graceTimers.keys()]) clearGrace(id);

      const all = new Map<string, McpSession>();
      for (const [id, session] of sessions) all.set(`session:${id}`, session);
      for (const [id, session] of pending) all.set(`pending:${id}`, session);
      for (const [id, session] of detached) all.set(`detached:${id}`, session);
      const logicalIds = [...new Set([...logicalLastAccess.keys(), ...transportLogical.values()])];

      sessions.clear();
      pending.clear();
      detached.clear();
      transportLogical.clear();
      transportIdentityBound.clear();
      opChains.clear();
      recoveryFlights.clear();
      logicalLastAccess.clear();

      await Promise.all(
        [...all.values()].map(async (session) => {
          await disposeMcpServerRuntime(session.server, { preserveSessionState: true }).catch((error) => {
            console.error("[MCP] Session runtime cleanup failed during shutdown", error);
          });
          await session.transport.close().catch(() => undefined);
        })
      );
      await Promise.all(
        logicalIds.map((id) =>
          disposeLogicalSessionState(id).catch((error) => {
            console.error("[MCP] Logical session cleanup failed during shutdown", error);
          })
        )
      );
      console.log(`[MCP] Closed all sessions (${reason}): ${all.size}`);
    },
  };
}
