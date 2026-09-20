import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getJobLibrariesRoot,
  getLispLibrariesRoot,
  getUserCapabilitiesPath,
  getUserLibrariesManifestPath,
  getUserRegistryRoot,
} from "../lib/appdata.js";
import { toCadgptPath } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";

const LIBRARY_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MAX_IMPORT_FILES = 10000;
const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
type LibraryKind = "lisp" | "job";

interface LibraryRecord {
  id: string;
  kind: LibraryKind;
  name: string;
  enabled: boolean;
  managed_path: string;
  imported_from: string;
  imported_at?: string;
  import_mode: "managed-copy";
  source_access: "read-only";
  authoring_profile?: "cadgpt" | "tbh";
}

async function readJson<T>(target: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function readOptionalText(target: string): Promise<string | null> {
  try {
    return await fs.readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicText(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, content, "utf8");
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

async function atomicJson(target: string, value: unknown): Promise<void> {
  await atomicText(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function restoreOptionalText(target: string, previous: string | null): Promise<void> {
  if (previous === null) await fs.rm(target, { force: true });
  else await atomicText(target, previous);
}

async function assertSafeSourceTree(current: string): Promise<{ files: number; bytes: number }> {
  const stat = await fs.lstat(current);
  if (stat.isSymbolicLink()) throw new Error(`Library import rejects symlinks: ${current}`);
  if (stat.isFile()) return { files: 1, bytes: stat.size };
  if (!stat.isDirectory()) throw new Error(`Unsupported filesystem entry in library source: ${current}`);

  let files = 0;
  let bytes = 0;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".svn") continue;
    const nested = await assertSafeSourceTree(path.join(current, entry.name));
    files += nested.files;
    bytes += nested.bytes;
    if (files > MAX_IMPORT_FILES) throw new Error(`Library import exceeds ${MAX_IMPORT_FILES} files`);
    if (bytes > MAX_IMPORT_BYTES) throw new Error(`Library import exceeds ${MAX_IMPORT_BYTES} bytes`);
  }
  return { files, bytes };
}

async function walk(root: string, predicate: (value: string) => boolean, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(full, predicate, out);
    else if (entry.isFile() && predicate(full)) out.push(full);
  }
  return out;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/\\/g, "/").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "asset";
}

function extractCommands(source: string): string[] {
  const commands = [...source.matchAll(/\(\s*defun\s+c:([^\s()]+)/gi)].map((m) => m[1].toUpperCase());
  return [...new Set(commands)].sort();
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function staleNotes(prior: Record<string, unknown>, note: string): string[] {
  const existing = Array.isArray(prior.implementation_notes) ? prior.implementation_notes.map(String) : [];
  return [...existing, note].slice(-50);
}

async function discoverLispEntries(libraryId: string, root: string, existing: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const files = await walk(root, (file) => path.extname(file).toLowerCase() === ".lsp");
  const byPath = new Map(
    existing
      .filter((entry) => entry.kind === "lisp" && entry.library_id === libraryId)
      .map((entry) => [String(entry.relative_path || "").toLowerCase(), entry])
  );
  const result: Array<Record<string, unknown>> = [];

  for (const file of files.sort()) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const source = await fs.readFile(file, "utf8");
    const commands = extractCommands(source);
    const implementationHash = sha256(source);
    const prior = byPath.get(relative.toLowerCase());
    if (prior) {
      const sameImplementation = String(prior.implementation_sha256 || "") === implementationHash;
      if (sameImplementation) {
        result.push({ ...prior, commands, relative_path: relative, implementation_sha256: implementationHash });
      } else {
        result.push({
          ...prior,
          commands,
          relative_path: relative,
          implementation_sha256: implementationHash,
          summary: "Re-imported AutoLISP implementation changed; semantic behavior requires review before trusted use.",
          when_to_use: [],
          targets: [],
          inputs: [],
          effects: [],
          interaction: "unknown",
          load_behavior: "unknown",
          mutates_drawing: null,
          destructive: null,
          risk: "unknown",
          dynamic_parameters: [],
          semantic_status: "needs_review",
          implementation_notes: staleNotes(prior, "Implementation hash changed during re-import; prior semantic/safety metadata was invalidated until reviewed."),
        });
      }
      continue;
    }
    result.push({
      id: `${libraryId}.lisp.${slug(relative)}`,
      kind: "lisp",
      registry: "user",
      library_id: libraryId,
      relative_path: relative,
      title: path.basename(file, path.extname(file)),
      ai_mode: "static",
      class: "lisp.imported",
      subclass: "unclassified",
      tags: ["imported"],
      module: path.dirname(relative) === "." ? libraryId : path.dirname(relative).replaceAll("\\", "/"),
      commands,
      summary: "Imported AutoLISP capability; semantic and safety behavior has not yet been curated.",
      when_to_use: [],
      targets: [],
      inputs: [],
      effects: [],
      interaction: "unknown",
      load_behavior: "unknown",
      mutates_drawing: null,
      destructive: null,
      risk: "unknown",
      dynamic_parameters: [],
      semantic_status: "indexed",
      implementation_sha256: implementationHash,
      implementation_notes: ["Import/index never modifies the Lisp source. Curate behavior metadata from implementation before relying on semantic or safety assumptions."],
    });
  }
  return result;
}

async function discoverJobEntries(libraryId: string, root: string, existing: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const files = await walk(root, (file) => path.basename(file).toLowerCase() === "job.md");
  const byPath = new Map(
    existing
      .filter((entry) => entry.kind === "job" && entry.library_id === libraryId)
      .map((entry) => [String(entry.relative_path || "").toLowerCase(), entry])
  );
  const result: Array<Record<string, unknown>> = [];

  for (const file of files.sort()) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const content = await fs.readFile(file, "utf8");
    const implementationHash = sha256(content);
    const title = content.match(/^#\s+(?:Job:\s*)?(.+)$/mi)?.[1]?.trim() || path.basename(path.dirname(file));
    const status = content.match(/^Status:\s*(.+)$/mi)?.[1]?.replace(/\*\*/g, "").trim();
    const prior = byPath.get(relative.toLowerCase());
    if (prior) {
      const sameImplementation = String(prior.implementation_sha256 || "") === implementationHash;
      result.push({
        ...prior,
        title,
        ...(status ? { status } : {}),
        relative_path: relative,
        implementation_sha256: implementationHash,
        ...(!sameImplementation ? {
          semantic_status: "needs_review",
          risk: "unknown",
          summary: "Re-imported Job definition changed; workflow semantics require review before trusted execution.",
        } : {}),
      });
      continue;
    }
    result.push({
      id: `${libraryId}.job.${slug(relative.replace(/\/JOB\.md$/i, ""))}`,
      kind: "job",
      registry: "user",
      library_id: libraryId,
      relative_path: relative,
      title,
      class: "workflow.imported",
      subclass: "unclassified",
      tags: ["imported"],
      summary: "Imported CadGPT Job; semantic description has not yet been curated.",
      ...(status ? { status } : {}),
      risk: "unknown",
      semantic_status: "indexed",
      implementation_sha256: implementationHash,
    });
  }
  return result;
}

async function reindexLibrary(kind: LibraryKind, libraryId: string, root: string): Promise<number> {
  const registryPath = getUserCapabilitiesPath();
  const baseline = await readOptionalText(registryPath);
  const registry = baseline
    ? (JSON.parse(baseline) as { version: number; entries: Array<Record<string, unknown>> })
    : { version: 1, entries: [] as Array<Record<string, unknown>> };
  const others = registry.entries.filter((entry) => !(entry.kind === kind && entry.library_id === libraryId));
  const discovered = kind === "lisp"
    ? await discoverLispEntries(libraryId, root, registry.entries)
    : await discoverJobEntries(libraryId, root, registry.entries);
  const entries = [...others, ...discovered].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const current = await readOptionalText(registryPath);
  if (current !== baseline) {
    throw new Error("RESOURCE_CONFLICT: User Registry changed during library reindex");
  }
  await atomicJson(registryPath, { version: registry.version || 1, entries });
  return discovered.length;
}

export function registerLibraryTools(server: McpServer): void {
  server.registerTool(
    "library_list",
    {
      title: "List Managed User Libraries",
      description: "List Lisp/Job libraries already imported into CadGPT AppData. Runtime work uses these managed copies, never the original user folders.",
      inputSchema: { kind: z.enum(["lisp", "job"]).optional() },
    },
    async ({ kind }) => {
      try {
        const manifest = await readJson<{ version: number; libraries: LibraryRecord[] }>(getUserLibrariesManifestPath(), { version: 1, libraries: [] });
        const libraries = kind ? manifest.libraries.filter((item) => item.kind === kind) : manifest.libraries;
        return toolResult("library_list", { libraries, count: libraries.length });
      } catch (error) {
        return toolError("library_list", error);
      }
    }
  );

  server.registerTool(
    "library_import",
    {
      title: "Import User Library into CadGPT AppData",
      description: "Read one explicitly user-approved Lisp/Job source folder, copy it into managed CadGPT AppData, then index User Registry. CadGPT never writes to the source folder. Repository metadata folders and symlinks are rejected/skipped.",
      inputSchema: {
        kind: z.enum(["lisp", "job"]),
        library_id: z.string().regex(LIBRARY_ID),
        name: z.string().min(1).max(160),
        source_path: z.string().min(1).describe("Absolute user-selected source directory. It is read only during import."),
        user_approved_source: z.literal(true).describe("Must be true only after the user explicitly selected/approved this source folder."),
        replace_existing: z.boolean().optional().default(false),
      },
    },
    async ({ kind, library_id, name, source_path, user_approved_source, replace_existing }) => {
      try {
        if (!user_approved_source) throw new Error("Library import requires explicit user approval of source_path");
        if (!path.isAbsolute(source_path)) throw new Error("source_path must be an absolute directory selected by the user");
        const source = await fs.realpath(source_path);
        const stat = await fs.stat(source);
        if (!stat.isDirectory()) throw new Error("source_path must be a directory");
        const sourceStats = await assertSafeSourceTree(source);

        const parent = kind === "lisp" ? getLispLibrariesRoot() : getJobLibrariesRoot();
        await fs.mkdir(parent, { recursive: true });
        const target = path.join(parent, library_id);
        const temp = path.join(parent, `.${library_id}.import-${randomUUID()}`);
        const backup = path.join(parent, `.${library_id}.backup-${randomUUID()}`);

        try {
          await fs.cp(source, temp, {
            recursive: true,
            force: false,
            errorOnExist: true,
            filter: (sourceItem) => {
              const parts = path.resolve(sourceItem).split(path.sep);
              return !parts.includes(".git") && !parts.includes(".svn");
            },
          });
        } catch (error) {
          await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }

        const manifestPath = getUserLibrariesManifestPath();
        const registryPath = getUserCapabilitiesPath();

        return await withFileMutationLocks(
          [target, manifestPath, registryPath],
          async () => {
            let existed = false;
            try {
              await fs.lstat(target);
              existed = true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
            if (existed && !replace_existing) {
              await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
              throw new Error(`Managed library already exists: ${library_id}`);
            }

            const previousManifest = await readOptionalText(manifestPath);
            const previousRegistry = await readOptionalText(registryPath);
            let backedUp = false;
            let swapped = false;

            try {
              if (existed) {
                await fs.rename(target, backup);
                backedUp = true;
              }
              await fs.rename(temp, target);
              swapped = true;

          await fs.mkdir(getUserRegistryRoot(), { recursive: true });
          const manifestBaseline = await readOptionalText(manifestPath);
          const manifest = manifestBaseline
            ? (JSON.parse(manifestBaseline) as { version: number; libraries: LibraryRecord[] })
            : { version: 1, libraries: [] as LibraryRecord[] };
          const record: LibraryRecord = {
            id: library_id,
            kind,
            name,
            enabled: true,
            managed_path: toCadgptPath(target),
            imported_from: source,
            imported_at: new Date().toISOString(),
            import_mode: "managed-copy",
            source_access: "read-only",
            ...(kind === "lisp" ? { authoring_profile: library_id === "tbh-toolkit" ? "tbh" : "cadgpt" } : {}),
          };
          const libraries = manifest.libraries.filter((item) => !(item.id === library_id && item.kind === kind));
          libraries.push(record);
          libraries.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
          const manifestCurrent = await readOptionalText(manifestPath);
          if (manifestCurrent !== manifestBaseline) {
            throw new Error("RESOURCE_CONFLICT: User Library manifest changed during import");
          }
          await atomicJson(manifestPath, { version: manifest.version || 1, libraries });

          const capabilityCount = await reindexLibrary(kind, library_id, target);
          if (existed) await fs.rm(backup, { recursive: true, force: true });
          return toolResult("library_import", {
            library: record,
            source_was_read_only: true,
            files_copied: sourceStats.files,
            bytes_copied: sourceStats.bytes,
            capabilities_indexed: capabilityCount,
            rollback_safe: true,
            note: "All subsequent CadGPT operations use the managed AppData copy. Re-import is explicit; changed implementations invalidate prior trusted semantics until reviewed.",
          });
        } catch (error) {
          await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
          if (swapped) {
            await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
          }
          if (backedUp) {
            await fs.rename(backup, target).catch(() => undefined);
          }
          await restoreOptionalText(manifestPath, previousManifest).catch(() => undefined);
          await restoreOptionalText(registryPath, previousRegistry).catch(() => undefined);
          throw error;
            }
          }
        );
      } catch (error) {
        return toolError("library_import", error);
      }
    }
  );
}
