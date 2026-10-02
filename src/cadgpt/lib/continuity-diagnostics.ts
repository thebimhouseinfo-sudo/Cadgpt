import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

import type { Request } from "express";

import { getAppDataPath } from "./appdata.js";

const ENABLED =
  (process.env.CADGPT_CONTINUITY_DIAGNOSTICS || "true").trim().toLowerCase() !==
  "false";
const RUNTIME_ID = randomUUID();
const MAX_BYTES = 2 * 1024 * 1024;
const FINGERPRINT_KEY_PATH = getAppDataPath("state", "continuity-fingerprint.key");

function loadOrCreateFingerprintKey(): Buffer {
  fsSync.mkdirSync(path.dirname(FINGERPRINT_KEY_PATH), { recursive: true });
  try {
    const existing = fsSync.readFileSync(FINGERPRINT_KEY_PATH);
    if (existing.length >= 32) return existing;
  } catch {
    // Create the key below.
  }

  const created = randomBytes(32);
  const tempPath = `${FINGERPRINT_KEY_PATH}.${process.pid}.tmp`;
  try {
    fsSync.writeFileSync(tempPath, created, { flag: "wx", mode: 0o600 });
    fsSync.renameSync(tempPath, FINGERPRINT_KEY_PATH);
    return created;
  } catch {
    try {
      fsSync.rmSync(tempPath, { force: true });
    } catch {}
    const existing = fsSync.readFileSync(FINGERPRINT_KEY_PATH);
    if (existing.length < 32) {
      throw new Error("CADGPT_CONTINUITY_FINGERPRINT_KEY_INVALID");
    }
    return existing;
  }
}

const FINGERPRINT_KEY = loadOrCreateFingerprintKey();

const BLOCKED_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
]);

let writeChain: Promise<void> = Promise.resolve();

function scalarHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join("\u001f");
  return value;
}

export function continuityFingerprint(value: string | undefined): string | null {
  if (!value) return null;
  return createHmac("sha256", FINGERPRINT_KEY)
    .update(value)
    .digest("hex")
    .slice(0, 16);
}

export function continuityHeaderFingerprints(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of Object.keys(headers).sort()) {
    const normalized = name.toLowerCase();
    if (BLOCKED_HEADER_NAMES.has(normalized)) continue;
    if (
      normalized.includes("secret") ||
      normalized.includes("access-token") ||
      normalized.includes("refresh-token")
    ) {
      continue;
    }

    const value = scalarHeaderValue(headers[name]);
    if (!value) continue;
    const fingerprint = continuityFingerprint(value);
    if (fingerprint) output[normalized] = fingerprint;
  }
  return output;
}

export function summarizeMcpBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const value = body as Record<string, unknown>;
  const method = typeof value.method === "string" ? value.method : undefined;
  const params =
    value.params && typeof value.params === "object"
      ? (value.params as Record<string, unknown>)
      : undefined;
  const toolName =
    method === "tools/call" &&
    params &&
    typeof params.name === "string"
      ? params.name
      : undefined;
  const clientInfo =
    method === "initialize" &&
    params?.clientInfo &&
    typeof params.clientInfo === "object"
      ? (params.clientInfo as Record<string, unknown>)
      : undefined;

  return {
    ...(method ? { rpc_method: method } : {}),
    ...(toolName ? { tool_name: toolName } : {}),
    ...(clientInfo
      ? {
          client_name:
            typeof clientInfo.name === "string" ? clientInfo.name : undefined,
          client_version:
            typeof clientInfo.version === "string"
              ? clientInfo.version
              : undefined,
        }
      : {}),
  };
}

async function rotateIfNeeded(
  logPath: string,
  rotatedPath: string
): Promise<void> {
  try {
    const stat = await fs.stat(logPath);
    if (stat.size < MAX_BYTES) return;
    await fs.rm(rotatedPath, { force: true });
    await fs.rename(logPath, rotatedPath);
  } catch {
    // Missing/unavailable diagnostics file is non-fatal.
  }
}

async function appendRecord(record: Record<string, unknown>): Promise<void> {
  if (!ENABLED) return;
  const logsRoot = getAppDataPath("logs");
  const logPath = getAppDataPath("logs", "continuity.ndjson");
  const rotatedPath = getAppDataPath("logs", "continuity.previous.ndjson");
  await fs.mkdir(logsRoot, { recursive: true });
  await rotateIfNeeded(logPath, rotatedPath);
  await fs.appendFile(logPath, JSON.stringify(record) + "\n", "utf8");
}

export function logContinuityDiagnostic(
  event: string,
  fields: Record<string, unknown> = {}
): void {
  if (!ENABLED) return;
  const record = {
    timestamp: new Date().toISOString(),
    runtime_id: RUNTIME_ID,
    pid: process.pid,
    event,
    ...fields,
  };
  writeChain = writeChain
    .catch(() => undefined)
    .then(() => appendRecord(record))
    .catch((error) => {
      console.warn(
        "[MCP] continuity diagnostics write failed:",
        error instanceof Error ? error.message : String(error)
      );
    });
}

export function logContinuityRequest(
  req: Request,
  event: string,
  fields: Record<string, unknown> = {}
): void {
  const sessionId = scalarHeaderValue(req.headers["mcp-session-id"]);
  logContinuityDiagnostic(event, {
    http_method: req.method,
    transport_session: continuityFingerprint(sessionId),
    header_fingerprints: continuityHeaderFingerprints(
      req.headers as Record<string, string | string[] | undefined>
    ),
    ...summarizeMcpBody(req.body),
    ...fields,
  });
}

export function continuityDiagnosticsPath(): string {
  return getAppDataPath("logs", "continuity.ndjson");
}

export async function flushContinuityDiagnostics(): Promise<void> {
  await writeChain.catch(() => undefined);
}
