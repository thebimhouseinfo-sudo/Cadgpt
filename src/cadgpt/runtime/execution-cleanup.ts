import { runtimeStateSnapshot } from "../lib/runtime-state.js";
import {
  consumeHumanPowerCleanup,
  hasActiveCadWork,
} from "../lib/work-registration.js";

export interface ExecutionCleanupResult {
  execution_id: string;
  candidate_released: boolean;
  human_power_cleared: boolean;
  job_runtime_cleaned: boolean;
  job_runtime_cleanup?: Record<string, unknown>;
  drawing_metadata_cleaned: boolean;
  drawing_metadata_cleanup?: Record<string, unknown>;
  cad_state_cleared: boolean;
  cad_mcp_dev_restored: boolean;
  recovery_required: boolean;
  cad_backend_slept: boolean;
  errors: string[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function cleanupExecutionState(
  executionId: string
): Promise<ExecutionCleanupResult> {
  const loaded = new Set(runtimeStateSnapshot().loaded_families);
  const result: ExecutionCleanupResult = {
    execution_id: executionId,
    candidate_released: false,
    human_power_cleared: false,
    job_runtime_cleaned: false,
    drawing_metadata_cleaned: false,
    cad_state_cleared: false,
    cad_mcp_dev_restored: false,
    recovery_required: false,
    cad_backend_slept: false,
    errors: [],
  };

  const humanPower = consumeHumanPowerCleanup(executionId);
  if (humanPower) {
    try {
      const [{ logHumanPowerStop }, { cadUpstream }] =
        await Promise.all([
          import("./human-power.js"),
          import("./cad-upstream.js"),
        ]);
      await logHumanPowerStop(
        executionId,
        humanPower,
        "Work execution ended; Human Power automatically stopped."
      );
      if (
        cadUpstream.status().enabled ||
        cadUpstream.status().connected
      ) {
        await cadUpstream.deactivate();
      }
      result.human_power_cleared = true;
      result.cad_backend_slept = true;
    } catch (error) {
      result.errors.push(
        `Human Power cleanup: ${errorText(error)}`
      );
    }
  }

  try {
    const { releaseCadCandidateForExecution } = await import("./cad-candidate.js");
    await releaseCadCandidateForExecution(executionId);
    result.candidate_released = true;
  } catch (error) {
    result.errors.push(`candidate cleanup: ${errorText(error)}`);
  }

  try {
    const { cleanupJobRuntimeForExecution } = await import(
      "./job-runtime.js"
    );
    result.job_runtime_cleanup =
      await cleanupJobRuntimeForExecution(executionId);
    result.job_runtime_cleaned = true;
  } catch (error) {
    result.errors.push(
      `Job runtime cleanup: ${errorText(error)}`
    );
  }

  try {
    const { cleanupDrawingMetadataForExecution } = await import(
      "./drawing-persistence.js"
    );
    result.drawing_metadata_cleanup =
      await cleanupDrawingMetadataForExecution(executionId);
    result.drawing_metadata_cleaned = true;
  } catch (error) {
    result.errors.push(`drawing metadata cleanup: ${errorText(error)}`);
  }

  if (loaded.has("cad")) {
    try {
      const [
        { clearExecutionDrawingContexts },
        { releaseObservationForExecution },
        { clearExecutionCadProxyState },
      ] = await Promise.all([
        import("../session/drawing-binding.js"),
        import("../observator/engine.js"),
        import("../tools/cad-proxy.js"),
      ]);
      await releaseObservationForExecution(executionId);
      clearExecutionCadProxyState(executionId);
      clearExecutionDrawingContexts(executionId);
      result.cad_state_cleared = true;
    } catch (error) {
      result.errors.push(`CAD state cleanup: ${errorText(error)}`);
    }
  }

  if (loaded.has("cad-mcp-dev")) {
    try {
      const { rollbackUnacceptedCadMcpDevStateForExecution } = await import(
        "../tools/cad-mcp-dev.js"
      );
      const rollback =
        await rollbackUnacceptedCadMcpDevStateForExecution(executionId);
      result.cad_mcp_dev_restored = rollback.restored;
      if (rollback.restored) {
        console.warn(
          `[CAD MCP DEV] Restored unaccepted source snapshot during cleanup: ${executionId}`
        );
      }
    } catch (error) {
      result.recovery_required = true;
      result.errors.push(`CAD MCP dev rollback: ${errorText(error)}`);
      console.error(
        `[CAD MCP DEV] CRITICAL: automatic rollback failed for ${executionId}; snapshot retained for recovery.`,
        error
      );
    }
  }

  if (loaded.has("cad") && !hasActiveCadWork()) {
    try {
      const { cadUpstream } = await import("./cad-upstream.js");
      if (cadUpstream.status().enabled || cadUpstream.status().connected) {
        await cadUpstream.deactivate();
      }
      result.cad_backend_slept = true;
    } catch (error) {
      result.errors.push(`CAD backend sleep: ${errorText(error)}`);
    }
  }

  return result;
}
