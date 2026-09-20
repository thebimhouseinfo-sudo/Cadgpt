import { runtimeStateSnapshot } from "../lib/runtime-state.js";
import { hasActiveCadWork } from "../lib/work-registration.js";

export async function cleanupExecutionState(executionId: string): Promise<void> {
  const loaded = new Set(runtimeStateSnapshot().loaded_families);

  try {
    const { releaseCadCandidateForExecution } = await import("./cad-candidate.js");
    await releaseCadCandidateForExecution(executionId);
  } catch {
    // Candidate ownership cleanup is best-effort.
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
    } catch {
      // Cleanup remains best-effort; stale authority has already been revoked.
    }
  }

  if (loaded.has("cad-mcp-dev")) {
    try {
      const { rollbackUnacceptedCadMcpDevStateForExecution } = await import("../tools/cad-mcp-dev.js");
      const rollback = await rollbackUnacceptedCadMcpDevStateForExecution(executionId);
      if (rollback.restored) {
        console.warn(
          `[CAD MCP DEV] Restored unaccepted source snapshot during cleanup: ${executionId}`
        );
      }
    } catch (error) {
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
    } catch {
      // Do not fail work/session cleanup if CAD MCP shutdown itself fails.
    }
  }
}
