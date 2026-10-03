import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Request } from "express";

import {
  continuityFingerprint,
  logContinuityDiagnostic,
} from "./continuity-diagnostics.js";
import { logicalConversationKeyFromRequest } from "./logical-conversation.js";

export type Stage0EvidenceEvent =
  | "admission_completed"
  | "admission_failed"
  | "session_probe_completed"
  | "session_probe_failed";

export type Stage0FailureCategory =
  | "ADMISSION_CALLBACK_FAILED"
  | "SESSION_AUTHORITY_FAILED"
  | "PROBE_CALLBACK_FAILED"
  | "PROBE_RESULT_FAILED";

export interface ContinuityRequestContext {
  observationId: string;
  startedAt: string;
  transportFingerprint: string | null;
  requestIdFingerprint: string | null;
  logicalSessionKey: string | null;
  logicalFingerprint: string | null;
  connectorIdentityPresent: boolean;
}

const requestContext = new AsyncLocalStorage<ContinuityRequestContext>();

function scalarHeader(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestIdValue(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("id" in body)) return undefined;
  const id = (body as { id?: unknown }).id;
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  return String(id);
}

export function withContinuityRequestContext<T>(
  req: Request,
  action: () => Promise<T>
): Promise<T> {
  const transport = scalarHeader(req.headers["mcp-session-id"]);
  const logicalSessionKey = logicalConversationKeyFromRequest(req);
  const id = requestIdValue(req.body);
  const context: ContinuityRequestContext = {
    observationId: randomUUID(),
    startedAt: new Date().toISOString(),
    transportFingerprint: continuityFingerprint(transport),
    requestIdFingerprint: continuityFingerprint(id),
    logicalSessionKey,
    logicalFingerprint: continuityFingerprint(logicalSessionKey ?? undefined),
    connectorIdentityPresent: logicalSessionKey !== null,
  };
  return requestContext.run(context, action);
}

export function currentContinuityRequestContext():
  | ContinuityRequestContext
  | undefined {
  return requestContext.getStore();
}

function connectorBound(
  context: ContinuityRequestContext | undefined,
  serverSessionKey: string
): boolean {
  return Boolean(
    context?.connectorIdentityPresent &&
      context.logicalSessionKey &&
      context.logicalSessionKey === serverSessionKey
  );
}

export function logStage0EvidenceEvent(
  event: Stage0EvidenceEvent,
  serverSessionKey: string,
  fields: {
    toolName: "cadgpt_admission" | "job_list";
    success: boolean;
    claimed?: boolean;
    mode?: "active" | "control" | "inactive";
    launchMode?: string;
    failureCategory?: Stage0FailureCategory;
  }
): void {
  const context = currentContinuityRequestContext();
  const safeLaunchMode =
    fields.launchMode === "auto_bind" ||
    fields.launchMode === "cad_prepare" ||
    fields.launchMode === "ready" ||
    fields.launchMode === "offline"
      ? fields.launchMode
      : undefined;

  logContinuityDiagnostic(event, {
    schema_version: 1,
    observation_id: context?.observationId ?? null,
    request_started_at: context?.startedAt ?? null,
    transport_session: context?.transportFingerprint ?? null,
    request_id: context?.requestIdFingerprint ?? null,
    logical_session: context?.logicalFingerprint ?? null,
    connector_bound: connectorBound(context, serverSessionKey),
    connector_identity_present: context?.connectorIdentityPresent ?? false,
    tool_name: fields.toolName,
    success: fields.success,
    ...(typeof fields.claimed === "boolean" ? { claimed: fields.claimed } : {}),
    ...(fields.mode ? { mode: fields.mode } : {}),
    ...(safeLaunchMode ? { launch_mode: safeLaunchMode } : {}),
    ...(fields.failureCategory
      ? { failure_category: fields.failureCategory }
      : {}),
  });
}

function successfulProbeResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const value = result as {
    isError?: unknown;
    structuredContent?: { ok?: unknown };
  };
  return value.isError !== true && value.structuredContent?.ok === true;
}

export async function runSessionProbeWithEvidence(
  serverSessionKey: string,
  toolName: string,
  assertAuthority: () => void,
  action: () => Promise<any>
): Promise<any> {
  if (toolName !== "job_list") {
    assertAuthority();
    return action();
  }

  try {
    assertAuthority();
  } catch (error) {
    logStage0EvidenceEvent("session_probe_failed", serverSessionKey, {
      toolName: "job_list",
      success: false,
      claimed: false,
      failureCategory: "SESSION_AUTHORITY_FAILED",
    });
    throw error;
  }

  let result: any;
  try {
    result = await action();
  } catch (error) {
    logStage0EvidenceEvent("session_probe_failed", serverSessionKey, {
      toolName: "job_list",
      success: false,
      claimed: true,
      failureCategory: "PROBE_CALLBACK_FAILED",
    });
    throw error;
  }

  if (successfulProbeResult(result)) {
    logStage0EvidenceEvent("session_probe_completed", serverSessionKey, {
      toolName: "job_list",
      success: true,
      claimed: true,
    });
  } else {
    logStage0EvidenceEvent("session_probe_failed", serverSessionKey, {
      toolName: "job_list",
      success: false,
      claimed: true,
      failureCategory: "PROBE_RESULT_FAILED",
    });
  }

  return result;
}
