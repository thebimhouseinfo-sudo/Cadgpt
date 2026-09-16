import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getRepoRoot, resolveAllowedPath, toCadgptPath, toRepoRelative } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { validateLispSource } from "./lisp-harness.js";

const semanticMetadataSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  type: z.enum(["static", "dynamic"]),
  dynamic_role: z.enum(["template", "instance"]).optional(),
  class_name: z.string().min(1).max(160),
  subclass: z.string().min(1).max(160),
  tags: z.array(z.string().min(1).max(80)).max(50).default([]),
  module: z.string().min(1).max(160),
  summary: z.string().min(1).max(1200),
  when_to_use: z.array(z.string().min(1).max(600)).max(30).default([]),
  targets: z.array(z.string().min(1).max(300)).max(50).default([]),
  inputs: z.array(z.string().min(1).max(300)).max(50).default([]),
  effects: z.array(z.string().min(1).max(500)).max(50).default([]),
  interaction: z.enum(["interactive", "non-interactive"]),
  load_behavior: z.enum(["define_only", "execute_on_load"]),
  mutates_drawing: z.boolean(),
  destructive: z.boolean(),
  risk: z.enum(["low", "medium", "high"]),
  dynamic_parameters: z.array(z.string().min(1).max(300)).max(50).default([]),
  implementation_notes: z.array(z.string().min(1).max(600)).max(50).default([]),
});

async function atomicWrite(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, content, "utf8");
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

async function loadRegistry(): Promise<{
  version: number;
  entries: Array<Record<string, unknown>>;
  raw: string;
}> {
  const target = path.join(getRepoRoot(), "registry", "lisp-registry.json");
  const raw = await fs.readFile(target, "utf8");
  const parsed = JSON.parse(raw) as {
    version?: number;
    entries?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(parsed.entries)) throw new Error("registry/lisp-registry.json is missing entries[]");
  return { version: Number(parsed.version || 1), entries: parsed.entries, raw };
}

function assertDraftVirtualPath(value: string): void {
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  if (!normalized.startsWith("appdata/lisp-draft/") || !normalized.endsWith(".lsp")) {
    throw new Error("Draft path must be an .lsp file under appdata/lisp-draft/**");
  }
}

function assertPermanentPath(value: string): void {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized.startsWith("lisp/") || normalized.toLowerCase().startsWith("lisp/_cadgpt-system/") || !normalized.toLowerCase().endsWith(".lsp")) {
    throw new Error("Permanent path must be a user-facing .lsp file under lisp/** (excluding lisp/_cadgpt-system/**)");
  }
}

export function registerLispWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "lisp_draft_validate",
    {
      title: "Validate AutoLISP Draft",
      description: "Run the AutoLISP/TBH static harness against a draft stored under appdata/lisp-draft/** before CAD load/testing or promotion.",
      inputSchema: {
        path: z.string().min(1),
        expected_commands: z.array(z.string().min(1)).max(50).optional().default([]),
        enforce_library_style: z.boolean().optional().default(true),
      },
    },
    async ({ path: input, expected_commands, enforce_library_style }) => {
      try {
        assertDraftVirtualPath(input);
        const target = await resolveAllowedPath(input);
        const source = await fs.readFile(target, "utf8");
        const result = validateLispSource(source, expected_commands, {
          enforceLibraryStyle: enforce_library_style,
          fileName: path.basename(target),
        });
        return toolResult(
          "lisp_draft_validate",
          {
            path: toCadgptPath(target),
            dialect: "AutoLISP/Visual LISP",
            library_style: enforce_library_style ? "TBH" : "not-enforced",
            ...result,
          },
          result.valid ? "AutoLISP draft validation passed" : "AutoLISP draft validation failed"
        );
      } catch (error) {
        return toolError("lisp_draft_validate", error);
      }
    }
  );

  server.registerTool(
    "lisp_promote_draft",
    {
      title: "Promote Tested Lisp Draft",
      description: "Promote one validated appdata/lisp-draft/** file into permanent lisp/** and upsert its curated semantic registry entry as one rollback-safe operation.",
      inputSchema: {
        draft_path: z.string().min(1),
        permanent_path: z.string().min(1),
        metadata: semanticMetadataSchema,
        overwrite: z.boolean().optional().default(false),
      },
    },
    async ({ draft_path, permanent_path, metadata, overwrite }) => {
      try {
        assertDraftVirtualPath(draft_path);
        assertPermanentPath(permanent_path);

        if (metadata.type === "static" && metadata.dynamic_role) {
          throw new Error("dynamic_role is only valid for type=dynamic permanent Lisp entries");
        }
        if (metadata.type === "dynamic" && metadata.dynamic_role === "instance") {
          throw new Error("Runtime dynamic instances belong in appdata/runtime/dynamic-lisp; only reusable dynamic templates are promoted into lisp/**");
        }

        const draft = await resolveAllowedPath(draft_path);
        const source = await fs.readFile(draft, "utf8");
        const permanent = await resolveAllowedPath(permanent_path, { forCreate: true });
        const validation = validateLispSource(source, [], {
          enforceLibraryStyle: true,
          fileName: path.basename(permanent),
        });
        if (!validation.valid) {
          throw new Error(`Draft failed AutoLISP/TBH validation; promotion blocked (${validation.diagnostics.filter((item) => item.severity === "error").map((item) => item.code).join(", ")})`);
        }
        if (!validation.commands.length) {
          throw new Error("Promotion requires at least one public c: command so the permanent capability can be catalogued");
        }

        let targetExists = false;
        let previousPermanent: string | null = null;
        try {
          previousPermanent = await fs.readFile(permanent, "utf8");
          targetExists = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (targetExists && !overwrite) {
          throw new Error(`Permanent target already exists: ${permanent_path}; set overwrite=true only for an intentional replacement`);
        }

        const registry = await loadRegistry();
        const normalizedPermanent = toRepoRelative(permanent).replaceAll("\\", "/");
        const newEntry: Record<string, unknown> = {
          id: metadata.id,
          title: metadata.title,
          type: metadata.type,
          ...(metadata.type === "dynamic" ? { dynamic_role: metadata.dynamic_role || "template" } : {}),
          class: metadata.class_name,
          subclass: metadata.subclass,
          tags: metadata.tags,
          module: metadata.module,
          commands: validation.commands,
          path: normalizedPermanent,
          summary: metadata.summary,
          when_to_use: metadata.when_to_use,
          targets: metadata.targets,
          inputs: metadata.inputs,
          effects: metadata.effects,
          interaction: metadata.interaction,
          load_behavior: metadata.load_behavior,
          mutates_drawing: metadata.mutates_drawing,
          destructive: metadata.destructive,
          risk: metadata.risk,
          dynamic_parameters: metadata.dynamic_parameters,
          implementation_notes: metadata.implementation_notes,
        };

        const commandSet = new Set(validation.commands.map((item) => item.toUpperCase()));
        for (const entry of registry.entries) {
          const id = String(entry.id || "");
          const entryPath = String(entry.path || "").replaceAll("\\", "/");
          const commands = Array.isArray(entry.commands) ? entry.commands.map((item) => String(item).toUpperCase()) : [];
          if (id !== metadata.id && entryPath.toLowerCase() === normalizedPermanent.toLowerCase()) {
            throw new Error(`Registry path already belongs to another capability: ${id}`);
          }
          if (id !== metadata.id && commands.some((command) => commandSet.has(command))) {
            throw new Error(`One or more public commands are already registered by capability: ${id}`);
          }
        }

        const nextEntries = registry.entries.filter((entry) => String(entry.id || "") !== metadata.id);
        nextEntries.push(newEntry);
        nextEntries.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

        const registryTarget = path.join(getRepoRoot(), "registry", "lisp-registry.json");
        await atomicWrite(permanent, source);
        try {
          await atomicWrite(registryTarget, `${JSON.stringify({ version: registry.version, entries: nextEntries }, null, 2)}\n`);
        } catch (registryError) {
          // Keep permanent source and semantic discovery metadata inseparable.
          // If registry update fails, restore the exact previous source state.
          try {
            if (targetExists && previousPermanent !== null) {
              await atomicWrite(permanent, previousPermanent);
            } else {
              await fs.rm(permanent, { force: true });
            }
          } catch (rollbackError) {
            throw new Error(
              `Registry update failed and permanent-source rollback also failed. ` +
              `Registry error: ${String(registryError)}; rollback error: ${String(rollbackError)}`
            );
          }
          throw registryError;
        }

        return toolResult("lisp_promote_draft", {
          draft_path: toCadgptPath(draft),
          permanent_path: normalizedPermanent,
          registry_id: metadata.id,
          commands: validation.commands,
          sha256: validation.sha256,
          registry_updated: true,
          rollback_safe: true,
          draft_retained: true,
          note: "Draft is retained for traceability until explicitly cleaned; permanent source and semantic registry were promoted together.",
        });
      } catch (error) {
        return toolError("lisp_promote_draft", error);
      }
    }
  );
}
