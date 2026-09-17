import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getLispLibrariesRoot,
  getLispDraftRoot,
  getUserCapabilitiesPath,
  getUserLibrariesManifestPath,
} from "../lib/appdata.js";
import { resolveAllowedPath, toCadgptPath } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import {
  applyAuthoringHeader,
  profileForLibrary,
  validateLispSource,
  type LispAuthoringProfile,
} from "./lisp-harness.js";

const semanticMetadataSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  ai_mode: z.enum(["static", "dynamic"]),
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

interface UserRegistry {
  version: number;
  entries: Array<Record<string, unknown>>;
}

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

async function readJson<T>(target: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function loadRegistry(): Promise<UserRegistry> {
  const parsed = await readJson<Partial<UserRegistry>>(getUserCapabilitiesPath(), { version: 1, entries: [] });
  if (!Array.isArray(parsed.entries)) throw new Error("User Registry is missing entries[]");
  return { version: Number(parsed.version || 1), entries: parsed.entries };
}

async function assertManagedLibraryExists(libraryId: string): Promise<void> {
  const manifest = await readJson<{ libraries?: Array<Record<string, unknown>> }>(getUserLibrariesManifestPath(), { libraries: [] });
  const match = (manifest.libraries ?? []).find((item) => item.kind === "lisp" && item.id === libraryId && item.enabled !== false);
  if (!match) throw new Error(`Enabled managed Lisp library not found in libraries.json: ${libraryId}`);
}

function safeRelativeLisp(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized.toLowerCase().endsWith(".lsp") || normalized.split("/").includes("..")) {
    throw new Error("relative_path must be a safe .lsp path inside the managed library");
  }
  return normalized;
}

function assertDraftVirtualPath(value: string): void {
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  if (!normalized.startsWith("appdata/workspace/lisp-draft/") || !normalized.endsWith(".lsp")) {
    throw new Error("Draft path must be an .lsp file under appdata/workspace/lisp-draft/**");
  }
}

function managedLispPath(libraryId: string, relativePath: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(libraryId)) throw new Error("Invalid library_id");
  const relative = safeRelativeLisp(relativePath);
  const root = path.resolve(getLispLibrariesRoot(), libraryId);
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Managed Lisp path escapes library root");
  return target;
}

function draftPathFor(libraryId: string, relativePath: string): string {
  const relative = safeRelativeLisp(relativePath);
  return path.resolve(getLispDraftRoot(), libraryId, relative);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function registerLispWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "lisp_checkout",
    {
      title: "Checkout Managed Lisp for write-lisp",
      description: "Copy one registered managed Lisp into AppData workspace for editing or repair. Source syntax problems are reported but do not block checkout; promotion remains strict. TBH Toolkit keeps the TBH authoring profile.",
      inputSchema: {
        registry_id: z.string().min(1),
        description: z.string().min(1).max(1200).optional(),
      },
    },
    async ({ registry_id, description }) => {
      try {
        const registry = await loadRegistry();
        const entry = registry.entries.find((item) => item.kind === "lisp" && String(item.id).toLowerCase() === registry_id.trim().toLowerCase());
        if (!entry) throw new Error(`Managed Lisp capability not found in User Registry: ${registry_id}`);
        const libraryId = String(entry.library_id || "");
        const relativePath = safeRelativeLisp(String(entry.relative_path || ""));
        const sourcePath = managedLispPath(libraryId, relativePath);
        const source = await fs.readFile(sourcePath, "utf8");
        const syntax = validateLispSource(source, asStringArray(entry.commands), { profile: "syntax", fileName: path.basename(sourcePath) });

        const profile = profileForLibrary(libraryId);
        const command = syntax.commands.join(", ") || asStringArray(entry.commands).join(", ") || "HELPER";
        const normalized = applyAuthoringHeader(source, {
          profile,
          fileName: path.basename(sourcePath),
          module: String(entry.module || libraryId),
          command,
          description: description || String(entry.summary || entry.title || "Managed AutoLISP capability."),
          inputs: asStringArray(entry.inputs).join("; ") || "As prompted by the command.",
          effects: asStringArray(entry.effects).join("; ") || "See implementation and User Registry metadata.",
          interaction: String(entry.interaction || "interactive"),
          risk: String(entry.risk || "medium"),
          dependencies: "AutoLISP/Visual LISP as used by implementation.",
          notes: `Checked out from User Registry capability ${String(entry.id)}. External import source is never modified.`,
          revision: syntax.valid
            ? "Working copy prepared by CadGPT write-lisp."
            : "Repair working copy prepared by CadGPT write-lisp; source contained blocking diagnostics.",
        });
        const draft = draftPathFor(libraryId, relativePath);
        await atomicWrite(draft, normalized);
        return toolResult("lisp_checkout", {
          registry_id: entry.id,
          library_id: libraryId,
          source_path: toCadgptPath(sourcePath),
          draft_path: toCadgptPath(draft),
          authoring_profile: profile,
          source_valid: syntax.valid,
          source_diagnostics: syntax.diagnostics,
          repair_required: !syntax.valid,
          header_normalized_in_draft_only: true,
          managed_source_unchanged: true,
          note: "Repair/implement in the draft, run lisp_draft_validate, perform approved CAD testing, then lisp_promote_draft. Import source outside AppData remains untouched.",
        });
      } catch (error) {
        return toolError("lisp_checkout", error);
      }
    }
  );

  server.registerTool(
    "lisp_draft_validate",
    {
      title: "Validate AutoLISP Workspace Draft",
      description: "Run AutoLISP correctness/safety plus an optional CadGPT/TBH authoring profile against a draft under appdata/workspace/lisp-draft/**.",
      inputSchema: {
        path: z.string().min(1),
        expected_commands: z.array(z.string().min(1)).max(50).optional().default([]),
        profile: z.enum(["syntax", "cadgpt", "tbh"]).optional().default("syntax"),
      },
    },
    async ({ path: input, expected_commands, profile }) => {
      try {
        assertDraftVirtualPath(input);
        const target = await resolveAllowedPath(input);
        const source = await fs.readFile(target, "utf8");
        const result = validateLispSource(source, expected_commands, { profile: profile as LispAuthoringProfile, fileName: path.basename(target) });
        return toolResult(
          "lisp_draft_validate",
          { path: toCadgptPath(target), dialect: "AutoLISP/Visual LISP", authoring_profile: profile, ...result },
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
      title: "Promote Tested Lisp Draft to Managed Library",
      description: "Promote one tested workspace draft into an existing managed AppData Lisp Library and upsert its User Registry metadata as one rollback-safe operation. Helper-only Lisp without public c: commands is supported.",
      inputSchema: {
        draft_path: z.string().min(1),
        library_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i),
        relative_path: z.string().min(1),
        metadata: semanticMetadataSchema,
        overwrite: z.boolean().optional().default(false),
      },
    },
    async ({ draft_path, library_id, relative_path, metadata, overwrite }) => {
      try {
        assertDraftVirtualPath(draft_path);
        await assertManagedLibraryExists(library_id);
        const normalizedRelative = safeRelativeLisp(relative_path);
        if (metadata.ai_mode === "static" && metadata.dynamic_parameters.length) throw new Error("dynamic_parameters must be empty when ai_mode=static");
        if (metadata.ai_mode === "dynamic" && !metadata.dynamic_parameters.length) throw new Error("ai_mode=dynamic requires at least one declared dynamic_parameter");

        const draft = await resolveAllowedPath(draft_path);
        const source = await fs.readFile(draft, "utf8");
        const permanent = managedLispPath(library_id, normalizedRelative);
        const profile = profileForLibrary(library_id);
        const validation = validateLispSource(source, [], { profile, fileName: path.basename(permanent) });
        if (!validation.valid) {
          throw new Error(`Draft failed AutoLISP/${profile} validation; promotion blocked (${validation.diagnostics.filter((item) => item.severity === "error").map((item) => item.code).join(", ")})`);
        }

        let targetExists = false;
        let previousPermanent: string | null = null;
        try {
          previousPermanent = await fs.readFile(permanent, "utf8");
          targetExists = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (targetExists && !overwrite) throw new Error(`Managed target already exists; set overwrite=true for an intentional replacement: ${toCadgptPath(permanent)}`);

        const registry = await loadRegistry();
        const newEntry: Record<string, unknown> = {
          id: metadata.id,
          kind: "lisp",
          registry: "user",
          library_id,
          relative_path: normalizedRelative,
          title: metadata.title,
          ai_mode: metadata.ai_mode,
          class: metadata.class_name,
          subclass: metadata.subclass,
          tags: metadata.tags,
          module: metadata.module,
          commands: validation.commands,
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
          semantic_status: "curated",
          implementation_notes: metadata.implementation_notes,
          implementation_sha256: validation.sha256,
        };

        const commandSet = new Set(validation.commands.map((item) => item.toUpperCase()));
        for (const entry of registry.entries) {
          const id = String(entry.id || "");
          if (id === metadata.id && entry.kind !== "lisp") throw new Error(`Registry id belongs to a non-Lisp capability: ${metadata.id}`);
          if (entry.kind !== "lisp") continue;
          const sameTarget = String(entry.library_id || "") === library_id && String(entry.relative_path || "").toLowerCase() === normalizedRelative.toLowerCase();
          const commands = asStringArray(entry.commands).map((item) => item.toUpperCase());
          if (id !== metadata.id && sameTarget) throw new Error(`Managed library path already belongs to another capability: ${id}`);
          if (id !== metadata.id && commands.some((command) => commandSet.has(command))) throw new Error(`One or more public commands are already registered by capability: ${id}`);
        }

        const nextEntries = registry.entries.filter((entry) => String(entry.id || "") !== metadata.id);
        nextEntries.push(newEntry);
        nextEntries.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

        await fs.mkdir(path.dirname(permanent), { recursive: true });
        await atomicWrite(permanent, source);
        try {
          await atomicWrite(getUserCapabilitiesPath(), `${JSON.stringify({ version: registry.version, entries: nextEntries }, null, 2)}\n`);
        } catch (registryError) {
          try {
            if (targetExists && previousPermanent !== null) await atomicWrite(permanent, previousPermanent);
            else await fs.rm(permanent, { force: true });
          } catch (rollbackError) {
            throw new Error(`Registry update failed and managed-source rollback failed. Registry: ${String(registryError)}; rollback: ${String(rollbackError)}`);
          }
          throw registryError;
        }

        return toolResult("lisp_promote_draft", {
          draft_path: toCadgptPath(draft),
          managed_path: toCadgptPath(permanent),
          library_id,
          registry_id: metadata.id,
          ai_mode: metadata.ai_mode,
          authoring_profile: profile,
          commands: validation.commands,
          helper_only: validation.commands.length === 0,
          sha256: validation.sha256,
          registry_updated: true,
          rollback_safe: true,
          draft_retained: true,
        });
      } catch (error) {
        return toolError("lisp_promote_draft", error);
      }
    }
  );
}
