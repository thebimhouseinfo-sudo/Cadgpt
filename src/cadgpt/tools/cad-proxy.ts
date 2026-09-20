import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { cadUpstream } from "../runtime/cad-upstream.js";
import { withCadHostLock } from "../runtime/cad-scheduler.js";
import { getRepoRoot } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { currentToolLease } from "../lib/work-registration.js";
import { assertCadCandidateAccess, recordCadCandidateSuccess } from "../runtime/cad-candidate.js";
import {
  activateDrawingContext,
  bindDrawing,
  drawingBindingStatus,
  listOpenDrawings,
  resolveDrawingContext,
} from "../session/drawing-binding.js";

const proxyRegistry = new WeakMap<McpServer, Map<string, RegisteredTool>>();
const INTERNAL_UPSTREAM_TOOLS = new Set([
  // Outer CadGPT owns document discovery/binding/lifetime identity.
  "acad_get_active_document",
  "acad_list_open_documents",
  "acad_set_active_document",
  "acad_create_blank_test_document",

  // Outer Observator owns capture lifecycle, execution ownership and cleanup.
  "cad_observation_capture_start",
  "cad_observation_capture_status",
  "cad_observation_capture_finish",
  "cad_observation_capture_cancel",
  "cad_read_entity_properties",

  // Outer CadGPT owns destructive preview token execution scope.
  "cad_preview_delete_entities",
  "cad_execute_delete_preview",
]);

interface ToolManifest {
  version: number;
  tools: Tool[];
}

interface DeletePreviewOwner {
  workId: string;
  drawingId: string;
  host: string;
  acquiredAt: string;
  expiresAtMs: number;
}

const deletePreviewOwners = new Map<string, DeletePreviewOwner>();

function purgeExpiredDeletePreviewOwners(): void {
  const now = Date.now();
  for (const [token, owner] of deletePreviewOwners) {
    if (owner.expiresAtMs <= now) deletePreviewOwners.delete(token);
  }
}

function extractUpstreamPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as {
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (obj.structuredContent !== undefined) return obj.structuredContent;
  const text = obj.content?.find(
    (item) => item.type === "text" && typeof item.text === "string"
  )?.text;
  if (text === undefined) return raw;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function findPayloadField(raw: unknown, field: string, depth = 0): unknown {
  if (depth > 4 || raw === null || raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = findPayloadField(item, field, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  if (field in obj) return obj[field];
  for (const value of Object.values(obj)) {
    const found = findPayloadField(value, field, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function loadManifest(): ToolManifest {
  const manifestPath = path.join(
    getRepoRoot(),
    "runtimes",
    "cad-mcp",
    "tool-manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      "CAD tool manifest is missing. Run setup.bat or the scoped CAD MCP manifest generation action."
    );
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ToolManifest;
  if (!Array.isArray(parsed.tools)) {
    throw new Error("CAD tool manifest is invalid: tools[] missing");
  }
  return parsed;
}

export function hasCadProxySurface(server: McpServer): boolean {
  return proxyRegistry.has(server);
}

function registryFor(server: McpServer): Map<string, RegisteredTool> {
  let registry = proxyRegistry.get(server);
  if (!registry) {
    registry = new Map();
    proxyRegistry.set(server, registry);
  }
  return registry;
}

function isToolErrorResult(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { isError?: boolean }).isError === true
  );
}

function schemaNodeToZod(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.any();
  const node = schema as {
    type?: string | string[];
    description?: string;
    enum?: unknown[];
    const?: unknown;
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
    anyOf?: unknown[];
    oneOf?: unknown[];
    nullable?: boolean;
    default?: unknown;
  };

  let field: z.ZodTypeAny;
  const literalValues = Array.isArray(node.enum)
    ? node.enum.filter(
        (value): value is string | number | boolean | null =>
          value === null || ["string", "number", "boolean"].includes(typeof value)
      )
    : [];

  if (
    node.const === null ||
    ["string", "number", "boolean"].includes(typeof node.const)
  ) {
    field = z.literal(node.const as string | number | boolean | null);
  } else if (literalValues.length === 1) {
    field = z.literal(literalValues[0]);
  } else if (literalValues.length > 1) {
    const literals = literalValues.map((value) => z.literal(value));
    field = z.union(
      literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
    );
  } else if ((node.oneOf ?? node.anyOf)?.length) {
    const options = (node.oneOf ?? node.anyOf)!.map(schemaNodeToZod);
    field =
      options.length === 1
        ? options[0]
        : z.union(
            options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
          );
  } else {
    const types = Array.isArray(node.type)
      ? node.type
      : node.type
        ? [node.type]
        : [];
    const primary = types.find((item) => item !== "null");
    if (primary === "string") field = z.string();
    else if (primary === "number") field = z.number();
    else if (primary === "integer") field = z.number().int();
    else if (primary === "boolean") field = z.boolean();
    else if (primary === "array") {
      field = z.array(schemaNodeToZod(node.items));
    } else if (primary === "object" || node.properties) {
      const required = new Set(node.required ?? []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        const childSchema = schemaNodeToZod(child);
        shape[key] = required.has(key) ? childSchema : childSchema.optional();
      }
      field = z.object(shape).passthrough();
    } else if (primary === "null") field = z.null();
    else field = z.any();
    if (types.includes("null") || node.nullable) field = field.nullable();
  }

  if (node.default !== undefined && node.default !== null) {
    field = field.default(node.default as never);
  }
  return node.description ? field.describe(node.description) : field;
}

function schemaToShape(
  schema: Tool["inputSchema"]
): Record<string, z.ZodTypeAny> {
  if (!schema || typeof schema !== "object") return {};
  const root = schema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const required = new Set(root.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, node] of Object.entries(root.properties ?? {})) {
    const child = schemaNodeToZod(node);
    shape[key] = required.has(key) ? child : child.optional();
  }
  return shape;
}

export async function ensureCadRuntimeActive(): Promise<void> {
  const lease = currentToolLease();
  assertCadCandidateAccess(lease.workId);
  const status = cadUpstream.status();
  if (status.enabled && status.connected) return;
  await activateCadRuntime();
}

export function syncCadBusinessProxies(server: McpServer): string[] {
  const registry = registryFor(server);
  const manifestTools = loadManifest().tools;
  const desiredTools = manifestTools.filter(
    (tool) => !INTERNAL_UPSTREAM_TOOLS.has(tool.name)
  );
  const destructiveAvailable = new Set(
    manifestTools
      .map((tool) => tool.name)
      .filter(
        (name) =>
          name === "cad_preview_delete_entities" ||
          name === "cad_execute_delete_preview"
      )
  );
  const desiredNames = new Set(desiredTools.map((tool) => `cad__${tool.name}`));
  for (const name of destructiveAvailable) desiredNames.add(`cad__${name}`);

  for (const [name, registered] of registry) {
    if (desiredNames.has(name)) continue;
    registered.remove();
    registry.delete(name);
  }

  const publicNames: string[] = [];

  for (const tool of desiredTools) {
    const publicName = `cad__${tool.name}`;
    publicNames.push(publicName);

    const prior = registry.get(publicName);
    if (prior) {
      prior.remove();
      registry.delete(publicName);
    }

    const registered = server.registerTool(
      publicName,
      {
        title: tool.title ?? tool.name,
        description:
          `[CAD MCP / execution-scoped drawing context] ${tool.description ?? tool.name}`,
        inputSchema: {
          ...schemaToShape(tool.inputSchema),
          drawing_id: z
            .string()
            .optional()
            .describe(
              "Execution-scoped drawing_id returned by drawing_bind. Required when more than one drawing is bound."
            ),
        },
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        try {
          await ensureCadRuntimeActive();
          const drawingId =
            typeof args.drawing_id === "string" ? args.drawing_id : undefined;
          const binding = resolveDrawingContext(drawingId);
          const upstreamArgs = { ...args };
          delete upstreamArgs.drawing_id;

          return await withCadHostLock(binding.host, async () => {
            await activateDrawingContext(binding);
            const result = (await cadUpstream.callTool(tool.name, upstreamArgs)) as any;
            if (!isToolErrorResult(result)) {
              recordCadCandidateSuccess(currentToolLease().workId, publicName);
            }
            return result;
          });
        } catch (error) {
          return toolError(publicName, error);
        }
      }
    );
    registry.set(publicName, registered);
  }

  const previewPublicName = "cad__cad_preview_delete_entities";
  if (destructiveAvailable.has("cad_preview_delete_entities")) {
    const prior = registry.get(previewPublicName);
    if (prior) {
      prior.remove();
      registry.delete(previewPublicName);
    }
    const registered = server.registerTool(
      previewPublicName,
      {
        title: "Preview Delete Entities",
        description:
          "[CAD MCP / execution-owned destructive token] Preview a guarded entity deletion on one bound drawing. The returned token belongs only to this work execution and drawing context.",
        inputSchema: {
          filter: z.record(z.string(), z.unknown()),
          include_paper_space: z.boolean().optional().default(false),
          drawing_id: z.string().optional(),
        },
      },
      async ({ filter, include_paper_space, drawing_id }) => {
        try {
          await ensureCadRuntimeActive();
          const binding = resolveDrawingContext(drawing_id);
          return await withCadHostLock(binding.host, async () => {
            await activateDrawingContext(binding);
            const result = await cadUpstream.callTool(
              "cad_preview_delete_entities",
              {
                filter,
                include_paper_space,
              }
            );
            if (!isToolErrorResult(result)) {
              const token = findPayloadField(
                extractUpstreamPayload(result),
                "token"
              );
              if (typeof token === "string" && token.trim()) {
                purgeExpiredDeletePreviewOwners();
                const expiresRaw = findPayloadField(
                  extractUpstreamPayload(result),
                  "expires_in_seconds"
                );
                const expiresInSeconds =
                  typeof expiresRaw === "number" && Number.isFinite(expiresRaw)
                    ? Math.max(1, expiresRaw)
                    : 300;
                deletePreviewOwners.set(token, {
                  workId: currentToolLease().workId,
                  drawingId: binding.drawing_id,
                  host: binding.host,
                  acquiredAt: new Date().toISOString(),
                  expiresAtMs: Date.now() + expiresInSeconds * 1000,
                });
              }
              recordCadCandidateSuccess(
                currentToolLease().workId,
                previewPublicName
              );
            }
            return result as any;
          });
        } catch (error) {
          return toolError(previewPublicName, error);
        }
      }
    );
    registry.set(previewPublicName, registered);
    publicNames.push(previewPublicName);
  }

  const executePublicName = "cad__cad_execute_delete_preview";
  if (destructiveAvailable.has("cad_execute_delete_preview")) {
    const prior = registry.get(executePublicName);
    if (prior) {
      prior.remove();
      registry.delete(executePublicName);
    }
    const registered = server.registerTool(
      executePublicName,
      {
        title: "Execute Delete Preview",
        description:
          "[CAD MCP / execution-owned destructive token] Execute one previously previewed one-shot delete token. The token must belong to this exact work execution and drawing context.",
        inputSchema: {
          token: z.string().min(1),
          drawing_id: z.string().optional(),
        },
      },
      async ({ token, drawing_id }) => {
        try {
          await ensureCadRuntimeActive();
          purgeExpiredDeletePreviewOwners();
          const owner = deletePreviewOwners.get(token);
          if (!owner || owner.workId !== currentToolLease().workId) {
            throw new Error(
              "DELETE_PREVIEW_OWNERSHIP: token is missing, expired at the outer runtime, or belongs to another execution."
            );
          }

          const binding = resolveDrawingContext(drawing_id);
          if (binding.drawing_id !== owner.drawingId) {
            throw new Error(
              "DELETE_PREVIEW_OWNERSHIP: drawing_id does not match the drawing used for this preview."
            );
          }

          // Consume outer authority before the upstream destructive call, matching
          // the CAD MCP one-shot semantics even if transport fails afterward.
          deletePreviewOwners.delete(token);

          return await withCadHostLock(owner.host, async () => {
            await activateDrawingContext(binding);
            const result = await cadUpstream.callTool(
              "cad_execute_delete_preview",
              { token }
            );
            if (!isToolErrorResult(result)) {
              recordCadCandidateSuccess(
                currentToolLease().workId,
                executePublicName
              );
            }
            return result as any;
          });
        } catch (error) {
          return toolError(executePublicName, error);
        }
      }
    );
    registry.set(executePublicName, registered);
    publicNames.push(executePublicName);
  }

  return publicNames;
}

export function clearDestructivePreviewOwnershipForExecution(
  executionId: string
): void {
  for (const [token, owner] of deletePreviewOwners) {
    if (owner.workId === executionId) deletePreviewOwners.delete(token);
  }
}

function manifestToolNames(): Set<string> {
  return new Set(loadManifest().tools.map((tool) => tool.name));
}

function diffRuntimeAgainstManifest(runtimeTools: Tool[]): {
  missing: string[];
  unexpected: string[];
} {
  const manifest = manifestToolNames();
  const runtime = new Set(runtimeTools.map((tool) => tool.name));
  const missing = [...manifest].filter((name) => !runtime.has(name)).sort();
  const unexpected = [...runtime].filter((name) => !manifest.has(name)).sort();
  return { missing, unexpected };
}

export async function activateCadRuntime(): Promise<{
  count: number;
  manifest_match: boolean;
  missing: string[];
  unexpected: string[];
}> {
  const runtimeTools = await cadUpstream.activate();
  const diff = diffRuntimeAgainstManifest(runtimeTools);
  return {
    count: runtimeTools.length,
    manifest_match:
      diff.missing.length === 0 && diff.unexpected.length === 0,
    ...diff,
  };
}

export async function deactivateCadRuntime(): Promise<void> {
  await cadUpstream.deactivate();
}

export function registerCadProxyTools(server: McpServer): void {
  syncCadBusinessProxies(server);

  server.registerTool(
    "cad_status",
    {
      title: "CAD MCP Status",
      description:
        "Report CAD MCP runtime state without waking it. CAD MCP activates only on actual CAD demand.",
      inputSchema: {},
    },
    async () =>
      toolResult(
        "cad_status",
        cadUpstream.status() as unknown as Record<string, unknown>
      )
  );

  server.registerTool(
    "drawing_list",
    {
      title: "List Open Drawings",
      description:
        "Activate CAD MCP on demand and list open AutoCAD drawings available to this admitted work execution.",
      inputSchema: {},
    },
    async () => {
      try {
        await ensureCadRuntimeActive();
        return await withCadHostLock("autocad", async () => {
          const drawings = await listOpenDrawings();
          recordCadCandidateSuccess(currentToolLease().workId, "drawing_list");
          return toolResult("drawing_list", {
            drawings,
            count: drawings.length,
          });
        });
      } catch (error) {
        return toolError("drawing_list", error);
      }
    }
  );

  server.registerTool(
    "drawing_create_test",
    {
      title: "Create and Bind Blank Test Drawing",
      description:
        "Create a new unsaved blank AutoCAD drawing and bind it as an execution-scoped drawing context. AutoCAD must already be running.",
      inputSchema: {},
    },
    async () => {
      try {
        await ensureCadRuntimeActive();
        return await withCadHostLock("autocad", async () => {
          const created = await cadUpstream.callTool(
            "acad_create_blank_test_document",
            {}
          );
          if (
            created &&
            typeof created === "object" &&
            (created as { isError?: boolean }).isError
          ) {
            throw new Error("CAD MCP could not create a blank test drawing");
          }
          const drawings = await listOpenDrawings();
          const active = drawings.filter((item) => item.active === true);
          if (active.length !== 1) {
            throw new Error(
              "Could not resolve the newly-created active test drawing uniquely"
            );
          }
          const selected = active[0];
          const identity = String(
            selected.full_name || selected.name || ""
          );
          if (!identity) {
            throw new Error("New test drawing has no usable identity");
          }
          const drawing = await bindDrawing(identity);
          recordCadCandidateSuccess(currentToolLease().workId, "drawing_create_test");
          return toolResult("drawing_create_test", {
            created: true,
            bound: true,
            test_drawing: true,
            unsaved: !drawing.full_name,
            drawing,
            note:
              "Use this isolated drawing for mutation/Lisp tests. Do not save it over a project drawing.",
          });
        });
      } catch (error) {
        return toolError("drawing_create_test", error);
      }
    }
  );

  server.registerTool(
    "drawing_bind",
    {
      title: "Bind CadGPT Drawing Context",
      description:
        "Bind this work execution to one explicitly open AutoCAD drawing by exact file name or full path. Returns an opaque drawing_id.",
      inputSchema: { document: z.string().min(1) },
    },
    async ({ document }) => {
      try {
        await ensureCadRuntimeActive();
        return await withCadHostLock("autocad", async () => {
          const drawing = await bindDrawing(document);
          recordCadCandidateSuccess(currentToolLease().workId, "drawing_bind");
          return toolResult("drawing_bind", { bound: true, drawing });
        });
      } catch (error) {
        return toolError("drawing_bind", error);
      }
    }
  );

  server.registerTool(
    "drawing_status",
    {
      title: "CadGPT Drawing Context Status",
      description:
        "Show drawing contexts owned by this work execution. Supply drawing_id to inspect one exact context.",
      inputSchema: { drawing_id: z.string().optional() },
    },
    async ({ drawing_id }) => {
      try {
        await ensureCadRuntimeActive();
        return await withCadHostLock("autocad", async () => {
          const status = await drawingBindingStatus(drawing_id);
          recordCadCandidateSuccess(currentToolLease().workId, "drawing_status");
          return toolResult("drawing_status", status);
        });
      } catch (error) {
        return toolError("drawing_status", error);
      }
    }
  );

  server.registerTool(
    "cad_refresh_tools",
    {
      title: "Verify CAD Runtime Tool Manifest",
      description:
        "Activate CAD MCP on demand and compare runtime tools against the generated CAD MCP manifest.",
      inputSchema: {},
    },
    async () => {
      try {
        await ensureCadRuntimeActive();
        const runtimeTools = await cadUpstream.listTools(true);
        const diff = diffRuntimeAgainstManifest(runtimeTools);
        const manifestMatch =
          diff.missing.length === 0 && diff.unexpected.length === 0;
        if (manifestMatch) {
          recordCadCandidateSuccess(currentToolLease().workId, "cad_refresh_tools");
        }
        return toolResult("cad_refresh_tools", {
          runtime_count: runtimeTools.length,
          manifest_match: manifestMatch,
          ...diff,
        });
      } catch (error) {
        return toolError("cad_refresh_tools", error);
      }
    }
  );
}
