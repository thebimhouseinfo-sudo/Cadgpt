#!/usr/bin/env node

import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  createSessionManager,
  extractRequestId,
} from "./cadgpt/lib/mcp-session-manager.js";
import {
  getAllowedRoots,
  toRepoRelative,
} from "./cadgpt/lib/path-security.js";
import { runtimeStateSnapshot } from "./cadgpt/lib/runtime-state.js";
import { buildLegacyDiscoverFallback } from "./cadgpt/lib/mcp-discover-compat.js";
import { activeToolLeaseCount, activeWorkCount, sweepExpiredWork } from "./cadgpt/lib/work-registration.js";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const MCP_TOKEN = (process.env.MCP_TOKEN || "").trim();
if (!MCP_TOKEN) {
  throw new Error(
    "MCP_TOKEN is required. Run setup.bat / openai-tunnel.ps1 -Init before starting CadGPT."
  );
}
const SESSION_RECOVERY =
  (process.env.MCP_SESSION_RECOVERY || "true").toLowerCase() !== "false";
const STARTED_AT = Date.now();
const WORK_SWEEP_MS = Math.max(10_000, Number(process.env.CADGPT_WORK_SWEEP_MS || 30_000));

let activeMcpRequests = 0;
let lastMcpActivityAt = Date.now();
let shuttingDown = false;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "20mb" }));

const mcpPaths = [`/mcp/${MCP_TOKEN}`];
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

app.get("/health", async (_req, res) => {
  const runtime = runtimeStateSnapshot();
  let cadMcp: Record<string, unknown> = {
    enabled: false,
    connected: false,
    tool_count: 0,
    pid: null,
    state: "not_loaded",
  };
  if (runtime.loaded_families.includes("cad")) {
    try {
      const { cadUpstream } = await import("./cadgpt/runtime/cad-upstream.js");
      cadMcp = cadUpstream.status() as unknown as Record<string, unknown>;
    } catch (error) {
      cadMcp = {
        enabled: false,
        connected: false,
        state: "load_error",
        last_error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  res.json({
    status: "ok",
    name: "cadgpt",
    version: "0.2.0",
    mode: "slim-control-plane",
    pid: process.pid,
    uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    file_roots: getAllowedRoots().map(toRepoRelative),
    active_mcp_sessions: sessions.count(),
    active_mcp_requests: activeMcpRequests,
    active_work_registrations: activeWorkCount(),
    active_tool_leases: activeToolLeaseCount(),
    memory: {
      rss_bytes: process.memoryUsage().rss,
      heap_used_bytes: process.memoryUsage().heapUsed,
      heap_total_bytes: process.memoryUsage().heapTotal,
    },
    last_mcp_activity_at: new Date(lastMcpActivityAt).toISOString(),
    session_recovery: SESSION_RECOVERY,
    mcp_path_protected: true,
    mcp_paths: mcpPaths,
    ...runtime,
    cad_mcp: cadMcp,
  });
});

app.all("/mcp", (_req, res) =>
  res.status(404).json({ ok: false, error: "Not found" })
);

async function handlePost(
  req: express.Request,
  res: express.Response
): Promise<void> {
  try {
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

    if (sessionId && SESSION_RECOVERY) {
      if (await sessions.tryRecover(sessionId, req, res, req.body)) return;
    }

    if (!sessionId && SESSION_RECOVERY) {
      const recoveryId = randomUUID();
      if (await sessions.tryRecover(recoveryId, req, res, req.body)) return;
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
  });
}

app.use((req, res, next) => {
  if (mcpPathSet.has(req.path)) return next();
  res.status(404).json({ ok: false, error: "Not found" });
});

const workSweepTimer = setInterval(() => {
  sweepExpiredWork();
}, WORK_SWEEP_MS);
workSweepTimer.unref?.();

const server = app.listen(PORT, HOST, () => {
  console.log("");
  console.log("=== CadGPT Slim Control Plane ===");
  console.log(`Local MCP:  http://${HOST}:${PORT}${mcpPaths[0]}`);
  console.log(`Health:     http://${HOST}:${PORT}/health`);
  console.log(
    "Admission:  launch once per ChatGPT/MCP session via @cadgpt or CadGPT plugin/icon; later turns continue in-session"
  );
  console.log("FILE/CAD:   lazy-loaded only after admitted work registration");
  console.log("CAD MCP:    activated only on actual CAD tool demand");
  console.log("");
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[CadGPT] ${signal}: shutting down slim control plane`);
  sessions.stopCleanup();
  clearInterval(workSweepTimer);

  await sessions.closeAll(signal).catch((error) => {
    console.error("[CadGPT] Session cleanup failed during shutdown", error);
  });

  if (runtimeStateSnapshot().loaded_families.includes("cad")) {
    try {
      const { cadUpstream } = await import("./cadgpt/runtime/cad-upstream.js");
      await cadUpstream.deactivate();
    } catch {
      // Shutdown remains best-effort.
    }
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
