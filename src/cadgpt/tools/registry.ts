import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getUserCapabilitiesPath } from "../lib/appdata.js";
import { getRepoRoot } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { isDevelopmentBuild } from "../lib/work-registration.js";
import { listBundledLispEntries } from "../lib/bundled-assets.js";

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
  "cad_observation_capture_start",
  "cad_observation_capture_status",
  "cad_observation_capture_finish",
  "cad_observation_capture_cancel",
  "cad_read_entity_properties",
]);

const WRAPPED_CAD_SUMMARIES: Record<string, string> = {
  cad_preview_delete_entities:
    "Preview guarded deletion on an execution-scoped drawing and mint a one-shot token owned by the same execution/drawing.",
  cad_execute_delete_preview:
    "Execute only a destructive preview token owned by the same execution and drawing context.",
  cad_load_lisp_file:
    "Load and verify sandboxed Lisp; public commands discovered by the canonical parser become owned by this execution/drawing.",
  cad_run_lisp_command:
    "Run only a Lisp command previously verified and owned by the same execution/drawing.",
};

const CORE_TOOLS = [
  { name: "cadgpt_admission", class: "control.admission", summary: "Verify literal @cadgpt invocation in the exact current user turn and mint scoped admission authority." },
  { name: "cadgpt_work_start", class: "control.work", summary: "Create one execution-scoped WorkRegistration after ACTIVE admission." },
  { name: "cadgpt_work_status", class: "control.work", summary: "Inspect the current session work state without exposing authority secrets." },
  { name: "cadgpt_work_stop", class: "control.work", summary: "Release one execution-scoped work handle and its runtime state." },
  { name: "file_roots", class: "local.files", summary: "Show managed AppData roots readable/writable by generic file tools." },
  { name: "file_list", class: "local.files", summary: "List managed AppData library/workspace/data files." },
  { name: "file_read", class: "local.files", summary: "Read a managed AppData text file." },
  { name: "file_search", class: "local.files", summary: "Search managed AppData text files." },
  { name: "file_create", class: "local.files", summary: "Create a managed workspace/data text file." },
  { name: "file_edit", class: "local.files", summary: "Edit a managed workspace/data text file." },
  { name: "library_list", class: "libraries", summary: "List user Lisp/Job libraries imported into managed AppData." },
  { name: "library_import", class: "libraries", summary: "Read an approved absolute source folder, copy it only to an explicit absolute managed AppData target, and index User Registry without writing back to source." },
  { name: "job_list", class: "workflow.jobs", summary: "List concrete Jobs registered from managed user Job Libraries." },
  { name: "job_get", class: "workflow.jobs", summary: "Load one concrete registered Job from its managed AppData library." },
  { name: "job_checkout", class: "workflow.authoring", summary: "Copy a registered Job into the Job workspace for controlled refinement." },
  { name: "job_draft_validate", class: "workflow.authoring", summary: "Validate a Job workspace draft against the canonical structural contract." },
  { name: "job_promote_draft", class: "workflow.authoring", summary: "Promote a tested Job draft into a managed Job Library and synchronize User Registry." },
  { name: "skill_list", class: "skills", summary: "List internal CadGPT system skills." },
  { name: "skill_get", class: "skills", summary: "Load one internal CadGPT skill resource." },
  { name: "lisp_scaffold", class: "lisp.authoring", summary: "Create a canonical CadGPT AutoLISP scaffold, with TBH profile only for target library tbh-toolkit." },
  { name: "lisp_checkout", class: "lisp.authoring", summary: "Copy one managed Lisp capability into workspace for editing/repair and normalize its working header only when write-lisp is activated." },
  { name: "lisp_validate", class: "lisp.authoring", summary: "Statically validate managed AutoLISP source with an explicit authoring profile." },
  { name: "lisp_draft_validate", class: "lisp.authoring", summary: "Statically validate an AutoLISP workspace draft." },
  { name: "lisp_promote_draft", class: "lisp.authoring", summary: "Promote a tested workspace draft into a managed Lisp Library and synchronize User Registry." },
  { name: "registry_list", class: "registry", summary: "List effective capabilities from Internal Registry and User Registry." },
  { name: "registry_get", class: "registry", summary: "Get one effective capability record." },
  { name: "cad_status", class: "cad.session", summary: "Report AutoCAD/CAD-MCP backend state without mutating a drawing." },
  { name: "drawing_list", class: "cad.session", summary: "List AutoCAD drawings available for explicit CadGPT binding." },
  { name: "drawing_create_test", class: "cad.session", summary: "Create a blank AutoCAD drawing for safe testing." },
  { name: "drawing_bind", class: "cad.session", summary: "Bind the current work execution to one explicit AutoCAD document lifetime and return an opaque drawing_id." },
  { name: "drawing_status", class: "cad.session", summary: "Report execution-scoped drawing contexts and availability." },
  { name: "cad_refresh_tools", class: "cad.host", summary: "Compare live CAD MCP tools with the generated CAD tool manifest." },
  { name: "observator_capture_start", class: "cad.observator", summary: "Start an execution-owned ObjectAdded capture on an explicitly bound drawing." },
  { name: "observator_capture_status", class: "cad.observator", summary: "Report Observation capture state owned by the current execution." },
  { name: "observator_capture_finish", class: "cad.observator", summary: "Finish the current execution-owned Observation capture and resolve captured entities." },
  { name: "observator_capture_cancel", class: "cad.observator", summary: "Cancel the current execution-owned Observation capture." },
  { name: "observator_read_entities", class: "cad.observator", summary: "Read structured entity properties from an explicitly bound drawing." },
  { name: "observator_log_append", class: "cad.observator", summary: "Append normalized Observation records to the drawing-scoped managed log." },
];

const DEV_ONLY_TOOLS = [
  { name: "cad_mcp_dev_root", class: "dev.cad-mcp", summary: "Show the absolute CAD MCP runtime source root and development write boundary." },
  { name: "cad_mcp_dev_list", class: "dev.cad-mcp", summary: "List CAD MCP runtime or approved read-only supporting files." },
  { name: "cad_mcp_dev_read", class: "dev.cad-mcp", summary: "Read a CAD MCP runtime/supporting file and return its hash." },
  { name: "cad_mcp_dev_search", class: "dev.cad-mcp", summary: "Search CAD MCP runtime/supporting source." },
  { name: "cad_mcp_dev_create", class: "dev.cad-mcp", summary: "Create an absolute-path file under runtimes/cad-mcp/** after a baseline snapshot." },
  { name: "cad_mcp_dev_edit", class: "dev.cad-mcp", summary: "Hash-guarded edit of an absolute CAD MCP runtime source file." },
  { name: "cad_mcp_dev_delete", class: "dev.cad-mcp", summary: "Hash-guarded deletion inside the CAD MCP runtime root." },
  { name: "cad_mcp_dev_move", class: "dev.cad-mcp", summary: "Move/rename a CAD MCP runtime file within the allowed root." },
  { name: "cad_mcp_dev_recovery_status", class: "dev.cad-mcp", summary: "Show crash-safe pending CAD MCP recovery baselines that block new mutation." },
  { name: "cad_mcp_dev_recover", class: "dev.cad-mcp", summary: "Restore a persisted unaccepted CAD MCP source baseline after crash/failed cleanup." },
  { name: "cad_mcp_dev_snapshot", class: "dev.cad-mcp", summary: "Create the immutable crash-safe rollback baseline for one CAD MCP development execution." },
  { name: "cad_mcp_dev_rollback", class: "dev.cad-mcp", summary: "Restore the execution's CAD MCP source baseline without Git." },
  { name: "cad_mcp_dev_validate", class: "dev.cad-mcp", summary: "Run named compile/import/manifest validation and refresh the generated CAD tool registry artifact." },
  { name: "cad_mcp_dev_accept_local", class: "dev.cad-mcp", summary: "Accept validated local CAD MCP source when live AutoCAD testing is not required." },
  { name: "cad_mcp_dev_candidate_status", class: "dev.cad-mcp", summary: "Inspect exclusive live CAD MCP candidate-generation state." },
  { name: "cad_mcp_dev_candidate_start", class: "dev.cad-mcp", summary: "Reserve and start a validated exclusive CAD MCP candidate generation for live testing." },
  { name: "cad_mcp_dev_candidate_accept", class: "dev.cad-mcp", summary: "Accept a live-tested CAD MCP candidate after successful tool evidence." },
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
  const core = isDevelopmentBuild()
    ? [...CORE_TOOLS, ...DEV_ONLY_TOOLS]
    : CORE_TOOLS;
  const result: Array<Record<string, unknown>> = core.map((item) => ({
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
      const upstreamSchema =
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? (tool.inputSchema as Record<string, unknown>)
          : {};
      const properties =
        upstreamSchema.properties && typeof upstreamSchema.properties === "object"
          ? (upstreamSchema.properties as Record<string, unknown>)
          : {};
      const effectiveInputSchema = {
        ...upstreamSchema,
        type: "object",
        properties: {
          ...properties,
          drawing_id: {
            type: "string",
            description:
              "Execution-scoped drawing_id returned by drawing_bind; required when multiple drawings are bound.",
          },
        },
      };

      result.push({
        id: `cad__${tool.name}`,
        name: `cad__${tool.name}`,
        upstream_name: tool.name,
        kind: "tool",
        registry: "internal",
        source: "cad-mcp-public-proxy",
        class: toolClass(tool.name),
        summary:
          WRAPPED_CAD_SUMMARIES[tool.name] ||
          tool.description ||
          tool.name,
        input_schema: effectiveInputSchema,
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
    if (dir.name === "cad-mcp-dev" && !isDevelopmentBuild()) continue;
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
    const seen = new Set<string>();
    for (const entry of parsed.entries) {
      if (entry.kind !== "lisp" && entry.kind !== "job") throw new Error(`User Registry may contain only lisp/job entries: ${String(entry.id || "<unknown>")}`);
      const id = String(entry.id || "").trim().toLowerCase();
      if (!id) throw new Error("User Registry capability has an empty id");
      if (seen.has(id)) throw new Error(`User Registry contains duplicate capability id: ${String(entry.id)}`);
      seen.add(id);
    }
    return parsed.entries.map((entry) => {
      const effective: Record<string, unknown> = { ...entry, registry: "user" };
      if (entry.kind === "lisp" && entry.semantic_status !== "curated" && entry.ai_mode === "dynamic") {
        effective.review_blocked_ai_mode = "dynamic";
        effective.ai_mode = "static";
        effective.dynamic_parameters = [];
      }
      return effective;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function loadEffectiveRegistry(): Promise<Array<Record<string, unknown>>> {
  const [tools, skills, bundledLisp, users] = await Promise.all([
    loadToolEntries(),
    loadSkillEntries(),
    listBundledLispEntries(),
    loadUserEntries(),
  ]);
  return [...tools, ...skills, ...bundledLisp, ...users].sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)
  );
}

function textMatch(value: unknown, query: string): boolean {
  return JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
}

export function registerCapabilityRegistryTools(server: McpServer): void {
  server.registerTool(
    "registry_list",
    {
      title: "List CadGPT Effective Capability Registry",
      description: "List the lightweight effective registry: internal MCP tools/system skills/bundled read-only Lisp plus user Lisp/Jobs. User Registry cannot overwrite internal resources.",
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
          ownership: { internal: ["tool", "skill", "lisp"], user: ["lisp", "job"] },
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
