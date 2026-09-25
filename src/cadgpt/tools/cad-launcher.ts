import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { assertSessionClaimed } from "../lib/admission.js";
import { cadUpstream } from "../runtime/cad-upstream.js";

interface CadPrepareDrawing {
  key: string;
  name: string;
  full_name: string;
  runtime_document_id: string;
  active: boolean;
}

interface PendingCadPrepare {
  token: string;
  sessionKey: string;
  createdAt: number;
  drawings: CadPrepareDrawing[];
}

const PREPARE_TTL_MS = 30 * 60 * 1000;
const pendingBySession = new Map<string, PendingCadPrepare>();

function extractPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as {
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (obj.structuredContent !== undefined) return obj.structuredContent;
  const text = obj.content?.find(
    (item) => item.type === "text" && typeof item.text === "string"
  )?.text;
  if (text === undefined) return raw;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeDrawings(raw: unknown): CadPrepareDrawing[] {
  const payload = extractPayload(raw);
  let rows: Array<Record<string, unknown>> = [];
  if (Array.isArray(payload)) {
    rows = payload.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === "object"
    );
  } else if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["documents", "result", "data"]) {
      if (Array.isArray(obj[key])) {
        rows = (obj[key] as unknown[]).filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === "object"
        );
        break;
      }
    }
  }

  return rows.map((item, index) => ({
    key: String(index + 1),
    name: String(item.name ?? ""),
    full_name: String(item.full_name ?? ""),
    runtime_document_id: String(item.runtime_document_id ?? ""),
    active: item.active === true,
  }));
}

function cleanupPending(): void {
  const now = Date.now();
  for (const [sessionKey, pending] of pendingBySession) {
    if (now - pending.createdAt > PREPARE_TTL_MS) {
      pendingBySession.delete(sessionKey);
    }
  }
}

function renderGeneralWelcome(): string {
  return [
    "```text",
    "CadGPT / CG",
    "────────────────────────────────",
    "SESSION   READY",
    "WORK      IDLE",
    "AUTOCAD   NOT DETECTED",
    "CAD MCP   SLEEPING",
    "",
    "cadgpt/         command menu",
    "cadgpt/help     usage help",
    "cadgpt/status   session/work status",
    "────────────────────────────────",
    "```",
    "",
    "CadGPT is ready. You can write/edit Lisp, work with files/jobs/skills, or open AutoCAD later.",
  ].join("\n");
}

function renderCadPrepare(drawings: CadPrepareDrawing[], attachWarning?: string): string {
  const lines = [
    "```text",
    "CadGPT / CG — CAD Workspace Launcher",
    "────────────────────────────────",
    "SESSION   READY",
    "WORK      PREPARE",
    "AUTOCAD   DETECTED",
    "CAD MCP   PREPARE (READ ONLY)",
    "",
    "OPEN DRAWINGS",
  ];

  if (!drawings.length) {
    lines.push("  — no open drawing detected —");
  } else {
    for (const item of drawings) {
      const label = item.full_name || item.name || "(unnamed)";
      lines.push(`  ${item.key}. ${item.active ? "* " : "  "}${label}`);
    }
  }

  lines.push(
    "",
    "* = AutoCAD active drawing",
    "────────────────────────────────",
    "```"
  );

  if (attachWarning) {
    lines.push("", `AutoCAD was detected but CadGPT could not attach cleanly: ${attachWarning}`);
  } else if (!drawings.length) {
    lines.push("", "Open a drawing in AutoCAD, then call CG again or use cadgpt/cad.");
  } else {
    lines.push(
      "",
      "Confirm this CAD workspace to start CAD work. By default, confirmation binds all listed drawings; you may also choose specific drawing numbers."
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
}> {
  assertSessionClaimed(sessionKey);
  cleanupPending();

  try {
    const probe = await cadUpstream.prepare();
    const drawings = normalizeDrawings(probe.drawings);
    if (!drawings.length) {
      pendingBySession.delete(sessionKey);
      return {
        mode: "cad_prepare",
        welcome_text: renderCadPrepare([]),
        autocad_detected: true,
        drawings: [],
      };
    }

    const token = randomUUID();
    const pending: PendingCadPrepare = {
      token,
      sessionKey,
      createdAt: Date.now(),
      drawings,
    };
    pendingBySession.set(sessionKey, pending);

    return {
      mode: "cad_prepare",
      welcome_text: renderCadPrepare(drawings),
      confirmation_token: token,
      drawings,
      autocad_detected: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pendingBySession.delete(sessionKey);

    if (/AutoCAD is not running/i.test(message)) {
      await cadUpstream.deactivate().catch(() => undefined);
      return {
        mode: "general",
        welcome_text: renderGeneralWelcome(),
        autocad_detected: false,
      };
    }

    const detected = /AutoCAD is running/i.test(message);
    if (detected) {
      return {
        mode: "cad_prepare",
        welcome_text: renderCadPrepare([], message),
        autocad_detected: true,
        drawings: [],
      };
    }

    await cadUpstream.deactivate().catch(() => undefined);
    return {
      mode: "general",
      welcome_text: renderGeneralWelcome(),
      autocad_detected: false,
    };
  }
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
      "CAD_PREPARE_REQUIRED: CAD workspace confirmation is missing or stale. Launch the CAD workspace again."
    );
  }

  const selectedKeys = new Set(
    (choiceKeys ?? []).map((value) => value.trim()).filter(Boolean)
  );
  const selected = selectedKeys.size
    ? pending.drawings.filter((drawing) => selectedKeys.has(drawing.key))
    : pending.drawings;

  if (!selected.length) {
    throw new Error("CAD_WORKSPACE_EMPTY: select at least one open drawing.");
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
        "Confirm the pending read-only CAD workspace prepared at CadGPT launch. Only this confirmation creates/reuses direct CAD work authority and binds drawings.",
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
