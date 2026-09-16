import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getRepoRoot } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";

interface LispEntry {
  id: string;
  title: string;
  type: "static" | "dynamic";
  dynamic_role?: "template" | "instance";
  class: string;
  subclass: string;
  tags: string[];
  module: string;
  commands: string[];
  path?: string;
  summary: string;
  when_to_use: string[];
  targets: string[];
  inputs: string[];
  effects: string[];
  interaction: "interactive" | "non-interactive";
  load_behavior: "define_only" | "execute_on_load";
  mutates_drawing: boolean;
  destructive: boolean;
  risk: "low" | "medium" | "high";
  dynamic_parameters: string[];
  implementation_notes: string[];
}

interface ToolManifestEntry {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const INTERNAL_CAD_TOOLS = new Set([
  "acad_get_active_document",
  "acad_list_open_documents",
  "acad_set_active_document",
  "acad_create_blank_test_document",
]);

const CORE_TOOLS = [
  { name: "file_roots", class: "local.files", summary: "Show the repository roots that CadGPT permits file tools to access." },
  { name: "file_list", class: "local.files", summary: "List files/directories inside the sandboxed lisp/** and jobs/** roots." },
  { name: "file_read", class: "local.files", summary: "Read a UTF-8 text file inside the CadGPT file sandbox." },
  { name: "file_search", class: "local.files", summary: "Search text inside sandboxed local files." },
  { name: "file_create", class: "local.files", summary: "Create a permitted text file inside the CadGPT file sandbox." },
  { name: "file_edit", class: "local.files", summary: "Apply an exact bounded text edit inside the CadGPT file sandbox." },
  { name: "job_list", class: "workflow.jobs", summary: "List available repeatable CadGPT Jobs." },
  { name: "job_get", class: "workflow.jobs", summary: "Load the exact JOB.md contract for one selected Job." },
  { name: "skill_list", class: "skills", summary: "List read-only CadGPT skill resources." },
  { name: "skill_get", class: "skills", summary: "Load one selected skill resource." },
  { name: "lisp_scaffold", class: "lisp.authoring", summary: "Create a canonical TBH AutoLISP scaffold for a new library command." },
  { name: "lisp_validate", class: "lisp.authoring", summary: "Statically validate AutoLISP dialect, TBH structure and command contracts." },
  { name: "cad_status", class: "cad.session", summary: "Report AutoCAD/CAD-MCP backend state without mutating a drawing." },
  { name: "drawing_list", class: "cad.session", summary: "List AutoCAD drawings available for explicit CadGPT binding." },
  { name: "drawing_create_test", class: "cad.session", summary: "Create a blank AutoCAD drawing for safe LISP/runtime testing when supported by the host." },
  { name: "drawing_bind", class: "cad.session", summary: "Bind the CadGPT session to one explicit drawing identity." },
  { name: "drawing_status", class: "cad.session", summary: "Report the currently bound drawing and availability state." },
];

function registryPath(name: string): string {
  return path.join(getRepoRoot(), "registry", name);
}

async function loadLispEntries(): Promise<LispEntry[]> {
  const parsed = JSON.parse(await fs.readFile(registryPath("lisp-registry.json"), "utf8")) as {
    entries?: LispEntry[];
  };
  if (!Array.isArray(parsed.entries)) throw new Error("registry/lisp-registry.json is missing entries[]");
  return parsed.entries;
}

function toolClass(name: string): string {
  if (/lisp/i.test(name)) return "cad.lisp-runtime";
  if (/layer/i.test(name)) return "cad.layers";
  if (/block/i.test(name)) return "cad.blocks";
  if (/entity|entities/i.test(name)) return "cad.entities";
  if (/move|rotate|scale|mirror|copy|line|arc|geometry/i.test(name)) return "cad.geometry";
  if (/delete|destructive/i.test(name)) return "cad.destructive";
  if (/inventory/i.test(name)) return "cad.inventory";
  if (/host|status/i.test(name)) return "cad.host";
  return "cad.general";
}

async function loadToolEntries(): Promise<Array<Record<string, unknown>>> {
  const result: Array<Record<string, unknown>> = CORE_TOOLS.map((item) => ({
    id: item.name,
    name: item.name,
    source: "cadgpt-core",
    class: item.class,
    summary: item.summary,
  }));

  const manifestPath = path.join(getRepoRoot(), "runtimes", "cad-mcp", "tool-manifest.json");
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { tools?: ToolManifestEntry[] };
    for (const tool of parsed.tools ?? []) {
      if (INTERNAL_CAD_TOOLS.has(tool.name)) continue;
      result.push({
        id: `cad__${tool.name}`,
        name: `cad__${tool.name}`,
        upstream_name: tool.name,
        source: "cad-mcp",
        class: toolClass(tool.name),
        summary: tool.description || tool.name,
        input_schema: tool.inputSchema ?? {},
      });
    }
  } catch {
    // Setup/CI generates the stable manifest. Core registry remains useful when
    // source is being edited before generation, so absence is non-fatal here.
  }

  return result.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function textMatch(value: unknown, query: string): boolean {
  return JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
}

export function registerCapabilityRegistryTools(server: McpServer): void {
  server.registerTool(
    "registry_list",
    {
      title: "List CadGPT Capability Registry",
      description: "List semantic capability metadata for available Lisp or MCP tools. Prefer Lisp registry metadata over reading Lisp source merely to discover what it does.",
      inputSchema: {
        kind: z.enum(["lisp", "tool"]).default("lisp"),
        class_name: z.string().optional(),
        type: z.enum(["static", "dynamic"]).optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional().default(100),
      },
    },
    async ({ kind, class_name, type, query, limit }) => {
      try {
        let entries: Array<Record<string, unknown>> = kind === "lisp"
          ? (await loadLispEntries()) as unknown as Array<Record<string, unknown>>
          : await loadToolEntries();

        if (class_name) entries = entries.filter((entry) => String(entry.class ?? "").startsWith(class_name));
        if (kind === "lisp" && type) entries = entries.filter((entry) => entry.type === type);
        if (query?.trim()) entries = entries.filter((entry) => textMatch(entry, query.trim()));
        const selected = entries.slice(0, limit);

        return toolResult("registry_list", {
          kind,
          count: selected.length,
          total_matches: entries.length,
          entries: selected,
          note: kind === "lisp"
            ? "Registry metadata is curated from actual behavior; read source only when modification/debug/audit requires it."
            : "MCP tools/list remains execution-authoritative; registry adds semantic grouping.",
        });
      } catch (error) {
        return toolError("registry_list", error);
      }
    }
  );

  server.registerTool(
    "registry_get",
    {
      title: "Get CadGPT Capability Metadata",
      description: "Get one semantic Lisp/tool registry entry by canonical id, Lisp command, or tool name.",
      inputSchema: {
        kind: z.enum(["lisp", "tool"]).default("lisp"),
        id: z.string().min(1),
      },
    },
    async ({ kind, id }) => {
      try {
        const needle = id.trim().toLowerCase();
        if (kind === "lisp") {
          const entries = await loadLispEntries();
          const entry = entries.find((item) =>
            item.id.toLowerCase() === needle ||
            item.commands.some((command) => command.toLowerCase() === needle) ||
            item.path?.toLowerCase() === needle
          );
          if (!entry) throw new Error(`Lisp registry entry not found: ${id}`);
          return toolResult("registry_get", { kind, entry });
        }

        const entries = await loadToolEntries();
        const entry = entries.find((item) =>
          String(item.id ?? "").toLowerCase() === needle || String(item.name ?? "").toLowerCase() === needle
        );
        if (!entry) throw new Error(`Tool registry entry not found: ${id}`);
        return toolResult("registry_get", { kind, entry });
      } catch (error) {
        return toolError("registry_get", error);
      }
    }
  );
}
