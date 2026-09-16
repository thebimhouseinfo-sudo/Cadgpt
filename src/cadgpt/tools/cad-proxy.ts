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
const INTERNAL_DOCUMENT_TOOLS = new Set([
  "acad_get_active_document",
  "acad_list_open_documents",
  "acad_set_active_document",
]);
const BOUND_TARGET_ARGUMENTS = new Set(["document_name"]);

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

function rootProperties(schema: Tool["inputSchema"]): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  return (schema as { properties?: Record<string, unknown> }).properties ?? {};
}

function schemaToShape(schema: Tool["inputSchema"]): Record<string, z.ZodTypeAny> {
  if (!schema || typeof schema !== "object") return {};
  const root = schema as { properties?: Record<string, unknown>; required?: string[] };
  const required = new Set(root.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, node] of Object.entries(root.properties ?? {})) {
    // The bound drawing is session state, not an LLM-selectable tool argument.
    // Hiding document_name prevents a proxied legacy tool from overriding the
    // CadGPT drawing binding after ensureBoundDrawingActive() runs.
    if (BOUND_TARGET_ARGUMENTS.has(key)) continue;
    const child = schemaNodeToZod(node);
    shape[key] = required.has(key) ? child : child.optional();
  }
  return shape;
}

function argumentsForBoundDrawing(
  tool: Tool,
  publicArgs: Record<string, unknown>,
  drawing: { name: string; full_name: string }
): Record<string, unknown> {
  const args = { ...publicArgs };
  for (const key of BOUND_TARGET_ARGUMENTS) delete args[key];

  const properties = rootProperties(tool.inputSchema);
  if (Object.prototype.hasOwnProperty.call(properties, "document_name")) {
    args.document_name = drawing.full_name || drawing.name;
  }
  return args;
}

async function refreshProxies(server: McpServer, force = false): Promise<string[]> {
  const registry = registryFor(server);
  const active = new Set<string>();
  const tools = await cadUpstream.listTools(force);

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
        // Binding is both activation and argument authority. A legacy upstream
        // document_name parameter is never accepted from ChatGPT; it is injected
        // from the session binding here immediately before the operation.
        const drawing = await ensureBoundDrawingActive(server);
        const upstreamArgs = argumentsForBoundDrawing(tool, args ?? {}, drawing);
        return (await cadUpstream.callTool(tool.name, upstreamArgs)) as any;
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

export async function registerCadProxyTools(server: McpServer): Promise<void> {
  server.registerTool(
    "cad_status",
    {
      title: "CAD MCP Status",
      description: "Report CadGPT-to-CAD-MCP upstream health separately from tunnel/session health.",
      inputSchema: {},
    },
    async () => toolResult("cad_status", cadUpstream.status() as unknown as Record<string, unknown>)
  );

  server.registerTool(
    "drawing_list",
    {
      title: "List Open Drawings",
      description: "List open AutoCAD drawings. This does not change the CadGPT session binding.",
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
      title: "Refresh CAD MCP Tools",
      description: "Reconnect to the local CAD MCP process and refresh proxied CAD tools after a runtime restart.",
      inputSchema: {},
    },
    async () => {
      try {
        const tools = await refreshProxies(server, true);
        server.sendToolListChanged();
        return toolResult("cad_refresh_tools", { tools, count: tools.length });
      } catch (error) {
        return toolError("cad_refresh_tools", error);
      }
    }
  );

  try {
    await refreshProxies(server);
  } catch (error) {
    console.warn("[CAD MCP] unavailable during session creation:", error instanceof Error ? error.message : error);
  }
}
