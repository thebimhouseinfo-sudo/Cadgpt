import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { cadUpstream } from "../runtime/cad-upstream.js";

export interface BoundDrawing {
  name: string;
  full_name: string;
  host: string;
  bound_at: string;
}

const bindings = new WeakMap<McpServer, BoundDrawing>();

function extractPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as {
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (obj.structuredContent !== undefined) return obj.structuredContent;
  const text = obj.content?.find((item) => item.type === "text" && typeof item.text === "string")?.text;
  if (text === undefined) return raw;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeDocuments(raw: unknown): Array<Record<string, unknown>> {
  const payload = extractPayload(raw);
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["documents", "result", "data"]) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
      }
    }
  }
  throw new Error("CAD MCP returned an unexpected document-list payload");
}

export async function listOpenDrawings(): Promise<Array<Record<string, unknown>>> {
  const raw = await cadUpstream.callTool("acad_list_open_documents", {});
  return normalizeDocuments(raw);
}

export function getBoundDrawing(server: McpServer): BoundDrawing | null {
  return bindings.get(server) ?? null;
}

export async function bindDrawing(server: McpServer, document: string): Promise<BoundDrawing> {
  const needle = document.trim().toLowerCase();
  if (!needle) throw new Error("document is required");

  const docs = await listOpenDrawings();
  const matches = docs.filter((item) => {
    const name = String(item.name ?? "").toLowerCase();
    const fullName = String(item.full_name ?? "").toLowerCase();
    return name === needle || fullName === needle;
  });
  if (matches.length === 0) throw new Error(`Open drawing not found: ${document}`);
  if (matches.length > 1) throw new Error(`Drawing identity is ambiguous: ${document}`);

  const selected = matches[0];
  const name = String(selected.name ?? "");
  const fullName = String(selected.full_name ?? "");
  const identity = fullName || name;
  if (!identity) throw new Error("Selected drawing has no usable identity");

  const activated = await cadUpstream.callTool("acad_set_active_document", {
    document_name: identity,
  });
  const activatedPayload = extractPayload(activated);
  if (activated && typeof activated === "object" && (activated as { isError?: boolean }).isError) {
    throw new Error(`CAD MCP could not activate drawing: ${JSON.stringify(activatedPayload)}`);
  }

  const binding: BoundDrawing = {
    name,
    full_name: fullName,
    host: String(selected.host ?? "autocad"),
    bound_at: new Date().toISOString(),
  };
  bindings.set(server, binding);
  return binding;
}

export function clearDrawingBinding(server: McpServer): void {
  bindings.delete(server);
}

export async function ensureBoundDrawingActive(server: McpServer): Promise<BoundDrawing> {
  const binding = getBoundDrawing(server);
  if (!binding) {
    throw new Error("No drawing is bound to this CadGPT session. Use drawing_list and drawing_bind first.");
  }

  const identity = binding.full_name || binding.name;
  const docs = await listOpenDrawings();
  const available = docs.some((item) => {
    const name = String(item.name ?? "").toLowerCase();
    const fullName = String(item.full_name ?? "").toLowerCase();
    return name === binding.name.toLowerCase() || (!!binding.full_name && fullName === binding.full_name.toLowerCase());
  });
  if (!available) {
    clearDrawingBinding(server);
    throw new Error(`Bound drawing is no longer open: ${identity}`);
  }

  const raw = await cadUpstream.callTool("acad_set_active_document", {
    document_name: identity,
  });
  if (raw && typeof raw === "object" && (raw as { isError?: boolean }).isError) {
    throw new Error(`Unable to reactivate bound drawing before CAD operation: ${identity}`);
  }
  return binding;
}

export async function drawingBindingStatus(server: McpServer) {
  const binding = getBoundDrawing(server);
  if (!binding) return { bound: false, drawing: null, available: false };

  try {
    const docs = await listOpenDrawings();
    const available = docs.some((item) => {
      const name = String(item.name ?? "").toLowerCase();
      const fullName = String(item.full_name ?? "").toLowerCase();
      return name === binding.name.toLowerCase() || (!!binding.full_name && fullName === binding.full_name.toLowerCase());
    });
    return { bound: true, drawing: binding, available };
  } catch (error) {
    return {
      bound: true,
      drawing: binding,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
