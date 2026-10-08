import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getGlobalKnowledgeRoot, getDrawingKnowledgeRoot, listKnowledgeEntries, readKnowledgeEntry, upsertKnowledgeEntry } from "../lib/knowledge-storage.js";
import { currentToolLease } from "../lib/work-registration.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { assertCadRuntimeGenerationAccess } from "../runtime/cad-candidate.js";
import { cadUpstream } from "../runtime/cad-upstream.js";
import { withCadHostLock } from "../runtime/cad-scheduler.js";
import { prepareDrawingMetadataLocation } from "../runtime/drawing-persistence.js";
import { getDrawingStorageRoot } from "../lib/appdata.js";
import { resolveDrawingContext } from "../session/drawing-binding.js";
import path from "node:path";
import fs from "node:fs/promises";

const scopeSchema = z.enum(["global", "drawing"]);
const drawingIdSchema = z.string().optional().describe("Bound drawing_id; KUD must use the current explicitly bound drawing, never an ambient active tab.");

async function resolveKnowledgeRoot(scope: "global" | "drawing", drawingId?: string) {
  if (scope === "global") {
    return { root: getGlobalKnowledgeRoot(), scope };
  }
  const lease = currentToolLease();
  assertCadRuntimeGenerationAccess(lease.workId);
  const status = cadUpstream.status();
  if (!status.enabled || !status.connected) await cadUpstream.activate();
  const binding = resolveDrawingContext(drawingId);
  return await withCadHostLock(binding.host, async () => {
    const location = await prepareDrawingMetadataLocation(lease.workId, binding);
    const anchor = String(location.drawing_anchor);
    // Reject a drawing-root junction that aliases a different drawing's knowledge.
    const drawingRoot = path.resolve(String(location.absolute_path));
    const actualRoot = await fs.realpath(drawingRoot);
    const storageRoot = await fs.realpath(getDrawingStorageRoot());
    if (path.dirname(actualRoot) !== storageRoot || path.basename(actualRoot) !== anchor) {
      throw new Error("DRAWING_KNOWLEDGE_SCOPE: bound drawing storage identity was redirected.");
    }
    return {
      root: getDrawingKnowledgeRoot(drawingRoot, anchor),
      scope,
      drawing_anchor: anchor,
      drawing_id: binding.drawing_id,
    };
  });
}

export function registerKnowledgeTools(server: McpServer): void {
  server.registerTool("knowledge_list", {
    title: "List HVAC Domain Knowledge",
    description: "KUG/KUD: list persisted HVAC knowledge entries. Global does not require CAD. Drawing scope revalidates the exact bound drawing anchor via CAD MCP. Internal Lisp/API/MCP knowledge does not belong here.",
    inputSchema: { scope: scopeSchema, drawing_id: drawingIdSchema },
  }, async ({ scope, drawing_id }) => {
    try {
      const location = await resolveKnowledgeRoot(scope, drawing_id);
      return toolResult("knowledge_list", { scope, drawing_anchor: "drawing_anchor" in location ? location.drawing_anchor : null, entries: await listKnowledgeEntries(location.root) });
    } catch (error) { return toolError("knowledge_list", error); }
  });

  server.registerTool("knowledge_read", {
    title: "Read HVAC Domain Knowledge",
    description: "Read one HVAC knowledge entry and its sha256. Before changing an entry, read it and supply that sha256 to knowledge_upsert.",
    inputSchema: { scope: scopeSchema, drawing_id: drawingIdSchema, key: z.string() },
  }, async ({ scope, drawing_id, key }) => {
    try {
      const location = await resolveKnowledgeRoot(scope, drawing_id);
      return toolResult("knowledge_read", { scope, drawing_anchor: "drawing_anchor" in location ? location.drawing_anchor : null, entry: await readKnowledgeEntry(location.root, key) });
    } catch (error) { return toolError("knowledge_read", error); }
  });

  server.registerTool("knowledge_upsert", {
    title: "Save HVAC Domain Knowledge",
    description: "KUG/KUD dedicated guarded create/update. Show the proposed knowledge and differences to the human and receive approval BEFORE calling. expected_sha256='' creates only if absent; an update requires the exact sha256 from knowledge_read. For KUD the current bound anchor is verified on every call. Never write CAD API, AutoLISP, Lisp Writer or MCP Fixer internals.",
    inputSchema: {
      scope: scopeSchema,
      drawing_id: drawingIdSchema,
      key: z.string(),
      title: z.string().max(120),
      body: z.string().max(80_000),
      source: z.enum(["user_confirmed", "reference", "drawing_observation"]),
      source_note: z.string().min(1).max(2000),
      expected_sha256: z.string().describe("Empty for a new document; exact hash from knowledge_read for any update."),
    },
  }, async ({ scope, drawing_id, key, title, body, source, source_note, expected_sha256 }) => {
    try {
      const location = await resolveKnowledgeRoot(scope, drawing_id);
      const saved = await upsertKnowledgeEntry({
        root: location.root, scope, drawingAnchor: "drawing_anchor" in location ? location.drawing_anchor : undefined,
        key, title, body, source, sourceNote: source_note, expectedSha256: expected_sha256,
      });
      return toolResult("knowledge_upsert", saved);
    } catch (error) { return toolError("knowledge_upsert", error); }
  });
}
