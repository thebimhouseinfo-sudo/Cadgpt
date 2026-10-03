import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { getAppDataPath } from "../lib/appdata.js";

const PAIR_TTL_MS = 30_000;
const CONTROL_TOKEN = randomBytes(32).toString("base64url");

type SessionControl = {
  connectDrawing: (drawingSelector: string) => Promise<Record<string, unknown>>;
};

type PendingPair = {
  panelId: string;
  createdAt: number;
  expiresAt: number;
};

type PanelBinding = {
  panelId: string;
  sessionKey: string;
  pairedAt: number;
};

const controlsBySession = new Map<string, SessionControl>();
const pendingByPanel = new Map<string, PendingPair>();
const bindingByPanel = new Map<string, PanelBinding>();

function cleanup(): void {
  const now = Date.now();
  for (const [panelId, pending] of pendingByPanel) {
    if (pending.expiresAt <= now) pendingByPanel.delete(panelId);
  }
  for (const [panelId, binding] of bindingByPanel) {
    if (!controlsBySession.has(binding.sessionKey)) {
      bindingByPanel.delete(panelId);
    }
  }
}

function validPanelId(value: string): string {
  const panelId = value.trim();
  if (!/^[A-Za-z0-9._-]{8,120}$/.test(panelId)) {
    throw new Error("ADDIN_PANEL_ID_INVALID");
  }
  return panelId;
}

export function addinControlToken(): string {
  return CONTROL_TOKEN;
}

export async function writeAddinControlDescriptor(
  port: number
): Promise<string> {
  const dir = getAppDataPath("runtime", "autocad-addin");
  const filePath = path.join(dir, "control.json");
  await fs.mkdir(dir, { recursive: true });
  const tempPath = filePath + ".tmp";
  await fs.writeFile(
    tempPath,
    JSON.stringify(
      {
        schema_version: 1,
        host: "127.0.0.1",
        port,
        token: CONTROL_TOKEN,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await fs.rename(tempPath, filePath);
  return filePath;
}

export function beginAddinPanelPair(panelIdRaw: string): {
  panel_id: string;
  expires_at: string;
} {
  cleanup();
  const panelId = validPanelId(panelIdRaw);
  const now = Date.now();

  // One physical add-in panel is supported in this product path. Clearing
  // stale pending windows avoids pairing a later unrelated admission.
  pendingByPanel.clear();
  bindingByPanel.delete(panelId);
  pendingByPanel.set(panelId, {
    panelId,
    createdAt: now,
    expiresAt: now + PAIR_TTL_MS,
  });

  return {
    panel_id: panelId,
    expires_at: new Date(now + PAIR_TTL_MS).toISOString(),
  };
}

export function captureAddinAdmission(sessionKey: string): void {
  cleanup();
  const pending = [...pendingByPanel.values()];
  if (pending.length !== 1) return;

  const pair = pending[0];
  pendingByPanel.delete(pair.panelId);
  bindingByPanel.set(pair.panelId, {
    panelId: pair.panelId,
    sessionKey,
    pairedAt: Date.now(),
  });
}

export function addinPanelPairStatus(panelIdRaw: string): {
  paired: boolean;
  panel_id: string;
  paired_at?: string;
} {
  cleanup();
  const panelId = validPanelId(panelIdRaw);
  const binding = bindingByPanel.get(panelId);
  return binding
    ? {
        paired: true,
        panel_id: panelId,
        paired_at: new Date(binding.pairedAt).toISOString(),
      }
    : { paired: false, panel_id: panelId };
}

export function registerAddinSessionControl(
  sessionKey: string,
  control: SessionControl
): void {
  controlsBySession.set(sessionKey, control);
}

export function unregisterAddinSessionControl(sessionKey: string): void {
  controlsBySession.delete(sessionKey);
  for (const [panelId, binding] of bindingByPanel) {
    if (binding.sessionKey === sessionKey) {
      bindingByPanel.delete(panelId);
    }
  }
}

export async function connectAddinPanelDrawing(
  panelIdRaw: string,
  drawingSelectorRaw: string
): Promise<Record<string, unknown>> {
  cleanup();
  const panelId = validPanelId(panelIdRaw);
  const drawingSelector = drawingSelectorRaw.trim();
  if (!drawingSelector) {
    throw new Error("ADDIN_DRAWING_SELECTOR_REQUIRED");
  }

  const binding = bindingByPanel.get(panelId);
  if (!binding) {
    throw new Error("ADDIN_PANEL_NOT_PAIRED");
  }

  const control = controlsBySession.get(binding.sessionKey);
  if (!control) {
    bindingByPanel.delete(panelId);
    throw new Error("ADDIN_SESSION_UNAVAILABLE");
  }

  return control.connectDrawing(drawingSelector);
}

export function resetAddinControlForTests(): void {
  pendingByPanel.clear();
  bindingByPanel.clear();
  controlsBySession.clear();
}
