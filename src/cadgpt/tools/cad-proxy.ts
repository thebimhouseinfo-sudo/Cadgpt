import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { cadUpstream } from "../runtime/cad-upstream.js";
import { getRepoRoot } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import {
  bindDrawing,
  drawingBindingStatus,
  ensureBoundDrawingActive,
  listOpenDrawings,
} from "../session/drawing-binding.js";

const proxyRegistry = new WeakMap<McpServer, Map<string, RegisteredTool>>();
const INTERNAL_DOCUMENT_TOOLS = new Set([
  "acad_get_active_document",
  "acad_list_open_documents",
  "acad_set_active_document",
  "acad_create_blank_test_document",
]);

interface ToolManifest {
  version: number;
  tools: Tool[];
}

function loadManifest(): ToolManifest {
  const manifestPath = path.join(getRepoRoot(), "runtimes", "cad-mcp", "tool-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("CAD tool manifest is missing. Run setup.bat or: python scripts/generate-cad-tool-manifest.py");
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ToolManifest;
  if (!Array.isArray(parsed.tools)) throw new Error("CAD tool manifest is invalid: tools[] missing");
  return parsed;
}

function registryFor(server: McpServer): Map<string, RegisteredTool> {
  let registry = proxyRegistry.get(server);
  if (!registry) {
    registry = new Map();
    proxyRegistry.set(server, registry);
  }
  return registry;
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
    ? node.enum.filter((value): value is string | number | boolean | null =>
        value === null || ["string", "number", "boolean"].includes(typeof value)
      )
    : [];

  if (node.const === null || ["string", "number", "boolean"].includes(typeof node.const)) {
    field = z.literal(node.const as string | number | boolean | null);
  } else if (literalValues.length === 1) {
    field = z.literal(literalValues[0]);
  } else if (literalValues.length > 1) {
    const literals = literalValues.map((value) => z.literal(value));
    field = z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  } else if ((node.oneOf ?? node.anyOf)?.length) {
    const options = (node.oneOf ?? node.anyOf)!.map(schemaNodeToZod);
    field = options.length === 1
      ? options[0]
      : z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  } else {
    const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
    const primary = types.find((item) => item !== "null");
    if (primary === "string") field = z.string();
    else if (primary === "number") field = z.number();
    else if (primary === "integer") field = z.number().int();
    else if (primary === "boolean") field = z.boolean();
    else if (primary === "array") field = z.array(schemaNodeToZod(node.items));
    else if (primary === "object" || node.properties) {
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

  if (node.default !== undefined && node.default !== null) field = field.default(node.default as never);
  return node.description ? field.describe(node.description) : field;
}

function schemaToShape(schema: Tool["inputSchema"]): Record<string, z.ZodTypeAny> {
  if (!schema || typeof schema !== "object") return {};
  const root = schema as { properties?: Record<string, unknown>; required?: string[] };
  const required = new Set(root.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, node] of Object.entries(root.properties ?? {})) {
    const child = schemaNodeToZod(node);
    shape[key] = required.has(key) ? child : child.optional();
  }
  return shape;
}

function registerStableBusinessProxies(server: McpServer): string[] {
  const registry = registryFor(server);
  const publicNames: string[] = [];
  for (const tool of loadManifest().tools) {
    if (INTERNAL_DOCUMENT_TOOLS.has(tool.name)) continue;
    const publicName = `cad__${tool.name}`;
    publicNames.push(publicName);
    if (registry.has(publicName)) continue;

    const registered = server.registerTool(
      publicName,
      {
        title: tool.title ?? tool.name,
        description: `[CAD MCP / stable descriptor / bound drawing required] ${tool.description ?? tool.name}`,
        inputSchema: schemaToShape(tool.inputSchema),
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        if (!cadUpstream.status().enabled) {
          return toolError(publicName, new Error("CAD backend is sleeping. CadGPT only enables CAD MCP after ChatGPT has activated CadGPT and AutoCAD is running."));
        }
        await ensureBoundDrawingActive(server);
        return (await cadUpstream.callTool(tool.name, args ?? {})) as any;
      }
    );
    registry.set(publicName, registered);
  }
  return publicNames;
}

function manifestToolNames(): Set<string> {
  return new Set(loadManifest().tools.map((tool) => tool.name));
}

function diffRuntimeAgainstManifest(runtimeTools: Tool[]): { missing: string[]; unexpected: string[] } {
  const manifest = manifestToolNames();
  const runtime = new Set(runtimeTools.map((tool) => tool.name));
  const missing = [...manifest].filter((name) => !runtime.has(name)).sort();
  const unexpected = [...runtime].filter((name) => !manifest.has(name)).sort();
  return { missing, unexpected };
}

export async function activateCadRuntime(): Promise<{ count: number; manifest_match: boolean; missing: string[]; unexpected: string[] }> {
  const runtimeTools = await cadUpstream.activate();
  const diff = diffRuntimeAgainstManifest(runtimeTools);
  return {
    count: runtimeTools.length,
    manifest_match: diff.missing.length === 0 && diff.unexpected.length === 0,
    ...diff,
  };
}

export async function deactivateCadRuntime(): Promise<void> {
  await cadUpstream.deactivate();
}

export async function registerCadProxyTools(server: McpServer): Promise<void> {
  registerStableBusinessProxies(server);

  server.registerTool(
    "cad_status",
    {
      title: "CAD MCP Status",
      description: "Report stable CAD capability/runtime state. Tool descriptors remain available even while CAD MCP sleeps.",
      inputSchema: {},
    },
    async () => toolResult("cad_status", cadUpstream.status() as unknown as Record<string, unknown>)
  );

  server.registerTool(
    "drawing_list",
    {
      title: "List Open Drawings",
      description: "List open AutoCAD drawings. ChatGPT must have activated CadGPT and AutoCAD must be running.",
      inputSchema: {},
    },
    async () => {
      try {
        if (!cadUpstream.status().enabled) throw new Error("CAD backend is sleeping; AutoCAD is not currently available to this CadGPT session.");
        const drawings = await listOpenDrawings();
        return toolResult("drawing_list", { drawings, count: drawings.length });
      } catch (error) {
        return toolError("drawing_list", error);
      }
    }
  );

  server.registerTool(
    "drawing_create_test",
    {
      title: "Create and Bind Blank Test Drawing",
      description: "Create a new unsaved blank AutoCAD drawing and bind this CadGPT session to it. AutoCAD must already be running.",
      inputSchema: {},
    },
    async () => {
      try {
        if (!cadUpstream.status().enabled) throw new Error("CAD backend is sleeping; AutoCAD is not currently available.");
        const created = await cadUpstream.callTool("acad_create_blank_test_document", {});
        if (created && typeof created === "object" && (created as { isError?: boolean }).isError) {
          throw new Error("CAD MCP could not create a blank test drawing");
        }
        const drawings = await listOpenDrawings();
        const active = drawings.filter((item) => item.active === true);
        if (active.length !== 1) throw new Error("Could not resolve the newly-created active test drawing uniquely");
        const selected = active[0];
        const identity = String(selected.full_name || selected.name || "");
        if (!identity) throw new Error("New test drawing has no usable identity");
        const drawing = await bindDrawing(server, identity);
        return toolResult("drawing_create_test", {
          created: true,
          bound: true,
          test_drawing: true,
          unsaved: !drawing.full_name,
          drawing,
          note: "Use this isolated drawing for Lisp load/run tests. Do not save it over a project drawing.",
        });
      } catch (error) {
        return toolError("drawing_create_test", error);
      }
    }
  );

  server.registerTool(
    "drawing_bind",
    {
      title: "Bind CadGPT Drawing",
      description: "Bind this CadGPT MCP session to one explicitly open AutoCAD drawing by exact file name or full path.",
      inputSchema: { document: z.string().min(1) },
    },
    async ({ document }) => {
      try {
        if (!cadUpstream.status().enabled) throw new Error("CAD backend is sleeping; AutoCAD is not currently available.");
        const drawing = await bindDrawing(server, document);
        return toolResult("drawing_bind", { bound: true, drawing });
      } catch (error) {
        return toolError("drawing_bind", error);
      }
    }
  );

  server.registerTool(
    "drawing_status",
    {
      title: "CadGPT Drawing Binding Status",
      description: "Show the drawing explicitly bound to this CadGPT MCP session and whether it is still open.",
      inputSchema: {},
    },
    async () => toolResult("drawing_status", await drawingBindingStatus(server))
  );

  server.registerTool(
    "cad_refresh_tools",
    {
      title: "Verify CAD Runtime Tool Manifest",
      description: "Compare the active CAD MCP runtime tools against CadGPT's stable descriptor manifest. Descriptor changes require app refresh/reconnect rather than dynamic add/remove.",
      inputSchema: {},
    },
    async () => {
      try {
        if (!cadUpstream.status().enabled) throw new Error("CAD backend is sleeping because AutoCAD is not active for this CadGPT session.");
        const runtimeTools = await cadUpstream.listTools(true);
        const diff = diffRuntimeAgainstManifest(runtimeTools);
        return toolResult("cad_refresh_tools", {
          runtime_count: runtimeTools.length,
          manifest_match: diff.missing.length === 0 && diff.unexpected.length === 0,
          ...diff,
          note: "If descriptors changed, regenerate the manifest and refresh/reconnect the ChatGPT app.",
        });
      } catch (error) {
        return toolError("cad_refresh_tools", error);
      }
    }
  );
}
