import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getUserCapabilitiesPath } from "../lib/appdata.js";
import { getRepoRoot } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";

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
  { name: "file_roots", class: "local.files", summary: "Show managed AppData roots editable by CadGPT." },
  { name: "file_list", class: "local.files", summary: "List managed AppData library/workspace/data files." },
  { name: "file_read", class: "local.files", summary: "Read a managed AppData text file." },
  { name: "file_search", class: "local.files", summary: "Search managed AppData text files." },
  { name: "file_create", class: "local.files", summary: "Create a managed AppData text file." },
  { name: "file_edit", class: "local.files", summary: "Edit a managed AppData text file." },
  { name: "library_list", class: "libraries", summary: "List user Lisp/Job libraries imported into managed AppData." },
  { name: "library_import", class: "libraries", summary: "Read a user-selected source folder, copy it into AppData, and index User Registry without writing back to source." },
  { name: "job_list", class: "workflow.jobs", summary: "List concrete Jobs registered from managed user Job Libraries." },
  { name: "job_get", class: "workflow.jobs", summary: "Load one concrete registered Job from its managed AppData library." },
  { name: "skill_list", class: "skills", summary: "List internal CadGPT system skills." },
  { name: "skill_get", class: "skills", summary: "Load one internal CadGPT skill resource." },
  { name: "lisp_scaffold", class: "lisp.authoring", summary: "Create a canonical CadGPT AutoLISP scaffold, with TBH profile only for target library tbh-toolkit." },
  { name: "lisp_checkout", class: "lisp.authoring", summary: "Copy one managed Lisp capability into workspace for editing and normalize its working header only when write-lisp is activated." },
  { name: "lisp_validate", class: "lisp.authoring", summary: "Statically validate managed AutoLISP source with an explicit authoring profile." },
  { name: "lisp_draft_validate", class: "lisp.authoring", summary: "Statically validate an AutoLISP workspace draft." },
  { name: "lisp_promote_draft", class: "lisp.authoring", summary: "Promote a tested workspace draft into a managed Lisp Library and synchronize User Registry." },
  { name: "registry_list", class: "registry", summary: "List effective capabilities from Internal Registry and User Registry." },
  { name: "registry_get", class: "registry", summary: "Get one effective capability record." },
  { name: "cad_status", class: "cad.session", summary: "Report AutoCAD/CAD-MCP backend state without mutating a drawing." },
  { name: "drawing_list", class: "cad.session", summary: "List AutoCAD drawings available for explicit CadGPT binding." },
  { name: "drawing_create_test", class: "cad.session", summary: "Create a blank AutoCAD drawing for safe testing." },
  { name: "drawing_bind", class: "cad.session", summary: "Bind the CadGPT session to one explicit drawing identity." },
  { name: "drawing_status", class: "cad.session", summary: "Report the currently bound drawing and availability state." },
];

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
    kind: "tool",
    registry: "internal",
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
        kind: "tool",
        registry: "internal",
        source: "cad-mcp",
        class: toolClass(tool.name),
        summary: tool.description || tool.name,
        input_schema: tool.inputSchema ?? {},
      });
    }
  } catch {
    // Generated during setup/CI; absence is non-fatal for core registry discovery.
  }
  return result;
}

async function loadSkillEntries(): Promise<Array<Record<string, unknown>>> {
  const root = path.join(getRepoRoot(), "skills");
  const result: Array<Record<string, unknown>> = [];
  let dirs: Array<import("node:fs").Dirent> = [];
  try {
    dirs = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory() || dir.name.startsWith(".")) continue;
    try {
      const content = await fs.readFile(path.join(root, dir.name, "SKILL.md"), "utf8");
      const title = content.match(/^#\s+(?:Skill:\s*)?(.+)$/mi)?.[1]?.trim() || dir.name;
      const status = content.match(/^Status:\s*(.+)$/mi)?.[1]?.replace(/\*\*/g, "").trim();
      const summary = content.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#") && !/^Status:/i.test(line))?.trim() || title;
      result.push({
        id: dir.name,
        name: dir.name,
        title,
        kind: "skill",
        registry: "internal",
        source: "cadgpt-system-skill",
        class: "skills",
        summary,
        ...(status ? { status } : {}),
      });
    } catch {
      // Not an active system skill.
    }
  }
  return result;
}

async function loadUserEntries(): Promise<Array<Record<string, unknown>>> {
  try {
    const parsed = JSON.parse(await fs.readFile(getUserCapabilitiesPath(), "utf8")) as { entries?: Array<Record<string, unknown>> };
    if (!Array.isArray(parsed.entries)) throw new Error("User Registry is missing entries[]");
    for (const entry of parsed.entries) {
      if (entry.kind !== "lisp" && entry.kind !== "job") throw new Error(`User Registry may contain only lisp/job entries: ${String(entry.id || "<unknown>")}`);
    }
    return parsed.entries.map((entry) => ({ ...entry, registry: "user" }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function loadEffectiveRegistry(): Promise<Array<Record<string, unknown>>> {
  const [tools, skills, users] = await Promise.all([loadToolEntries(), loadSkillEntries(), loadUserEntries()]);
  return [...tools, ...skills, ...users].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

function textMatch(value: unknown, query: string): boolean {
  return JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
}

export function registerCapabilityRegistryTools(server: McpServer): void {
  server.registerTool(
    "registry_list",
    {
      title: "List CadGPT Effective Capability Registry",
      description: "List the unified view of Internal Registry (MCP tools + system skills) and User Registry (managed Lisp + Jobs). Ownership is disjoint; User Registry cannot overwrite Internal Registry.",
      inputSchema: {
        kind: z.enum(["tool", "skill", "lisp", "job"]).optional(),
        registry: z.enum(["internal", "user"]).optional(),
        class_name: z.string().optional(),
        library_id: z.string().optional(),
        ai_mode: z.enum(["static", "dynamic"]).optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional().default(100),
      },
    },
    async ({ kind, registry, class_name, library_id, ai_mode, query, limit }) => {
      try {
        let entries = await loadEffectiveRegistry();
        if (kind) entries = entries.filter((entry) => entry.kind === kind);
        if (registry) entries = entries.filter((entry) => entry.registry === registry);
        if (class_name) entries = entries.filter((entry) => String(entry.class ?? "").startsWith(class_name));
        if (library_id) entries = entries.filter((entry) => String(entry.library_id ?? "") === library_id);
        if (ai_mode) entries = entries.filter((entry) => entry.ai_mode === ai_mode);
        if (query?.trim()) entries = entries.filter((entry) => textMatch(entry, query.trim()));
        const selected = entries.slice(0, limit);
        return toolResult("registry_list", {
          count: selected.length,
          total_matches: entries.length,
          entries: selected,
          ownership: { internal: ["tool", "skill"], user: ["lisp", "job"] },
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
      description: "Get one capability by canonical id, MCP tool name, Lisp command, or managed relative path from the effective registry.",
      inputSchema: {
        id: z.string().min(1),
        kind: z.enum(["tool", "skill", "lisp", "job"]).optional(),
      },
    },
    async ({ id, kind }) => {
      try {
        const needle = id.trim().toLowerCase();
        let entries = await loadEffectiveRegistry();
        if (kind) entries = entries.filter((entry) => entry.kind === kind);
        const matches = entries.filter((entry) => {
          if (String(entry.id ?? "").toLowerCase() === needle) return true;
          if (String(entry.name ?? "").toLowerCase() === needle) return true;
          if (String(entry.relative_path ?? "").toLowerCase() === needle) return true;
          const commands = Array.isArray(entry.commands) ? entry.commands : [];
          return commands.some((command) => String(command).toLowerCase() === needle);
        });
        if (!matches.length) throw new Error(`Registry capability not found: ${id}`);
        if (matches.length > 1) throw new Error(`Registry lookup is ambiguous for ${id}; specify kind or canonical id`);
        return toolResult("registry_get", { entry: matches[0] });
      } catch (error) {
        return toolError("registry_get", error);
      }
    }
  );
}
