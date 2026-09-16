#!/usr/bin/env node

import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  createSessionManager,
  extractRequestId,
} from "./cadgpt/lib/mcp-session-manager.js";
import { getAllowedRoots, toRepoRelative } from "./cadgpt/lib/path-security.js";
import { cadUpstream } from "./cadgpt/runtime/cad-upstream.js";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const MCP_TOKEN = (process.env.MCP_TOKEN || "").trim();
const SESSION_RECOVERY = (process.env.MCP_SESSION_RECOVERY || "true").toLowerCase() !== "false";
const STARTED_AT = Date.now();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "20mb" }));

const mcpPaths = MCP_TOKEN ? [`/mcp/${MCP_TOKEN}`] : ["/mcp"];
const mcpPathSet = new Set(mcpPaths);
const sessions = createSessionManager(PORT);
sessions.startCleanup();

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    name: "cadgpt",
    version: "0.1.0",
    pid: process.pid,
    uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    file_roots: getAllowedRoots().map(toRepoRelative),
    active_mcp_sessions: sessions.count(),
    session_recovery: SESSION_RECOVERY,
    mcp_path_protected: Boolean(MCP_TOKEN),
    mcp_paths: mcpPaths,
    cad_mcp: cadUpstream.status(),
  });
});

if (MCP_TOKEN) {
  // Do not answer 401 here: an MCP client may interpret it as an OAuth challenge.
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

    // ChatGPT may probe with server/discover or another request before a v1-style
    // session exists. Adopt a temporary session rather than leaving the connector
    // retrying indefinitely.
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
  app.post(route, (req, res) => void handlePost(req, res));

  app.get(route, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      sessions.sendNotFound(res);
      return;
    }
    await sessions.handleExisting(session, req, res);
  });

  app.delete(route, async (req, res) => {
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

const server = app.listen(PORT, HOST, () => {
  console.log("");
  console.log("=== CadGPT ===");
  console.log(`Local MCP:  http://${HOST}:${PORT}${mcpPaths[0]}`);
  console.log(`Health:     http://${HOST}:${PORT}/health`);
  console.log(`File roots: ${getAllowedRoots().map(toRepoRelative).join(", ")}`);
  console.log(`MCP path:   ${MCP_TOKEN ? "protected" : "unprotected"}`);
  console.log("CAD MCP:    lazy upstream; connects when a CadGPT MCP session loads CAD tools");
  console.log("");
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[CadGPT] ${signal}: shutting down`);
  sessions.stopCleanup();
  await cadUpstream.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
