import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { assertSessionClaimed } from "../lib/admission.js";
import { getTrayStatePath } from "../lib/appdata.js";

export interface CadPrepareDrawing {
  key: string;
  name: string;
  full_name: string;
}

interface PendingCadPrepare {
  token: string;
  sessionKey: string;
  createdAt: number;
  drawings: CadPrepareDrawing[];
  state: "ready" | "in_flight";
}

interface TrayCadSnapshot {
  autocad_running?: boolean;
  autocad_attached?: boolean;
  autocad_drawing_count?: number | null;
  autocad_drawings?: Array<{
    name?: string;
    full_name?: string;
  }>;
  autocad_probe_at?: string | null;
}

const PREPARE_TTL_MS = 30 * 60 * 1000;
const TRAY_PROBE_FRESH_MS = 45_000;
const pendingBySession = new Map<string, PendingCadPrepare>();
const pendingByToken = new Map<string, PendingCadPrepare>();

function removePending(pending: PendingCadPrepare): void {
  if (pendingBySession.get(pending.sessionKey) === pending) {
    pendingBySession.delete(pending.sessionKey);
  }
  if (pendingByToken.get(pending.token) === pending) {
    pendingByToken.delete(pending.token);
  }
}

function cleanupPending(): void {
  const now = Date.now();
  for (const pending of pendingBySession.values()) {
    if (now - pending.createdAt > PREPARE_TTL_MS) {
      removePending(pending);
    }
  }
}

function replacePending(sessionKey: string, pending?: PendingCadPrepare): void {
  const previous = pendingBySession.get(sessionKey);
  if (previous) removePending(previous);
  if (!pending) return;
  pendingBySession.set(sessionKey, pending);
  pendingByToken.set(pending.token, pending);
}

export function resolveCadPrepareSessionByToken(
  confirmationToken: string
): string | undefined {
  cleanupPending();
  const pending = pendingByToken.get(confirmationToken);
  return pending?.sessionKey;
}

async function readTrayCadSnapshot(): Promise<{
  snapshot: TrayCadSnapshot | null;
  age_ms: number | null;
}> {
  const statePath = getTrayStatePath();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await fs.readFile(statePath, "utf8");
      const snapshot = JSON.parse(raw.replace(/^\uFEFF/, "")) as TrayCadSnapshot;
      const probeAt = snapshot.autocad_probe_at
        ? Date.parse(snapshot.autocad_probe_at)
        : Number.NaN;
      const ageMs = Number.isFinite(probeAt)
        ? Math.max(0, Date.now() - probeAt)
        : null;
      return { snapshot, age_ms: ageMs };
    } catch {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }
  }

  return { snapshot: null, age_ms: null };
}

function normalizeDrawings(snapshot: TrayCadSnapshot): CadPrepareDrawing[] {
  const rows = Array.isArray(snapshot.autocad_drawings)
    ? snapshot.autocad_drawings
    : [];
  return rows.map((item, index) => ({
    key: String(index + 1),
    name: String(item.name ?? ""),
    full_name: String(item.full_name ?? ""),
  }));
}

function commonCommands(lines: string[]): void {
  lines.push(
    "COMMANDS",
    "cg/cl       create Lisp",
    "cg/cj       create Job",
    "cg/job      list registered Jobs",
    "",
    "cg/         xem toàn bộ command",
    "────────────────────────────────"
  );
}

function renderOfflineWelcome(reason?: string): string {
  const lines = [
    "```text",
    "CadGPT / CG",
    "────────────────────────────────",
    "",
    "CAD",
    "Offline",
    "",
    "────────────────────────────────",
    "",
    "WORKSPACE",
    "AutoCAD đang tắt nên chưa có bản vẽ nào đang mở.",
    "Hãy mở AutoCAD và drawing cần làm việc, sau đó dùng:",
    "",
    "cg/list     cập nhật danh sách drawing và tạo workspace",
    "",
    "────────────────────────────────",
    "",
  ];
  commonCommands(lines);
  lines.push("```");
  if (reason) lines.push("", reason);
  return lines.join("\n");
}

function renderOnlineWelcome(
  drawings: CadPrepareDrawing[],
  options: { stale?: boolean; attachWarning?: string } = {}
): string {
  const lines = [
    "```text",
    "CadGPT / CG",
    "────────────────────────────────",
    "",
    "CAD",
  ];

  if (!drawings.length) {
    lines.push("  — chưa có drawing đang mở —");
  } else {
    for (const item of drawings) {
      const label = item.full_name || item.name || "(unnamed)";
      lines.push(`${item.key}. ${label}`);
    }
  }

  lines.push(
    "",
    "────────────────────────────────",
    "",
    "WORKSPACE"
  );

  if (options.attachWarning) {
    lines.push(
      "AutoCAD đang mở nhưng tray chưa đọc được danh sách drawing.",
      "Mở/đóng lại drawing nếu cần rồi dùng:",
      "",
      "cg/list     cập nhật danh sách drawing đang mở"
    );
  } else if (!drawings.length) {
    lines.push(
      "Chưa có drawing để tạo workspace.",
      "Hãy mở một drawing trong AutoCAD rồi dùng:",
      "",
      "cg/list     cập nhật danh sách drawing đang mở"
    );
  } else {
    lines.push(
      "Chọn 1 drawing để làm workspace.",
      "Ví dụ: 1",
      "",
      "cg/list     cập nhật danh sách drawing đang mở"
    );
  }

  lines.push(
    "",
    "────────────────────────────────",
    ""
  );
  commonCommands(lines);
  lines.push("```");

  if (options.stale) {
    lines.push(
      "",
      "_Danh sách lấy từ tray cache; drawing đã chọn sẽ được kiểm tra live trước khi workspace được đăng ký._"
    );
  }

  return lines.join("\n");
}

export async function prepareCadLaunch(sessionKey: string): Promise<{
  mode: "offline" | "cad_prepare";
  welcome_text: string;
  confirmation_token?: string;
  drawings?: CadPrepareDrawing[];
  autocad_detected: boolean;
  source: "tray_cache";
  probe_age_ms: number | null;
}> {
  assertSessionClaimed(sessionKey);
  cleanupPending();

  const { snapshot, age_ms } = await readTrayCadSnapshot();
  if (!snapshot) {
    replacePending(sessionKey);
    return {
      mode: "offline",
      welcome_text: renderOfflineWelcome(
        "Tray snapshot chưa sẵn sàng. CadGPT không khởi động full CAD MCP để bù cho bước kiểm tra này."
      ),
      autocad_detected: false,
      source: "tray_cache",
      probe_age_ms: null,
    };
  }

  if (snapshot.autocad_running !== true) {
    replacePending(sessionKey);
    return {
      mode: "offline",
      welcome_text: renderOfflineWelcome(),
      autocad_detected: false,
      source: "tray_cache",
      probe_age_ms: age_ms,
    };
  }

  const stale = age_ms === null || age_ms > TRAY_PROBE_FRESH_MS;

  if (snapshot.autocad_attached !== true) {
    replacePending(sessionKey);
    return {
      mode: "cad_prepare",
      welcome_text: renderOnlineWelcome([], {
        stale,
        attachWarning: "Tray probe chưa đọc được document collection.",
      }),
      autocad_detected: true,
      source: "tray_cache",
      probe_age_ms: age_ms,
      drawings: [],
    };
  }

  const drawings = normalizeDrawings(snapshot);
  if (!drawings.length) {
    replacePending(sessionKey);
    return {
      mode: "cad_prepare",
      welcome_text: renderOnlineWelcome([], { stale }),
      autocad_detected: true,
      source: "tray_cache",
      probe_age_ms: age_ms,
      drawings: [],
    };
  }

  const token = randomUUID();
  replacePending(sessionKey, {
    token,
    sessionKey,
    createdAt: Date.now(),
    drawings,
    state: "ready",
  });

  return {
    mode: "cad_prepare",
    welcome_text: renderOnlineWelcome(drawings, { stale }),
    confirmation_token: token,
    drawings,
    autocad_detected: true,
    source: "tray_cache",
    probe_age_ms: age_ms,
  };
}

export function beginCadPrepareConfirm(
  sessionKey: string,
  confirmationToken: string,
  choiceKey: string
): CadPrepareDrawing {
  cleanupPending();
  const pending = pendingBySession.get(sessionKey);
  if (
    !pending ||
    pending.token !== confirmationToken ||
    pendingByToken.get(confirmationToken) !== pending ||
    pending.state !== "ready"
  ) {
    throw new Error(
      "CAD_PREPARE_REQUIRED: CAD workspace selection is missing or stale. Use cg/list and select one drawing again."
    );
  }

  const key = choiceKey.trim();
  if (!key || key.includes(",") || /\s/.test(key)) {
    throw new Error(
      "CAD_SINGLE_DRAWING_REQUIRED: choose exactly one drawing number for this work."
    );
  }

  const selected = pending.drawings.find((drawing) => drawing.key === key);
  if (!selected) {
    throw new Error(
      "CAD_WORKSPACE_INVALID_SELECTION: choose one drawing number from the current cg/list result."
    );
  }

  pending.state = "in_flight";
  return selected;
}

export function commitCadPrepareConfirm(
  sessionKey: string,
  confirmationToken: string
): void {
  cleanupPending();
  const pending = pendingBySession.get(sessionKey);
  if (
    !pending ||
    pending.token !== confirmationToken ||
    pendingByToken.get(confirmationToken) !== pending ||
    pending.state !== "in_flight"
  ) {
    throw new Error(
      "CAD_PREPARE_REQUIRED: CAD workspace selection is missing or stale. Use cg/list and select one drawing again."
    );
  }
  removePending(pending);
}

export function rollbackCadPrepareConfirm(
  sessionKey: string,
  confirmationToken: string
): void {
  cleanupPending();
  const pending = pendingBySession.get(sessionKey);
  if (
    pending &&
    pending.token === confirmationToken &&
    pendingByToken.get(confirmationToken) === pending &&
    pending.state === "in_flight"
  ) {
    pending.state = "ready";
  }
}

export function clearCadPrepare(sessionKey: string): void {
  replacePending(sessionKey);
}

export function registerCadPrepareConfirmTool(
  server: McpServer,
  options: {
    sessionKey: string;
    activateWorkspace: (
      drawing: CadPrepareDrawing
    ) => Promise<{ text: string; work_handle: Record<string, unknown>; drawing: unknown }>;
  }
): void {
  server.registerTool(
    "cadgpt_cad_confirm",
    {
      title: "Confirm CadGPT Drawing Workspace",
      description:
        "Register exactly one tray-cached drawing as the CadGPT workspace. This transition starts full CAD MCP, verifies the drawing live, binds one DrawingContext, and creates/reuses work authority.",
      inputSchema: {
        confirmation_token: z.string().min(1),
        choice_key: z.string().min(1),
      },
    },
    async ({ confirmation_token, choice_key }) => {
      const drawing = beginCadPrepareConfirm(
        options.sessionKey,
        confirmation_token,
        choice_key
      );
      try {
        const activated = await options.activateWorkspace(drawing);
        commitCadPrepareConfirm(options.sessionKey, confirmation_token);
        return {
          content: [{ type: "text" as const, text: activated.text }],
          structuredContent: {
            text: activated.text,
            work_handle: activated.work_handle,
            drawing: activated.drawing,
          },
        };
      } catch (error) {
        rollbackCadPrepareConfirm(options.sessionKey, confirmation_token);
        throw error;
      }
    }
  );
}
