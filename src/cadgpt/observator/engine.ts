import { cadUpstream } from "../runtime/cad-upstream.js";
import { withCadHostLock } from "../runtime/cad-scheduler.js";
import { currentToolLease } from "../lib/work-registration.js";
import {
  assertCadRuntimeGenerationAccess,
  recordCadCandidateSuccess,
} from "../runtime/cad-candidate.js";
import {
  activateDrawingContext,
  resolveDrawingContext,
} from "../session/drawing-binding.js";
import {
  appendObservationRecords,
  type ObservationLogRecord,
} from "./log-store.js";

function isToolErrorResult(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { isError?: boolean }).isError === true
  );
}

async function forceResetCadBackend(reason: string): Promise<void> {
  console.warn(`[Observator] Resetting CAD MCP backend after capture cleanup failure: ${reason}`);
  await cadUpstream.deactivate().catch(() => undefined);
}

async function cancelCaptureFailSafe(): Promise<void> {
  try {
    const result = await cadUpstream.callTool("cad_observation_capture_cancel", {});
    if (isToolErrorResult(result)) {
      await forceResetCadBackend("cad_observation_capture_cancel returned isError");
    }
  } catch (error) {
    await forceResetCadBackend(
      error instanceof Error ? error.message : String(error)
    );
  }
}

interface CaptureOwner {
  workId: string;
  drawingId: string;
  host: string;
}

const captureOwners = new Map<string, CaptureOwner>();

async function ensureCadAvailable(): Promise<void> {
  const lease = currentToolLease();
  assertCadRuntimeGenerationAccess(lease.workId);
  const status = cadUpstream.status();
  if (status.enabled && status.connected) return;
  await cadUpstream.activate();
}

function ownerForCurrentWork(): CaptureOwner | undefined {
  const lease = currentToolLease();
  return [...captureOwners.values()].find((owner) => owner.workId === lease.workId);
}

function assertOwnedCapture(drawingId?: string): CaptureOwner {
  const lease = currentToolLease();
  const owner = ownerForCurrentWork();
  if (!owner) {
    throw new Error("NO_OWNED_OBSERVATION_CAPTURE: this execution does not own an active Observation capture.");
  }
  if (owner.workId !== lease.workId) {
    throw new Error("OBSERVATION_CAPTURE_OWNERSHIP: active capture belongs to another execution.");
  }
  if (drawingId && owner.drawingId !== drawingId) {
    throw new Error("OBSERVATION_CAPTURE_OWNERSHIP: drawing_id does not match this execution's active capture.");
  }
  return owner;
}

export async function startObservationCapture(
  drawingId?: string
): Promise<unknown> {
  await ensureCadAvailable();
  const lease = currentToolLease();
  const binding = resolveDrawingContext(drawingId);

  return withCadHostLock(binding.host, async () => {
    const current = captureOwners.get(binding.host);
    if (current && current.workId !== lease.workId) {
      throw new Error(
        "OBSERVATION_CAPTURE_BUSY: another CadGPT execution owns the active Observation capture for this AutoCAD host."
      );
    }
    if (current && current.workId === lease.workId) {
      throw new Error(
        "OBSERVATION_CAPTURE_ACTIVE: this execution already owns an active Observation capture."
      );
    }

    await activateDrawingContext(binding);
    const result = await cadUpstream.callTool("cad_observation_capture_start", {});
    if (isToolErrorResult(result)) {
      return result;
    }
    recordCadCandidateSuccess(lease.workId, "observator_capture_start");
    captureOwners.set(binding.host, {
      workId: lease.workId,
      drawingId: binding.drawing_id,
      host: binding.host,
    });
    return result;
  });
}

export async function observationCaptureStatus(): Promise<unknown> {
  await ensureCadAvailable();
  const owner = ownerForCurrentWork();
  if (!owner) {
    return {
      active: false,
      stage: "idle_for_this_execution",
      note: "No Observation capture is owned by this CadGPT work execution.",
    };
  }

  return withCadHostLock(owner.host, async () => {
    const result = await cadUpstream.callTool("cad_observation_capture_status", {});
    const payload =
      result && typeof result === "object"
        ? (result as { structuredContent?: unknown }).structuredContent
        : undefined;
    const active =
      payload && typeof payload === "object"
        ? Boolean(
            (payload as Record<string, unknown>).active ??
              ((payload as Record<string, unknown>).data as Record<string, unknown> | undefined)?.active
          )
        : true;
    if (!active) captureOwners.delete(owner.host);
    return result;
  });
}

export async function finishObservationCapture(
  drawingId?: string,
  includePaperSpace = true
): Promise<unknown> {
  await ensureCadAvailable();
  const owner = assertOwnedCapture(drawingId);
  const binding = resolveDrawingContext(owner.drawingId);

  return withCadHostLock(owner.host, async () => {
    await activateDrawingContext(binding);
    try {
      const result = await cadUpstream.callTool("cad_observation_capture_finish", {
        include_paper_space: includePaperSpace,
      });
      if (isToolErrorResult(result)) {
        await cancelCaptureFailSafe();
      } else {
        recordCadCandidateSuccess(currentToolLease().workId, "observator_capture_finish");
      }
      return result;
    } catch (error) {
      await cancelCaptureFailSafe();
      throw error;
    } finally {
      captureOwners.delete(owner.host);
    }
  });
}

export async function cancelObservationCapture(): Promise<unknown> {
  await ensureCadAvailable();
  const owner = assertOwnedCapture();

  return withCadHostLock(owner.host, async () => {
    try {
      const result = await cadUpstream.callTool("cad_observation_capture_cancel", {});
      if (isToolErrorResult(result)) {
        await forceResetCadBackend("explicit Observation cancel returned isError");
      } else {
        recordCadCandidateSuccess(currentToolLease().workId, "observator_capture_cancel");
      }
      return result;
    } catch (error) {
      await forceResetCadBackend(
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    } finally {
      captureOwners.delete(owner.host);
    }
  });
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
    const result = await cadUpstream.callTool("cad_read_entity_properties", {
      handles,
      include_paper_space: includePaperSpace,
    });
    if (!isToolErrorResult(result)) {
      recordCadCandidateSuccess(currentToolLease().workId, "observator_read_entities");
    }
    return result;
  });
}

export async function writeObservationLog(
  drawingId: string,
  records: ObservationLogRecord[],
  logName = "entities"
) {
  const binding = resolveDrawingContext(drawingId);
  return appendObservationRecords(binding.drawing_id, records, logName);
}

export async function releaseObservationForExecution(executionId: string): Promise<void> {
  const owned = [...captureOwners.entries()].filter(([, owner]) => owner.workId === executionId);
  for (const [host] of owned) {
    try {
      if (cadUpstream.status().connected) {
        await withCadHostLock(host, async () => {
          const result = await cadUpstream.callTool("cad_observation_capture_cancel", {});
          if (isToolErrorResult(result)) {
            await forceResetCadBackend("work cleanup cancel returned isError");
          }
        });
      }
    } catch {
      // Cleanup is best-effort. Ownership must still be released so future work is not blocked.
    } finally {
      captureOwners.delete(host);
    }
  }
}

export function clearAllObservationOwnership(): void {
  captureOwners.clear();
}
