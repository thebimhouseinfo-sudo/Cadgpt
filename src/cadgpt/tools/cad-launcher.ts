import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { assertSessionClaimed } from "../lib/admission.js";
import { getTrayStatePath } from "../lib/appdata.js";

interface CadPrepareDrawing {
  key: string;
  name: string;
  full_name: string;
  active: boolean;
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
  autocad_active_document?: string | null;
  autocad_drawings?: Array<{
    name?: string;
    full_name?: string;
    active?: boolean;
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
    const snapshot = JSON.parse(raw) as TrayCadSnapshot;
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
    active: item.active === true,
  }));
}

function renderGeneralWelcome(reason?: string): string {
  const lines = [
    "```text",
    "CadGPT / CG",
    "────────────────────────────────",
    "SESSION   READY",
    "WORK      IDLE",
    "AUTOCAD   NOT DETECTED",
    "CAD MCP   SLEEPING",
    "",
    "cg/         command menu",
    "cg/list      refresh CAD launcher",
    "cg/help     usage help",
    "cg/status   session/work status",
    "────────────────────────────────",
    "```",
    "",
    "CadGPT is ready. You can write/edit Lisp, work with files/jobs/skills, or open AutoCAD later.",
  ];
  if (reason) lines.push("", reason);
  return lines.join("\n");
}

function renderCadPrepare(
  drawings: CadPrepareDrawing[],
  options: { stale?: boolean; attachWarning?: string } = {}
): string {
  const lines = [
    "```text",
    "CadGPT / CG — CAD Workspace Launcher",
    "────────────────────────────────",
    "",
    "OPEN DRAWINGS",
  ];

  if (!drawings.length) {
    lines.push("  — no open drawing cached —");
  } else {
    for (const item of drawings) {
      const label = item.full_name || item.name || "(unnamed)";
      lines.push(`  ${item.key}. ${item.active ? "* " : "  "}${label}`);
    }
  }

  lines.push(
    "────────────────────────────────",
    "```"
  );

  if (options.attachWarning) {
    lines.push(
      "",
      options.attachWarning,
      "",
      "Mở hoặc chọn drawing trong AutoCAD rồi dùng cg/list để làm mới danh sách."
    );
  } else if (!drawings.length) {
    lines.push(
      "",
      "Mở drawing trong AutoCAD rồi dùng cg/list để làm mới danh sách.",
      "",
      "Hoặc dùng cg/ để gọi các command khác (viết lisp, viết skill, etc.)."
    );
  } else {
    lines.push(
      "",
      "Chọn drawing để bắt đầu làm việc",
      "cg/list để cập nhật danh sách drawing đang mở",
      "hoặc cg/ để gọi các command khác (viết lisp, viết skill, etc.)."
    );
  }

  if (options.stale) {
    lines.push(
      "",
      "_Danh sách được lấy từ tray cache và sẽ được kiểm tra lại khi bắt đầu CAD work._"
    );
  }

  return lines.join("\n");
}

export async function prepareCadLaunch(sessionKey: string): Promise<{
  mode: "general" | "cad_prepare";
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
      mode: "general",
      welcome_text: renderGeneralWelcome(
        "Tray CAD snapshot is unavailable. CadGPT did not start CAD MCP to compensate."
      ),
      autocad_detected: false,
      source: "tray_cache",
      probe_age_ms: null,
    };
  }

  if (snapshot.autocad_running !== true) {
    pendingBySession.delete(sessionKey);
    return {
      mode: "general",
      welcome_text: renderGeneralWelcome(),
      autocad_detected: false,
      source: "tray_cache",
      probe_age_ms: age_ms,
    };
  }

  const drawings = normalizeDrawings(snapshot);
  const stale = age_ms === null || age_ms > TRAY_PROBE_FRESH_MS;

  if (snapshot.autocad_attached !== true) {
    pendingBySession.delete(sessionKey);
    return {
      mode: "cad_prepare",
      welcome_text: renderCadPrepare([], {
        stale,
        attachWarning:
          "AutoCAD process is open, but the tray probe cannot read its document collection. CadGPT still keeps full CAD MCP asleep.",
      }),
      autocad_detected: true,
      source: "tray_cache",
      probe_age_ms: age_ms,
      drawings: [],
    };
  }

  if (!drawings.length) {
    pendingBySession.delete(sessionKey);
    return {
      mode: "cad_prepare",
      welcome_text: renderCadPrepare([], { stale }),
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
    welcome_text: renderCadPrepare(drawings, { stale }),
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
  choiceKeys?: string[]
): CadPrepareDrawing[] {
  cleanupPending();
  const pending = pendingBySession.get(sessionKey);
  if (!pending || pending.token !== confirmationToken) {
    throw new Error(
      "CAD_PREPARE_REQUIRED: CAD workspace confirmation is missing or stale. Open the CAD launcher again."
    );
  }

  const selectedKeys = new Set(
    (choiceKeys ?? []).map((value) => value.trim()).filter(Boolean)
  );
  const selected = selectedKeys.size
    ? pending.drawings.filter((drawing) => selectedKeys.has(drawing.key))
    : pending.drawings;

  if (!selected.length) {
    throw new Error("CAD_WORKSPACE_EMPTY: select at least one cached open drawing.");
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
      drawings: CadPrepareDrawing[]
    ) => Promise<{ text: string; work_handle: Record<string, unknown>; drawings: unknown[] }>;
  }
): void {
  server.registerTool(
    "cadgpt_cad_confirm",
    {
      title: "Confirm CadGPT CAD Workspace",
      description:
        "Confirm the pending tray-cached CAD workspace. Only this transition starts full CAD MCP, verifies the live drawings, creates/reuses direct CAD work authority, and binds the workspace.",
      inputSchema: {
        confirmation_token: z.string().min(1),
        choice_keys: z.array(z.string()).optional(),
      },
    },
    async ({ confirmation_token, choice_keys }) => {
      const drawings = consumeCadPrepare(
        options.sessionKey,
        confirmation_token,
        choice_keys
      );
      const activated = await options.activateWorkspace(drawings);
      return {
        content: [{ type: "text" as const, text: activated.text }],
        structuredContent: {
          text: activated.text,
          work_handle: activated.work_handle,
          drawings: activated.drawings,
        },
      };
    }
  );
}
