import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolError, toolResult } from "../lib/tool-result.js";
import {
  cancelObservationCapture,
  finishObservationCapture,
  observationCaptureStatus,
  readEntityProperties,
  startObservationCapture,
  writeObservationLog,
} from "../observator/engine.js";

function extractUpstreamData(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object") {
    const objectResult = result as {
      structuredContent?: unknown;
      content?: Array<{ type?: string; text?: string }>;
    };

    if (objectResult.structuredContent && typeof objectResult.structuredContent === "object") {
      const structured = objectResult.structuredContent as Record<string, unknown>;
      const data = structured.data;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        return data as Record<string, unknown>;
      }
      return structured;
    }

    for (const item of objectResult.content ?? []) {
      if (item?.type !== "text" || typeof item.text !== "string") continue;
      try {
        const parsed = JSON.parse(item.text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>;
          const data = record.data;
          if (data && typeof data === "object" && !Array.isArray(data)) {
            return data as Record<string, unknown>;
          }
          return record;
        }
      } catch {
        // Keep looking; raw fallback below preserves the upstream response.
      }
    }
  }

  return { upstream: result };
}

export function registerObservatorTools(server: McpServer): void {
  server.registerTool(
    "observator_capture_start",
    {
      title: "Start Observation Capture",
      description:
        "Start lightweight ObjectAdded capture on the explicitly bound drawing. During capture only new-object identities are retained; no full-drawing scan or deep property read occurs.",
      inputSchema: {},
    },
    async () => {
      try {
        const upstream = await startObservationCapture(server);
        return toolResult("observator_capture_start", extractUpstreamData(upstream));
      } catch (error) {
        return toolError("observator_capture_start", error);
      }
    }
  );

  server.registerTool(
    "observator_capture_status",
    {
      title: "Observation Capture Status",
      description:
        "Return whether lightweight Observation capture is active and how many new-object identities have been seen so far.",
      inputSchema: {},
    },
    async () => {
      try {
        const upstream = await observationCaptureStatus();
        return toolResult("observator_capture_status", extractUpstreamData(upstream));
      } catch (error) {
        return toolError("observator_capture_status", error);
      }
    }
  );

  server.registerTool(
    "observator_capture_finish",
    {
      title: "Finish Observation Capture",
      description:
        "Stop capture and return only surviving top-level candidate headers created since capture start. Erased/undone/nested/block-definition objects are filtered without enumerating the whole drawing.",
      inputSchema: {
        include_paper_space: z.boolean().default(true),
      },
    },
    async ({ include_paper_space }) => {
      try {
        const upstream = await finishObservationCapture(server, include_paper_space);
        return toolResult("observator_capture_finish", extractUpstreamData(upstream));
      } catch (error) {
        return toolError("observator_capture_finish", error);
      }
    }
  );

  server.registerTool(
    "observator_capture_cancel",
    {
      title: "Cancel Observation Capture",
      description:
        "Stop the active Observation capture and discard collected identities without finalizing candidates.",
      inputSchema: {},
    },
    async () => {
      try {
        const upstream = await cancelObservationCapture();
        return toolResult("observator_capture_cancel", extractUpstreamData(upstream));
      } catch (error) {
        return toolError("observator_capture_cancel", error);
      }
    }
  );

  server.registerTool(
    "observator_read_entities",
    {
      title: "Read Entity Properties",
      description:
        "Read all discoverable direct properties for one or many top-level entities in the explicitly bound drawing. Handles are resolved directly; no full-drawing scan and no nested entity traversal.",
      inputSchema: {
        handles: z.array(z.string().min(1)).min(1),
        include_paper_space: z.boolean().default(true),
      },
    },
    async ({ handles, include_paper_space }) => {
      try {
        const upstream = await readEntityProperties(server, handles, include_paper_space);
        return toolResult("observator_read_entities", extractUpstreamData(upstream));
      } catch (error) {
        return toolError("observator_read_entities", error);
      }
    }
  );

  server.registerTool(
    "observator_log_append",
    {
      title: "Append Observator Log",
      description:
        "Append Job-selected entity records to AppData/drawings/<drawing_id>/observator/<log_name>.jsonl. The caller decides which candidates and properties are persisted.",
      inputSchema: {
        drawing_id: z.string().min(1),
        records: z.array(z.object({}).passthrough()).min(1),
        log_name: z.string().min(1).default("entities"),
      },
    },
    async ({ drawing_id, records, log_name }) => {
      try {
        const result = await writeObservationLog(drawing_id, records, log_name);
        return toolResult("observator_log_append", result);
      } catch (error) {
        return toolError("observator_log_append", error);
      }
    }
  );
}
