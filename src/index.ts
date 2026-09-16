#!/usr/bin/env node

import "dotenv/config";
import { randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  createSessionManager,
  extractRequestId,
} from "./cadgpt/lib/mcp-session-manager.js";
import { getAllowedRoots, toRepoRelative } from "./cadgpt/lib/path-security.js";
import { cadUpstream } from "./cadgpt/runtime/cad-upstream.js";
import { activateCadRuntime, deactivateCadRuntime } from "./cadgpt/tools/cad-proxy.js";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const MCP_TOKEN = (process.env.MCP_TOKEN || "").trim();
const CONTROL_TOKEN = (process.env.CADGPT_CONTROL_TOKEN || "").trim();
const SESSION_RECOVERY = (process.env.MCP_SESSION_RECOVERY || "true").toLowerCase() !== "false";
const CORE_IDLE_MS = Math.max(10_000, Number(process.env.CADGPT_SESSION_IDLE_MS || 120_000));
const STARTED_AT = Date.now();

let lastMcpActivityAt = Date.now();
let activeMcpRequests = 0;
let shuttingDown = false;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "20mb" }));

const mcpPaths = MCP_TOKEN ? [`/mcp/${MCP_TOKEN}`] : ["/mcp"];
const mcpPathSet = new Set(mcpPaths);
const sessions = createSessionManager(PORT);
sessions.startCleanup();

function markMcpActivity(): void {
  lastMcpActivityAt = Date.now();
}

function trackMcpOperation(res: express.Response): void {
  markMcpActivity();
  activeMcpRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeMcpRequests = Math.max(0, activeMcpRequests - 1);
    markMcpActivity();
  };
  res.once("finish", release);
  res.once("close", release);
}

function validControlToken(value: string | undefined): boolean {
  if (!CONTROL_TOKEN || !value) return false;
  const a = Buffer.from(CONTROL_TOKEN);
  const b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireInternalControl(req: express.Request, res: express.Response): boolean {
  const supplied = req.header("x-cadgpt-control-token");
  if (validControlToken(supplied)) return true;
  res.status(404).json({ ok: false, error: "Not found" });
  return false;
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    name: "cadgpt",
    version: "0.1.0",
    pid: process.pid,
    uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    file_roots: getAllowedRoots().map(toRepoRelative),
    active_mcp_sessions: sessions.count(),
    active_mcp_requests: activeMcpRequests,
    last_mcp_activity_at: new Date(lastMcpActivityAt).toISOString(),
    session_idle_ms: CORE_IDLE_MS,
    session_recovery: SESSION_RECOVERY,
    mcp_path_protected: Boolean(MCP_TOKEN),
    mcp_paths: mcpPaths,
    cad_mcp: cadUpstream.status(),
  });
});

app.post("/internal/cad/activate", async (req, res) => {
  if (!requireInternalControl(req, res)) return;
  try {
    const result = await activateCadRuntime();
    res.json({ ok: true, cad_mcp: cadUpstream.status(), ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(503).json({ ok: false, error: message, cad_mcp: cadUpstream.status() });
  }
});

app.post("/internal/cad/deactivate", async (req, res) => {
  if (!requireInternalControl(req, res)) return;
  try {
    await deactivateCadRuntime();
    res.json({ ok: true, cad_mcp: cadUpstream.status() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, error: message, cad_mcp: cadUpstream.status() });
  }
});

if (MCP_TOKEN) {
  app.all("/mcp", (_req, res) => res.status(404).json({ ok: false, error: "Not found" }));
}

async function handlePost(req: express.Request, res: express.Response): Promise<void> {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (existing) {
      await sessions.handleExisting(existing, req, res, req.body);
      return;
    }

    if (isInitializeRequest(req.body)) {
      await sessions.createNew(req, res, req.body);
      return;
    }

    if (sessionId && SESSION_RECOVERY) {
      if (await sessions.tryRecover(sessionId, req, res, req.body)) return;
    }

    if (!sessionId && SESSION_RECOVERY) {
      const recoveryId = randomUUID();
      if (await sessions.tryRecover(recoveryId, req, res, req.body)) return;
    }

    if (sessionId) sessions.sendNotFound(res, extractRequestId(req.body));
    else sessions.sendBadRequest(res, "Mcp-Session-Id is required", extractRequestId(req.body));
  } catch (error) {
    console.error("[MCP] POST failed", error);
    if (!res.headersSent) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message },
        id: extractRequestId(req.body),
      });
    }
  }
}

for (const route of mcpPaths) {
  app.post(route, (req, res) => {
    trackMcpOperation(res);
    void handlePost(req, res);
  });

  app.get(route, async (req, res) => {
    // A long-lived SSE/GET stream proves connectivity, not active user work.
    // Touch activity when it is opened, but do not let it hold the core awake forever.
    markMcpActivity();
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      sessions.sendNotFound(res);
      return;
    }
    await sessions.handleExisting(session, req, res);
  });

  app.delete(route, async (req, res) => {
    trackMcpOperation(res);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      sessions.sendNotFound(res);
      return;
    }
    await sessions.handleExisting(session, req, res);
    // When ChatGPT explicitly terminates an MCP session, return to lazy mode
    // promptly. If another request is already active, that request wins and the
    // normal inactivity lease remains the fallback.
    setTimeout(() => {
      if (!shuttingDown && activeMcpRequests === 0) void shutdown("MCP_DELETE");
    }, 250).unref();
  });
}

app.use((req, res, next) => {
  if (mcpPathSet.has(req.path)) return next();
  res.status(404).json({ ok: false, error: "Not found" });
});

const server = app.listen(PORT, HOST, () => {
  console.log("");
  console.log("=== CadGPT Core ===");
  console.log(`Local MCP:  http://${HOST}:${PORT}${mcpPaths[0]}`);
  console.log(`Health:     http://${HOST}:${PORT}/health`);
  console.log(`File roots: ${getAllowedRoots().map(toRepoRelative).join(", ")}`);
  console.log(`MCP path:   ${MCP_TOKEN ? "protected" : "unprotected"}`);
  console.log(`Sleep:      after ${CORE_IDLE_MS}ms MCP inactivity; explicit MCP DELETE sleeps promptly`);
  console.log("CAD MCP:    active only while ChatGPT has awakened CadGPT and AutoCAD is running");
  console.log("");
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[CadGPT] ${signal}: shutting down`);
  sessions.stopCleanup();
  await cadUpstream.deactivate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

const idleTimer = setInterval(() => {
  if (shuttingDown || activeMcpRequests > 0) return;
  if (Date.now() - lastMcpActivityAt >= CORE_IDLE_MS) {
    void shutdown("MCP_IDLE");
  }
}, Math.min(5_000, Math.max(1_000, Math.floor(CORE_IDLE_MS / 4))));
idleTimer.unref?.();

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
