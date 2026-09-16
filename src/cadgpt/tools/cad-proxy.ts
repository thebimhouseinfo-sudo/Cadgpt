import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { cadUpstream } from "../runtime/cad-upstream.js";
import { toolError, toolResult } from "../lib/tool-result.js";

const proxyRegistry = new WeakMap<McpServer, Map<string, RegisteredTool>>();

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
    field = options.length === 1 ? options[0] : z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
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

async function refreshProxies(server: McpServer, force = false): Promise<string[]> {
  const registry = registryFor(server);
  const active = new Set<string>();
  const tools = await cadUpstream.listTools(force);

  for (const tool of tools) {
    const name = `cad__${tool.name}`;
    active.add(name);
    if (registry.has(name)) continue;

    const inputSchema = schemaToShape(tool.inputSchema);
    const registered = server.registerTool(
      name,
      {
        title: tool.title ?? tool.name,
        description: `[CAD MCP] ${tool.description ?? tool.name}`,
        inputSchema,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => (await cadUpstream.callTool(tool.name, args ?? {})) as any
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
      description: "Report the CadGPT-to-CAD-MCP upstream connection separately from the ChatGPT tunnel status.",
      inputSchema: {},
    },
    async () => toolResult("cad_status", cadUpstream.status() as unknown as Record<string, unknown>)
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
