#!/usr/bin/env node

import "dotenv/config";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const CORE_PORT = Number(process.env.CADGPT_INTERNAL_PORT || PORT + 1);
const HEALTH_PORT = Number(process.env.OPENAI_TUNNEL_HEALTH_PORT || 8080);
const MCP_TOKEN = (process.env.MCP_TOKEN || "").trim();
const MCP_PATH = MCP_TOKEN ? `/mcp/${MCP_TOKEN}` : "/mcp";
const POLL_MS = Math.max(1000, Number(process.env.CADGPT_WAKE_POLL_MS || 2500));
const STARTED_AT = Date.now();

const runtimeDir = path.join(ROOT, ".runtime");
const logFile = path.join(runtimeDir, "wake-agent.log");
const stateFile = path.join(runtimeDir, "wake-state.json");
fs.mkdirSync(runtimeDir, { recursive: true });

let coreChild: ChildProcess | null = null;
let tunnelChild: ChildProcess | null = null;
let coreStarting: Promise<void> | null = null;
let tunnelStarting: Promise<void> | null = null;
let lastAutoCadRunning = false;

function log(message: string, level = "INFO"): void {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  fs.appendFileSync(logFile, `${line}\n`, "utf8");
  console.log(line);
}

function requestJson(port: number, route = "/health", timeoutMs = 1000): Promise<any | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: route, timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if ((res.statusCode ?? 500) >= 400) return resolve(null);
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

function tunnelReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: HEALTH_PORT, path: "/readyz", timeout: 1000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve(res.statusCode === 200 && /ready/i.test(body)));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

async function coreHealth(): Promise<any | null> {
  const health = await requestJson(CORE_PORT);
  return health?.status === "ok" && health?.name === "cadgpt" ? health : null;
}

function detectAutoCad(): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/FI", "IMAGENAME eq acad.exe", "/NH"],
      { windowsHide: true, timeout: 2500 },
      (error, stdout) => resolve(!error && /acad\.exe/i.test(stdout || ""))
    );
  });
}

async function ensureCore(reason: "chatgpt" | "autocad"): Promise<void> {
  if (await coreHealth()) return;
  if (coreStarting) return coreStarting;

  coreStarting = (async () => {
    const entry = path.join(ROOT, "dist", "index.js");
    if (!fs.existsSync(entry)) throw new Error("dist/index.js is missing; run setup.bat");

    log(`Waking full CadGPT MCP because ${reason} was detected.`);
    coreChild = spawn(process.execPath, [entry], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        ...process.env,
        HOST,
        PORT: String(CORE_PORT),
        CADGPT_WOKEN_BY: reason,
        ...(reason === "autocad" ? { CADGPT_START_CAD_MCP: "1" } : {}),
      },
    });
    coreChild.once("exit", (code, signal) => {
      log(`Full CadGPT MCP exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`, "WARN");
      coreChild = null;
    });

    for (let i = 0; i < 60; i += 1) {
      if (await coreHealth()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Full CadGPT MCP did not become ready after wake request");
  })();

  try {
    await coreStarting;
  } finally {
    coreStarting = null;
  }
}

async function ensureTunnel(): Promise<void> {
  if (await tunnelReady()) return;
  if (tunnelStarting) return tunnelStarting;

  tunnelStarting = (async () => {
    const exe = path.join(ROOT, "bin", "tunnel-client.exe");
    const profile = path.join(ROOT, "profiles", "cadgpt.yaml");
    const tunnelId = (process.env.OPENAI_TUNNEL_ID || "").trim();
    const apiKey = (process.env.OPENAI_TUNNEL_API_KEY || "").trim();
    if (!fs.existsSync(exe) || !fs.existsSync(profile) || !tunnelId || !apiKey) {
      return;
    }

    log("Starting OpenAI Secure MCP Tunnel.");
    tunnelChild = spawn(exe, ["run", "--profile-file", profile], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        ...process.env,
        OPENAI_TUNNEL_API_KEY: apiKey,
        CONTROL_PLANE_API_KEY: apiKey,
        CONTROL_PLANE_TUNNEL_ID: tunnelId,
      },
    });
    tunnelChild.once("exit", (code, signal) => {
      log(`Secure MCP Tunnel exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`, "WARN");
      tunnelChild = null;
    });
  })();

  try {
    await tunnelStarting;
  } finally {
    tunnelStarting = null;
  }
}

async function proxyToCore(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ensureCore("chatgpt");

  const headers = { ...req.headers, host: `${HOST}:${CORE_PORT}` };
  const upstream = http.request(
    {
      host: HOST,
      port: CORE_PORT,
      path: req.url,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: `CadGPT core proxy failed: ${error.message}` }));
    } else {
      res.destroy(error);
    }
  });
  req.pipe(upstream);
}

async function writeState(): Promise<void> {
  const core = await coreHealth();
  const state = {
    timestamp: new Date().toISOString(),
    wake_pid: process.pid,
    mode: core ? "active" : "lazy",
    external_port: PORT,
    core_port: CORE_PORT,
    tunnel_ready: await tunnelReady(),
    autocad_running: lastAutoCadRunning,
    core_pid: core?.pid ?? coreChild?.pid ?? null,
    tunnel_pid: tunnelChild?.pid ?? null,
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
}

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    if (url.pathname === "/health") {
      const core = await coreHealth();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          name: "cadgpt",
          mode: core ? "active" : "lazy",
          pid: process.pid,
          uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
          wake_agent: true,
          external_port: PORT,
          core_port: CORE_PORT,
          autocad_running: lastAutoCadRunning,
          tunnel_ready: await tunnelReady(),
          core: core ? { running: true, pid: core.pid } : { running: false, pid: null },
          cad_mcp: core?.cad_mcp ?? { connected: false, tool_count: 0, pid: null, last_error: null },
        })
      );
      return;
    }

    if (url.pathname !== MCP_PATH) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
      return;
    }

    try {
      await proxyToCore(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Wake/proxy failed: ${message}`, "ERROR");
      if (!res.headersSent) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: message }));
      }
    }
  })();
});

server.listen(PORT, HOST, () => {
  log(`CadGPT wake-agent listening on http://${HOST}:${PORT}; MCP path protected=${Boolean(MCP_TOKEN)}.`);
});

const poll = setInterval(() => {
  void (async () => {
    await ensureTunnel().catch((error) => log(`Tunnel check failed: ${String(error)}`, "WARN"));
    const running = await detectAutoCad();
    if (running && !lastAutoCadRunning) {
      log("AutoCAD process detected; waking CadGPT core and CAD MCP.");
      await ensureCore("autocad").catch((error) => log(`AutoCAD wake failed: ${String(error)}`, "WARN"));
    }
    lastAutoCadRunning = running;
    await writeState().catch(() => undefined);
  })();
}, POLL_MS);
poll.unref?.();

void ensureTunnel();
void detectAutoCad().then(async (running) => {
  lastAutoCadRunning = running;
  if (running) await ensureCore("autocad").catch((error) => log(`Initial AutoCAD wake failed: ${String(error)}`, "WARN"));
  await writeState().catch(() => undefined);
});

async function shutdown(signal: string): Promise<void> {
  log(`${signal}: stopping wake-agent.`);
  clearInterval(poll);
  if (coreChild && !coreChild.killed) coreChild.kill();
  if (tunnelChild && !tunnelChild.killed) tunnelChild.kill();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
