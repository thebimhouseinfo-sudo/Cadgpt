import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { cadUpstream } from "../runtime/cad-upstream.js";
import { ensureBoundDrawingActive } from "../session/drawing-binding.js";
import {
  appendObservationRecords,
  type ObservationLogRecord,
} from "./log-store.js";

function assertCadAvailable(): void {
  if (!cadUpstream.status().enabled) {
    throw new Error("CAD backend is sleeping. AutoCAD must be running and CadGPT must be active.");
  }
}

export async function startObservationCapture(server: McpServer): Promise<unknown> {
  assertCadAvailable();
  await ensureBoundDrawingActive(server);
  return cadUpstream.callTool("cad_observation_capture_start", {});
}

export async function observationCaptureStatus(): Promise<unknown> {
  assertCadAvailable();
  return cadUpstream.callTool("cad_observation_capture_status", {});
}

export async function finishObservationCapture(
  server: McpServer,
  includePaperSpace = true
): Promise<unknown> {
  assertCadAvailable();
  await ensureBoundDrawingActive(server);
  return cadUpstream.callTool("cad_observation_capture_finish", {
    include_paper_space: includePaperSpace,
  });
}

export async function cancelObservationCapture(): Promise<unknown> {
  assertCadAvailable();
  return cadUpstream.callTool("cad_observation_capture_cancel", {});
}

export async function readEntityProperties(
  server: McpServer,
  handles: string[],
  includePaperSpace = true
): Promise<unknown> {
  if (!Array.isArray(handles) || handles.length === 0) {
    throw new Error("handles must be a non-empty array");
  }
  assertCadAvailable();

  await ensureBoundDrawingActive(server);
  return cadUpstream.callTool("cad_read_entity_properties", {
    handles,
    include_paper_space: includePaperSpace,
  });
}

export async function writeObservationLog(
  drawingId: string,
  records: ObservationLogRecord[],
  logName = "entities"
) {
  return appendObservationRecords(drawingId, records, logName);
}
