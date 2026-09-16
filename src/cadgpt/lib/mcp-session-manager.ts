import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../server-factory.js";

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
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  function touch(id: string): void {
    const session = sessions.get(id);
    if (session) session.lastAccessedAt = Date.now();
  }

  function remove(id: string, reason: string): void {
    const timer = graceTimers.get(id);
    if (timer) clearTimeout(timer);
    graceTimers.delete(id);
    sessions.delete(id);
    pending.delete(id);
    opChains.delete(id);
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
        sessions.set(id, {
          server,
          transport,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
        });
        pending.delete(id);
        console.log(`[MCP] Session initialized: ${id}`);
      },
      onsessionclosed: (id) => {
        if (!id) return;
        const old = graceTimers.get(id);
        if (old) clearTimeout(old);
        const timer = setTimeout(() => remove(id, "client close grace expired"), DELETE_GRACE_MS);
        timer.unref?.();
        graceTimers.set(id, timer);
      },
    });
    transport.onerror = (error) => console.warn("[MCP] transport error:", error.message);
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id && sessions.has(id)) console.log(`[MCP] Transport closed; preserving session for recovery: ${id}`);
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
      const replacement = await build(id);
      pending.set(id, replacement);
      if (!(await warmup(id, route, protocol))) {
        remove(id, "recovery warmup failed");
        return false;
      }
      const recovered = sessions.get(id);
      if (!recovered) return false;
      const patched = patchSessionHeaders(req, id, protocol);
      await enqueue(id, async () => recovered.transport.handleRequest(patched, res, body));
      touch(id);
      console.log(`[MCP] Session recovered: ${id}`);
      return true;
    },

    startCleanup() {
      if (cleanupTimer) return;
      cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [id, session] of sessions) {
          if (now - session.lastAccessedAt > SESSION_TTL_MS) remove(id, "TTL expired");
        }
      }, CLEANUP_MS);
      cleanupTimer.unref?.();
    },

    stopCleanup() {
      if (cleanupTimer) clearInterval(cleanupTimer);
      cleanupTimer = null;
    },
  };
}
