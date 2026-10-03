import fs from "node:fs/promises";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { getAppDataPath } from "./appdata.js";

const CONTROL_SECRET = randomBytes(32).toString("base64url");
const PAIR_WINDOW_MS = 30_000;

interface PendingPair {
  pairId: string;
  createdAt: number;
  expiresAt: number;
}

interface PairedPanel {
  pairId: string;
  sessionKey: string;
  pairedAt: number;
  lastAccessedAt: number;
}

interface SessionController {
  controllerId: string;
  connectDrawing: (selector: string) => Promise<{
    drawing?: unknown;
    cad_tools_ready?: boolean;
  }>;
}

const pairedPanels = new Map<string, PairedPanel>();
const controllers = new Map<string, SessionController>();
let pendingPair: PendingPair | null = null;

function descriptorPath(): string {
  return getAppDataPath("state", "addin-control.json");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function cleanupPending(): void {
  if (pendingPair && Date.now() > pendingPair.expiresAt) {
    pendingPair = null;
  }
}

export function addinControlSecretMatches(value: unknown): boolean {
  return typeof value === "string" && safeEqual(value, CONTROL_SECRET);
}

export async function writeAddinControlDescriptor(
  port: number
): Promise<void> {
  const filePath = descriptorPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = filePath + ".tmp";
  await fs.writeFile(
    temp,
    JSON.stringify(
      {
        schema_version: 1,
        pid: process.pid,
        port,
        secret: CONTROL_SECRET,
        started_at: new Date().toISOString(),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await fs.rename(temp, filePath);
}

export async function removeAddinControlDescriptor(): Promise<void> {
  await fs.rm(descriptorPath(), { force: true }).catch(() => undefined);
}

export function startAddinPairing(): {
  pair_id: string;
  expires_at: string;
} {
  cleanupPending();
  const now = Date.now();
  const pairId = randomBytes(24).toString("base64url");
  pendingPair = {
    pairId,
    createdAt: now,
    expiresAt: now + PAIR_WINDOW_MS,
  };
  return {
    pair_id: pairId,
    expires_at: new Date(now + PAIR_WINDOW_MS).toISOString(),
  };
}

export function completePendingAddinPair(
  sessionKey: string
): string | null {
  cleanupPending();
  const pending = pendingPair;
  if (!pending) return null;

  pairedPanels.set(pending.pairId, {
    pairId: pending.pairId,
    sessionKey,
    pairedAt: Date.now(),
    lastAccessedAt: Date.now(),
  });
  pendingPair = null;
  return pending.pairId;
}

export function addinPairStatus(pairId: string): {
  paired: boolean;
  controller_ready: boolean;
} {
  const pair = pairedPanels.get(pairId);
  if (!pair) {
    return { paired: false, controller_ready: false };
  }
  pair.lastAccessedAt = Date.now();
  return {
    paired: true,
    controller_ready: controllers.has(pair.sessionKey),
  };
}

export function registerAddinSessionController(
  sessionKey: string,
  connectDrawing: SessionController["connectDrawing"]
): string {
  const controllerId = randomUUID();
  controllers.set(sessionKey, {
    controllerId,
    connectDrawing,
  });
  return controllerId;
}

export function unregisterAddinSessionController(
  sessionKey: string,
  controllerId: string
): void {
  const current = controllers.get(sessionKey);
  if (current?.controllerId === controllerId) {
    controllers.delete(sessionKey);
  }
}

function drawingSummary(value: unknown): {
  name: string | null;
  full_name: string | null;
} {
  if (!value || typeof value !== "object") {
    return { name: null, full_name: null };
  }
  const obj = value as Record<string, unknown>;
  return {
    name: typeof obj.name === "string" ? obj.name : null,
    full_name:
      typeof obj.full_name === "string" ? obj.full_name : null,
  };
}

export async function connectAddinPairToDrawing(
  pairId: string,
  selector: string
): Promise<{
  ok: true;
  drawing: {
    name: string | null;
    full_name: string | null;
  };
  cad_tools_ready: boolean;
}> {
  const pair = pairedPanels.get(pairId);
  if (!pair) {
    throw new Error("ADDIN_PAIR_REQUIRED");
  }
  const controller = controllers.get(pair.sessionKey);
  if (!controller) {
    throw new Error("ADDIN_SESSION_UNAVAILABLE");
  }

  const normalized = selector.trim();
  if (!normalized) {
    throw new Error("ADDIN_DRAWING_REQUIRED");
  }

  pair.lastAccessedAt = Date.now();
  const result = await controller.connectDrawing(normalized);
  return {
    ok: true,
    drawing: drawingSummary(result.drawing),
    cad_tools_ready: result.cad_tools_ready === true,
  };
}

export function clearAddinPairingsForSession(
  sessionKey: string
): void {
  for (const [pairId, pair] of pairedPanels) {
    if (pair.sessionKey === sessionKey) {
      pairedPanels.delete(pairId);
    }
  }
}
