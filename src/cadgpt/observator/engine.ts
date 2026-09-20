import { cadUpstream } from "../runtime/cad-upstream.js";
import { withCadHostLock } from "../runtime/cad-scheduler.js";
import {
  activateDrawingContext,
  resolveDrawingContext,
} from "../session/drawing-binding.js";
import {
  appendObservationRecords,
  type ObservationLogRecord,
} from "./log-store.js";

async function ensureCadAvailable(): Promise<void> {
  const status = cadUpstream.status();
  if (status.enabled && status.connected) return;
  await cadUpstream.activate();
}

export async function startObservationCapture(
  drawingId?: string
): Promise<unknown> {
  await ensureCadAvailable();
  const binding = resolveDrawingContext(drawingId);
  return withCadHostLock(binding.host, async () => {
    await activateDrawingContext(binding);
    return cadUpstream.callTool("cad_observation_capture_start", {});
  });
}

export async function observationCaptureStatus(): Promise<unknown> {
  await ensureCadAvailable();
  return cadUpstream.callTool("cad_observation_capture_status", {});
}

export async function finishObservationCapture(
  drawingId?: string,
  includePaperSpace = true
): Promise<unknown> {
  await ensureCadAvailable();
  const binding = resolveDrawingContext(drawingId);
  return withCadHostLock(binding.host, async () => {
    await activateDrawingContext(binding);
    return cadUpstream.callTool("cad_observation_capture_finish", {
      include_paper_space: includePaperSpace,
    });
  });
}

export async function cancelObservationCapture(): Promise<unknown> {
  await ensureCadAvailable();
  return cadUpstream.callTool("cad_observation_capture_cancel", {});
}

export async function readEntityProperties(
  drawingId: string | undefined,
  handles: string[],
  includePaperSpace = true
): Promise<unknown> {
  if (!Array.isArray(handles) || handles.length === 0) {
    throw new Error("handles must be a non-empty array");
  }
  await ensureCadAvailable();
  const binding = resolveDrawingContext(drawingId);
  return withCadHostLock(binding.host, async () => {
    await activateDrawingContext(binding);
    return cadUpstream.callTool("cad_read_entity_properties", {
      handles,
      include_paper_space: includePaperSpace,
    });
  });
}

export async function writeObservationLog(
  drawingId: string,
  records: ObservationLogRecord[],
  logName = "entities"
) {
  return appendObservationRecords(drawingId, records, logName);
}
