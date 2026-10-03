import fs from "node:fs/promises";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { getAppDataPath } from "./appdata.js";

const CONTROL_SECRET = randomBytes(32).toString("base64url");
const PAIR_WINDOW_MS = 180_000;

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

export interface AddinBoundDrawing {
  name: string | null;
  full_name: string | null;
}

interface SessionObserver {
  observerId: string;
  getBinding: () => Promise<{
    drawing: AddinBoundDrawing | null;
    bound_count: number;
  }>;
}

const pairedPanels = new Map<string, PairedPanel>();
const observers = new Map<string, SessionObserver>();
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
  await fs.rm(filePath, { force: true }).catch(() => undefined);
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

export function registerAddinSessionObserver(
  sessionKey: string,
  getBinding: SessionObserver["getBinding"]
): string {
  const observerId = randomUUID();
  observers.set(sessionKey, {
    observerId,
    getBinding,
  });
  return observerId;
}

export function unregisterAddinSessionObserver(
  sessionKey: string,
  observerId: string
): void {
  const current = observers.get(sessionKey);
  if (current?.observerId === observerId) {
    observers.delete(sessionKey);
  }
}

export async function addinBindingStatus(
  pairId: string
): Promise<{
  paired: boolean;
  session_ready: boolean;
  drawing: AddinBoundDrawing | null;
  bound_count: number;
}> {
  const pair = pairedPanels.get(pairId);
  if (!pair) {
    return {
      paired: false,
      session_ready: false,
      drawing: null,
      bound_count: 0,
    };
  }

  pair.lastAccessedAt = Date.now();
  const observer = observers.get(pair.sessionKey);
  if (!observer) {
    return {
      paired: true,
      session_ready: false,
      drawing: null,
      bound_count: 0,
    };
  }

  const binding = await observer.getBinding();
  return {
    paired: true,
    session_ready: true,
    drawing: binding.drawing,
    bound_count: binding.bound_count,
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
