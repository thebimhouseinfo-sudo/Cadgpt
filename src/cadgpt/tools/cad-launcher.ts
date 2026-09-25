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

function cleanupPending(): void {
  const now = Date.now();
  for (const [sessionKey, pending] of pendingBySession) {
    if (now - pending.createdAt > PREPARE_TTL_MS) {
      pendingBySession.delete(sessionKey);
    }
  }
}

async function readTrayCadSnapshot(): Promise<{
  snapshot: TrayCadSnapshot | null;
  age_ms: number | null;
}> {
  try {
    const raw = await fs.readFile(getTrayStatePath(), "utf8");
    // Windows PowerShell 5.1 writes UTF-8 with a BOM. Strip it before JSON.parse
    // so the slim MCP can consume the same tray snapshot that PowerShell reads.
    const snapshot = JSON.parse(raw.replace(/^\uFEFF/, "")) as TrayCadSnapshot;
    const probeAt = snapshot.autocad_probe_at
      ? Date.parse(snapshot.autocad_probe_at)
      : Number.NaN;
    const ageMs = Number.isFinite(probeAt) ? Math.max(0, Date.now() - probeAt) : null;
    return { snapshot, age_ms: ageMs };
  } catch {
    return { snapshot: null, age_ms: null };
  }
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
    "Online",
    "",
    "OPEN DRAWINGS",
  ];

  if (!drawings.length) {
    lines.push("  — chưa có drawing đang mở —");
  } else {
    for (const item of drawings) {
      const label = item.full_name || item.name || "(unnamed)";
      lines.push(`  ${item.key}. ${label}`);
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
    pendingBySession.delete(sessionKey);
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
    pendingBySession.delete(sessionKey);
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
    pendingBySession.delete(sessionKey);
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
    pendingBySession.delete(sessionKey);
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
  pendingBySession.set(sessionKey, {
    token,
    sessionKey,
    createdAt: Date.now(),
    drawings,
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

export function consumeCadPrepare(
  sessionKey: string,
  confirmationToken: string,
  choiceKey: string
): CadPrepareDrawing {
  cleanupPending();
  const pending = pendingBySession.get(sessionKey);
  if (!pending || pending.token !== confirmationToken) {
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

  pendingBySession.delete(sessionKey);
  return selected;
}

export function clearCadPrepare(sessionKey: string): void {
  pendingBySession.delete(sessionKey);
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
      const drawing = consumeCadPrepare(
        options.sessionKey,
        confirmation_token,
        choice_key
      );
      const activated = await options.activateWorkspace(drawing);
      return {
        content: [{ type: "text" as const, text: activated.text }],
        structuredContent: {
          text: activated.text,
          work_handle: activated.work_handle,
          drawing: activated.drawing,
        },
      };
    }
  );
}
