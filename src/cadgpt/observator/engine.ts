import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { cadUpstream } from "../runtime/cad-upstream.js";
import { ensureBoundDrawingActive } from "../session/drawing-binding.js";
import {
  appendObservationRecords,
  type ObservationLogRecord,
} from "./log-store.js";

export async function readEntityProperties(
  server: McpServer,
  handles: string[],
  includePaperSpace = true
): Promise<unknown> {
  if (!Array.isArray(handles) || handles.length === 0) {
    throw new Error("handles must be a non-empty array");
  }
  if (!cadUpstream.status().enabled) {
    throw new Error("CAD backend is sleeping. AutoCAD must be running and CadGPT must be active.");
  }

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
