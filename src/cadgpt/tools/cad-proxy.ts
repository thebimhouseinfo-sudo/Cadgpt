import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { cadUpstream } from "../runtime/cad-upstream.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import {
  bindDrawing,
  drawingBindingStatus,
  ensureBoundDrawingActive,
  listOpenDrawings,
} from "../session/drawing-binding.js";

const proxyRegistry = new WeakMap<McpServer, Map<string, RegisteredTool>>();
const activeServers = new Set<McpServer>();
const INTERNAL_DOCUMENT_TOOLS = new Set([
  "acad_get_active_document",
  "acad_list_open_documents",
  "acad_set_active_document",
  "acad_create_blank_test_document",
]);

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

function applyProxies(server: McpServer, tools: Tool[]): string[] {
  const registry = registryFor(server);
  const active = new Set<string>();

  for (const tool of tools) {
    if (INTERNAL_DOCUMENT_TOOLS.has(tool.name)) continue;

    const name = `cad__${tool.name}`;
    active.add(name);
    if (registry.has(name)) continue;

    const inputSchema = schemaToShape(tool.inputSchema);
    const registered = server.registerTool(
      name,
      {
        title: tool.title ?? tool.name,
        description: `[CAD MCP / bound drawing required] ${tool.description ?? tool.name}`,
        inputSchema,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        await ensureBoundDrawingActive(server);
        return (await cadUpstream.callTool(tool.name, args ?? {})) as any;
      }
    );
    registry.set(name, registered);
  }

  for (const [name, registered] of registry) {
    if (!active.has(name)) {
      registered.remove();
      registry.delete(name);
    }
  }
  return [...active];
}

function removeBusinessProxies(server: McpServer): void {
  const registry = registryFor(server);
  for (const [name, registered] of registry) {
    registered.remove();
    registry.delete(name);
  }
}

export async function activateCadRuntime(): Promise<{ tools: string[]; count: number }> {
  const tools = await cadUpstream.activate();
  let publicTools: string[] = [];
  for (const server of activeServers) {
    publicTools = applyProxies(server, tools);
    server.sendToolListChanged();
  }
  return { tools: publicTools, count: publicTools.length };
}

export async function deactivateCadRuntime(): Promise<void> {
  for (const server of activeServers) {
    removeBusinessProxies(server);
    server.sendToolListChanged();
  }
  await cadUpstream.deactivate();
}

export async function registerCadProxyTools(server: McpServer): Promise<void> {
  activeServers.add(server);

  server.registerTool(
    "cad_status",
    {
      title: "CAD MCP Status",
      description: "Report CAD runtime state. CAD MCP sleeps while AutoCAD is closed and is activated by the CadGPT wake-agent when acad.exe is detected.",
      inputSchema: {},
    },
    async () => toolResult("cad_status", cadUpstream.status() as unknown as Record<string, unknown>)
  );

  server.registerTool(
    "drawing_list",
    {
      title: "List Open Drawings",
      description: "List open AutoCAD drawings. AutoCAD must be running; this does not change the CadGPT session binding.",
      inputSchema: {},
    },
    async () => {
      try {
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
        const created = await cadUpstream.callTool("acad_create_blank_test_document", {});
        if (created && typeof created === "object" && (created as { isError?: boolean }).isError) {
          throw new Error("CAD MCP could not create a blank test drawing");
        }
        const drawings = await listOpenDrawings();
        const active = drawings.filter((item) => item.active === true);
        if (active.length !== 1) {
          throw new Error("Could not resolve the newly-created active test drawing uniquely");
        }
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
      inputSchema: {
        document: z.string().min(1),
      },
    },
    async ({ document }) => {
      try {
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
      title: "Refresh Active CAD MCP Tools",
      description: "Refresh proxied CAD tools while AutoCAD/CAD MCP is already active. This does not wake CAD MCP while AutoCAD is closed.",
      inputSchema: {},
    },
    async () => {
      try {
        if (!cadUpstream.status().enabled) {
          throw new Error("CAD MCP is sleeping because AutoCAD is not detected.");
        }
        const tools = await cadUpstream.listTools(true);
        let publicTools: string[] = [];
        for (const activeServer of activeServers) {
          publicTools = applyProxies(activeServer, tools);
          activeServer.sendToolListChanged();
        }
        return toolResult("cad_refresh_tools", { tools: publicTools, count: publicTools.length });
      } catch (error) {
        return toolError("cad_refresh_tools", error);
      }
    }
  );

  if (cadUpstream.status().connected) {
    applyProxies(server, cadUpstream.cachedTools());
  }
}
