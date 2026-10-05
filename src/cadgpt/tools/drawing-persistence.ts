import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { currentToolLease } from "../lib/work-registration.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { assertCadRuntimeGenerationAccess } from "../runtime/cad-candidate.js";
import { cadUpstream } from "../runtime/cad-upstream.js";
import { withCadHostLock } from "../runtime/cad-scheduler.js";
import { resolveDrawingContext } from "../session/drawing-binding.js";
import { prepareDrawingMetadataLocation } from "../runtime/drawing-persistence.js";
import { prepareJobResultLocationForExecution } from "../runtime/job-runtime.js";

async function ensureCadRuntimeActive(): Promise<void> {
  const lease = currentToolLease();
  assertCadRuntimeGenerationAccess(lease.workId);
  const status = cadUpstream.status();
  if (status.enabled && status.connected) return;
  await cadUpstream.activate();
}

export function registerDrawingPersistenceTools(
  server: McpServer
): void {
  server.registerTool(
    "drawing_metadata_location",
    {
      title: "Resolve Drawing Metadata Location",
      description:
        "Return and authorize the canonical %LOCALAPPDATA%/CadGPT/drawings/<drawing_anchor>/ root for the exact bound drawing. The tool re-validates the Drawing Anchor and creates the drawing root only when it does not already exist. Callers must use the returned root instead of constructing drawing paths themselves; running Jobs publish final products through drawing_job_result_location.",
      inputSchema: {
        drawing_id: z
          .string()
          .optional()
          .describe(
            "Execution-scoped runtime drawing_id. Required only when this execution owns more than one drawing context."
          ),
      },
    },
    async ({ drawing_id }) => {
      try {
        await ensureCadRuntimeActive();
        const lease = currentToolLease();
        const binding = resolveDrawingContext(drawing_id);
        return await withCadHostLock(binding.host, async () => {
          const location = await prepareDrawingMetadataLocation(
            lease.workId,
            binding
          );
          return toolResult(
            "drawing_metadata_location",
            location
          );
        });
      } catch (error) {
        return toolError("drawing_metadata_location", error);
      }
    }
  );

  server.registerTool(
    "drawing_job_result_location",
    {
      title: "Resolve Job Result Location",
      description:
        "Resolve/create the current Job's final persistent result namespace under the exact tool-provided drawing root: <drawing-root>/jobs/<job-name>-result/. The current Job runtime must already be prepared. This tool owns the namespace path; Jobs must not construct the drawing root themselves.",
      inputSchema: {
        drawing_id: z
          .string()
          .optional()
          .describe(
            "Execution-scoped runtime drawing_id. Required only when this execution owns more than one drawing context."
          ),
      },
    },
    async ({ drawing_id }) => {
      try {
        await ensureCadRuntimeActive();
        const lease = currentToolLease();
        const binding =
          resolveDrawingContext(drawing_id);
        return await withCadHostLock(
          binding.host,
          async () => {
            const drawingLocation =
              await prepareDrawingMetadataLocation(
                lease.workId,
                binding
              );
            const resultLocation =
              await prepareJobResultLocationForExecution(
                lease.workId,
                String(
                  drawingLocation.absolute_path
                )
              );
            return toolResult(
              "drawing_job_result_location",
              {
                drawing_id:
                  binding.drawing_id,
                drawing_anchor:
                  drawingLocation.drawing_anchor,
                drawing_root:
                  drawingLocation.absolute_path,
                ...resultLocation,
              }
            );
          }
        );
      } catch (error) {
        return toolError(
          "drawing_job_result_location",
          error
        );
      }
    }
  );
}
