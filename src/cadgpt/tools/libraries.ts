import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

const LIBRARY_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
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

async function atomicJson(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

async function assertSafeSourceTree(root: string, current = root): Promise<number> {
  const stat = await fs.lstat(current);
  if (stat.isSymbolicLink()) throw new Error(`Library import rejects symlinks: ${current}`);
  if (stat.isFile()) return 1;
  if (!stat.isDirectory()) throw new Error(`Unsupported filesystem entry in library source: ${current}`);

  let count = 0;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".svn") continue;
    count += await assertSafeSourceTree(root, path.join(current, entry.name));
  }
  return count;
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
    const prior = byPath.get(relative.toLowerCase());
    if (prior) {
      result.push({ ...prior, commands, relative_path: relative });
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
      summary: "Imported AutoLISP capability; semantic description has not yet been curated.",
      when_to_use: [],
      targets: [],
      inputs: [],
      effects: [],
      interaction: "interactive",
      load_behavior: "define_only",
      mutates_drawing: false,
      destructive: false,
      risk: "medium",
      dynamic_parameters: [],
      semantic_status: "indexed",
      implementation_notes: ["Import/index never modifies the Lisp source. Curate behavior metadata from implementation before relying on semantic assumptions."],
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
    const title = content.match(/^#\s+(?:Job:\s*)?(.+)$/mi)?.[1]?.trim() || path.basename(path.dirname(file));
    const status = content.match(/^Status:\s*(.+)$/mi)?.[1]?.replace(/\*\*/g, "").trim();
    const prior = byPath.get(relative.toLowerCase());
    if (prior) {
      result.push({ ...prior, title, ...(status ? { status } : {}), relative_path: relative });
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
      risk: "medium",
      semantic_status: "indexed",
    });
  }
  return result;
}

async function reindexLibrary(kind: LibraryKind, libraryId: string, root: string): Promise<number> {
  const registryPath = getUserCapabilitiesPath();
  const registry = await readJson<{ version: number; entries: Array<Record<string, unknown>> }>(registryPath, { version: 1, entries: [] });
  const others = registry.entries.filter((entry) => !(entry.kind === kind && entry.library_id === libraryId));
  const discovered = kind === "lisp"
    ? await discoverLispEntries(libraryId, root, registry.entries)
    : await discoverJobEntries(libraryId, root, registry.entries);
  const entries = [...others, ...discovered].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
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
      description: "Read one user-selected Lisp/Job source folder, copy it into managed CadGPT AppData, then index User Registry. CadGPT never writes to the source folder.",
      inputSchema: {
        kind: z.enum(["lisp", "job"]),
        library_id: z.string().regex(LIBRARY_ID),
        name: z.string().min(1).max(160),
        source_path: z.string().min(1).describe("Absolute user-selected source directory. It is read only during import."),
        replace_existing: z.boolean().optional().default(false),
      },
    },
    async ({ kind, library_id, name, source_path, replace_existing }) => {
      try {
        if (!path.isAbsolute(source_path)) throw new Error("source_path must be an absolute directory selected by the user");
        const source = await fs.realpath(source_path);
        const stat = await fs.stat(source);
        if (!stat.isDirectory()) throw new Error("source_path must be a directory");
        const fileCount = await assertSafeSourceTree(source);

        const parent = kind === "lisp" ? getLispLibrariesRoot() : getJobLibrariesRoot();
        await fs.mkdir(parent, { recursive: true });
        const target = path.join(parent, library_id);
        const temp = path.join(parent, `.${library_id}.import-${randomUUID()}`);
        const backup = path.join(parent, `.${library_id}.backup-${randomUUID()}`);

        let existed = false;
        try {
          await fs.lstat(target);
          existed = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (existed && !replace_existing) throw new Error(`Managed library already exists: ${library_id}`);

        await fs.cp(source, temp, { recursive: true, force: false, errorOnExist: true });
        try {
          if (existed) await fs.rename(target, backup);
          await fs.rename(temp, target);
          await fs.rm(backup, { recursive: true, force: true });
        } catch (error) {
          await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
          if (existed) {
            try {
              await fs.rename(backup, target);
            } catch {}
          }
          throw error;
        }

        await fs.mkdir(getUserRegistryRoot(), { recursive: true });
        const manifestPath = getUserLibrariesManifestPath();
        const manifest = await readJson<{ version: number; libraries: LibraryRecord[] }>(manifestPath, { version: 1, libraries: [] });
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
        await atomicJson(manifestPath, { version: manifest.version || 1, libraries });

        const capabilityCount = await reindexLibrary(kind, library_id, target);
        return toolResult("library_import", {
          library: record,
          source_was_read_only: true,
          files_copied: fileCount,
          capabilities_indexed: capabilityCount,
          note: "All subsequent CadGPT operations use the managed AppData copy. Re-import is explicit; source folders are never mutated.",
        });
      } catch (error) {
        return toolError("library_import", error);
      }
    }
  );
}
