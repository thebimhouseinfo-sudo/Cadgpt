import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer, disposeMcpServerRuntime } from "../server-factory.js";

const SESSION_TTL_MS = Number(process.env.MCP_SESSION_TTL_MS || 86_400_000);
const CLEANUP_MS = Number(process.env.MCP_SESSION_CLEANUP_MS || 300_000);
const DELETE_GRACE_MS = Number(process.env.MCP_SESSION_DELETE_GRACE_MS || 45_000);

export interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
  lastAccessedAt: number;
}

export interface SessionManager {
  get(id: string): McpSession | undefined;
  count(): number;
  createNew(req: Request, res: Response, body: unknown): Promise<void>;
  handleExisting(session: McpSession, req: Request, res: Response, body?: unknown): Promise<void>;
  tryRecover(id: string, req: Request, res: Response, body: unknown): Promise<boolean>;
  sendNotFound(res: Response, requestId?: string | number | null): void;
  sendBadRequest(res: Response, message: string, requestId?: string | number | null): void;
  startCleanup(): void;
  stopCleanup(): void;
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
  protocolVersion?: string
): Promise<boolean> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-session-id": sessionId,
  };
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return response.ok || response.status === 202;
}

export function createSessionManager(port: number): SessionManager {
  const sessions = new Map<string, McpSession>();
  const pending = new Map<string, McpSession>();
  const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const opChains = new Map<string, Promise<void>>();
  const recoveryFlights = new Map<string, Promise<McpSession | undefined>>();
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  function clearGrace(id: string): void {
    const timer = graceTimers.get(id);
    if (timer) clearTimeout(timer);
    graceTimers.delete(id);
  }

  function touch(id: string): void {
    // Same behavior as the proven GPTWorker connector: activity during the
    // DELETE grace window means the client is still using/recovering the ID.
    clearGrace(id);
    const session = sessions.get(id);
    if (session) session.lastAccessedAt = Date.now();
  }

  function remove(
    id: string,
    reason: string,
    expectedTransport?: StreamableHTTPServerTransport
  ): void {
    const current = sessions.get(id) ?? pending.get(id);
    if (expectedTransport && current?.transport !== expectedTransport) return;
    clearGrace(id);
    sessions.delete(id);
    pending.delete(id);
    opChains.delete(id);
    if (current) {
      void disposeMcpServerRuntime(current.server).catch(() => undefined);
      void current.transport.close().catch(() => undefined);
    }
    console.log(`[MCP] Session removed (${reason}): ${id}`);
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

  async function build(preferredId?: string): Promise<McpSession> {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: preferredId ? () => preferredId : () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        const previous = sessions.get(id);
        const replacement: McpSession = {
          server,
          transport,
          createdAt: previous?.createdAt ?? Date.now(),
          lastAccessedAt: Date.now(),
        };
        sessions.set(id, replacement);
        pending.delete(id);
        clearGrace(id);
        if (previous && previous.transport !== transport) {
          void disposeMcpServerRuntime(previous.server).catch(() => undefined);
          void previous.transport.close().catch(() => undefined);
        }
        console.log(`[MCP] Session initialized: ${id}`);
      },
      onsessionclosed: (id) => {
        if (!id) return;
        // Ignore close callbacks from a stale transport after a replacement with
        // the same session ID has already become current.
        const active = sessions.get(id) ?? pending.get(id);
        if (!active || active.transport !== transport) return;
        clearGrace(id);
        const timer = setTimeout(() => {
          const current = sessions.get(id) ?? pending.get(id);
          if (current?.transport === transport) {
            remove(id, "client close grace expired", transport);
          }
        }, DELETE_GRACE_MS);
        timer.unref?.();
        graceTimers.set(id, timer);
      },
    });
    transport.onerror = (error) => console.warn("[MCP] transport error:", error.message);
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id && sessions.get(id)?.transport === transport) {
        console.log(`[MCP] Transport closed; preserving session for grace/recovery: ${id}`);
      }
    };
    await server.connect(transport);
    return {
      server,
      transport,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
  }

  async function warmup(id: string, route: string, protocolVersion: string): Promise<boolean> {
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
      id
    );
    if (!initialized) return false;
    return loopbackPost(
      port,
      route,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      id,
      protocolVersion
    );
  }

  async function ensureRecovered(
    id: string,
    route: string,
    protocolVersion: string
  ): Promise<McpSession | undefined> {
    const already = sessions.get(id);
    if (already) {
      touch(id);
      return already;
    }

    const inFlight = recoveryFlights.get(id);
    if (inFlight) return inFlight;

    let flight!: Promise<McpSession | undefined>;
    flight = (async () => {
      const replacement = await build(id);
      pending.set(id, replacement);
      try {
        if (!(await warmup(id, route, protocolVersion))) {
          remove(id, "recovery warmup failed", replacement.transport);
          return undefined;
        }
        const recovered = sessions.get(id);
        if (!recovered || recovered.transport !== replacement.transport) {
          // Do not delete a different session that may have won a race.
          pending.delete(id);
          void disposeMcpServerRuntime(replacement.server).catch(() => undefined);
          void replacement.transport.close().catch(() => undefined);
          return sessions.get(id);
        }
        touch(id);
        console.log(`[MCP] Session recovered: ${id}`);
        return recovered;
      } catch (error) {
        remove(id, "recovery exception", replacement.transport);
        throw error;
      } finally {
        if (recoveryFlights.get(id) === flight) recoveryFlights.delete(id);
      }
    })();
    recoveryFlights.set(id, flight);
    return flight;
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
      const headerId = req.headers["mcp-session-id"] as string | undefined;
      const session = (headerId && pending.get(headerId)) || (await build());
      if (headerId) pending.delete(headerId);
      const id = headerId || session.transport.sessionId;
      const run = async () => {
        await session.transport.handleRequest(req, res, body);
        const active = session.transport.sessionId;
        if (active) touch(active);
      };
      if (id) await enqueue(id, run);
      else await run();
    },

    async handleExisting(session, req, res, body) {
      const id = session.transport.sessionId || (req.headers["mcp-session-id"] as string | undefined);
      if (id) touch(id);
      const run = async () => session.transport.handleRequest(req, res, body);
      // A long-lived GET stream must not block POST tool calls for the session.
      if (id && req.method !== "GET") await enqueue(id, run);
      else await run();
    },

    async tryRecover(id, req, res, body) {
      if (isInitializeRequest(body)) return false;
      const protocol = negotiateProtocol(req.headers["mcp-protocol-version"] as string | undefined);
      const route = req.path || "/mcp";
      const recovered = await ensureRecovered(id, route, protocol);
      if (!recovered) return false;
      const patched = patchSessionHeaders(req, id, protocol);
      await enqueue(id, async () => recovered.transport.handleRequest(patched, res, body));
      touch(id);
      return true;
    },

    startCleanup() {
      if (cleanupTimer) return;
      cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [id, session] of sessions) {
          if (now - session.lastAccessedAt > SESSION_TTL_MS) {
            remove(id, "TTL expired", session.transport);
          }
        }
      }, CLEANUP_MS);
      cleanupTimer.unref?.();
    },

    stopCleanup() {
      if (cleanupTimer) clearInterval(cleanupTimer);
      cleanupTimer = null;
      for (const id of [...graceTimers.keys()]) clearGrace(id);
    },
  };
}
