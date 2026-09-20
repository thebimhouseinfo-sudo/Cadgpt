import { runtimeStateSnapshot } from "../lib/runtime-state.js";
import { hasActiveCadWork } from "../lib/work-registration.js";

export async function cleanupExecutionState(executionId: string): Promise<void> {
  const loaded = new Set(runtimeStateSnapshot().loaded_families);

  if (loaded.has("cad")) {
    try {
      const [{ clearExecutionDrawingContexts }, { releaseObservationForExecution }] =
        await Promise.all([
          import("../session/drawing-binding.js"),
          import("../observator/engine.js"),
        ]);
      await releaseObservationForExecution(executionId);
      clearExecutionDrawingContexts(executionId);
    } catch {
      // Cleanup remains best-effort; stale authority has already been revoked.
    }
  }

  if (loaded.has("cad-mcp-dev")) {
    try {
      const { clearCadMcpDevStateForExecution } = await import("../tools/cad-mcp-dev.js");
      clearCadMcpDevStateForExecution(executionId);
    } catch {
      // Development-only snapshot cleanup is best-effort.
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
