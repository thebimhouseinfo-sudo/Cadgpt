import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { currentToolLease } from "../lib/work-registration.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { assertCadRuntimeGenerationAccess } from "../runtime/cad-candidate.js";
import { cadUpstream } from "../runtime/cad-upstream.js";
import { withCadHostLock } from "../runtime/cad-scheduler.js";
import { resolveDrawingContext } from "../session/drawing-binding.js";
import { prepareDrawingMetadataLocation } from "../runtime/drawing-persistence.js";

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
        "Return and authorize the canonical %LOCALAPPDATA%/CadGPT/drawings/<drawing_anchor>/ root for the exact bound drawing. The tool re-validates the Drawing Anchor and creates the drawing root only when it does not already exist. Jobs/models must use the returned absolute_path instead of constructing drawing metadata paths themselves.",
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
}
