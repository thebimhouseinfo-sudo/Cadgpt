import { randomUUID } from "node:crypto";

import { cadUpstream } from "../runtime/cad-upstream.js";
import { currentToolLease } from "../lib/work-registration.js";

export interface BoundDrawing {
  drawing_id: string;
  execution_id: string;
  name: string;
  full_name: string;
  host: string;
  runtime_document_identity: string;
  document_selector: string;
  bound_at: string;
}

const contexts = new Map<string, Map<string, BoundDrawing>>();

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

function normalizeDocuments(raw: unknown): Array<Record<string, unknown>> {
  const payload = extractPayload(raw);
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === "object"
    );
  }
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["documents", "result", "data"]) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as unknown[]).filter(
          (item): item is Record<string, unknown> => !!item && typeof item === "object"
        );
      }
    }
  }
  throw new Error("CAD MCP returned an unexpected document-list payload");
}

function itemRuntimeId(item: Record<string, unknown>): string {
  return String(item.runtime_document_id ?? "").trim();
}

function matchesBinding(
  item: Record<string, unknown>,
  binding: Pick<BoundDrawing, "runtime_document_identity">
): boolean {
  const runtimeId = itemRuntimeId(item);
  return Boolean(runtimeId && runtimeId === binding.runtime_document_identity);
}

function sameSelector(
  item: Record<string, unknown>,
  binding: Pick<BoundDrawing, "name" | "full_name">
): boolean {
  const name = String(item.name ?? "").toLowerCase();
  const fullName = String(item.full_name ?? "").toLowerCase();
  if (binding.full_name) return fullName === binding.full_name.toLowerCase();
  return name === binding.name.toLowerCase();
}

function executionContexts(executionId: string): Map<string, BoundDrawing> {
  let map = contexts.get(executionId);
  if (!map) {
    map = new Map<string, BoundDrawing>();
    contexts.set(executionId, map);
  }
  return map;
}

export async function listOpenDrawings(): Promise<Array<Record<string, unknown>>> {
  const raw = await cadUpstream.callTool("acad_list_open_documents", {});
  return normalizeDocuments(raw);
}

export async function bindDrawing(document: string): Promise<BoundDrawing> {
  const lease = currentToolLease();
  const executionId = lease.workId;
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
  const selector = fullName || name;
  const runtimeIdentity = itemRuntimeId(selected);
  if (!selector) throw new Error("Selected drawing has no usable name/path selector");
  if (!runtimeIdentity) {
    throw new Error(
      "CAD MCP document contract is missing runtime_document_id; regenerate/update the CAD MCP runtime before binding drawings."
    );
  }

  const map = executionContexts(executionId);
  for (const existing of map.values()) {
    if (matchesBinding(selected, existing)) return existing;
  }

  // Same name/path after a close+reopen is a new document lifetime. Retire the
  // stale context rather than allowing the old drawing_id to retarget.
  for (const [drawingId, existing] of map) {
    if (sameSelector(selected, existing) && existing.runtime_document_identity !== runtimeIdentity) {
      map.delete(drawingId);
    }
  }

  const binding: BoundDrawing = {
    drawing_id: `dwg_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    execution_id: executionId,
    name,
    full_name: fullName,
    host: String(selected.host ?? "autocad") || "autocad",
    runtime_document_identity: runtimeIdentity,
    document_selector: selector,
    bound_at: new Date().toISOString(),
  };
  map.set(binding.drawing_id, binding);
  return binding;
}

export function getBoundDrawings(): BoundDrawing[] {
  const lease = currentToolLease();
  return [...executionContexts(lease.workId).values()];
}

export function resolveDrawingContext(drawingId?: string): BoundDrawing {
  const lease = currentToolLease();
  const map = executionContexts(lease.workId);
  if (drawingId) {
    const selected = map.get(drawingId);
    if (!selected) {
      throw new Error(
        `Drawing context not found for this execution: ${drawingId}`
      );
    }
    return selected;
  }

  const values = [...map.values()];
  if (values.length === 0) {
    throw new Error(
      "No drawing is bound to this CadGPT work execution. Use drawing_list and drawing_bind first."
    );
  }
  if (values.length > 1) {
    throw new Error(
      "MULTIPLE_DRAWINGS_BOUND: drawing_id is required because this execution owns more than one drawing."
    );
  }
  return values[0];
}

export async function activateDrawingContext(
  binding: BoundDrawing
): Promise<BoundDrawing> {
  const docs = await listOpenDrawings();
  const available = docs.some((item) => matchesBinding(item, binding));
  if (!available) {
    const map = executionContexts(binding.execution_id);
    map.delete(binding.drawing_id);
    throw new Error(
      `BOUND_DRAWING_STALE: drawing ${binding.name} is no longer the same open AutoCAD document lifetime. Re-bind the drawing explicitly.`
    );
  }

  const raw = await cadUpstream.callTool("acad_set_active_document", {
    document_name: binding.document_selector,
    runtime_document_id: binding.runtime_document_identity,
  });
  if (raw && typeof raw === "object" && (raw as { isError?: boolean }).isError) {
    throw new Error(
      `Unable to activate bound drawing: ${binding.document_selector}`
    );
  }

  const activated = extractPayload(raw);
  if (
    activated &&
    typeof activated === "object" &&
    "runtime_document_id" in activated &&
    String((activated as Record<string, unknown>).runtime_document_id ?? "") !==
      binding.runtime_document_identity
  ) {
    throw new Error(
      "BOUND_DRAWING_STALE: AutoCAD activated a different document lifetime than the bound drawing."
    );
  }
  return binding;
}

export async function drawingBindingStatus(
  drawingId?: string
): Promise<Record<string, unknown>> {
  const lease = currentToolLease();
  const map = executionContexts(lease.workId);
  const selected = drawingId ? [resolveDrawingContext(drawingId)] : [...map.values()];
  if (!selected.length) {
    return { bound: false, count: 0, drawings: [] };
  }

  const docs = await listOpenDrawings();
  const drawings = selected.map((binding) => {
    const available = docs.some((item) => matchesBinding(item, binding));
    if (!available) map.delete(binding.drawing_id);
    return { ...binding, available };
  });

  return {
    bound: drawings.some((item) => item.available),
    count: drawings.length,
    drawings,
    ...(drawings.length === 1
      ? { drawing: drawings[0], available: drawings[0].available }
      : {}),
  };
}

export function clearExecutionDrawingContexts(executionId: string): void {
  contexts.delete(executionId);
}
