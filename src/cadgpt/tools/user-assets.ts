import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getJobLibrariesRoot,
  getLispLibrariesRoot,
  getUserCapabilitiesPath,
  getUserLibrariesManifestPath,
  getUserRegistryRoot,
} from "../lib/appdata.js";
import { isPathInside, resolveAbsoluteMutationPath } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";

type AssetKind = "lisp" | "job";
type LibraryMode = "managed" | "external";

interface LibraryRecord {
  id: string;
  kind: AssetKind;
  name: string;
  mode: LibraryMode;
  root_path: string;
  enabled: boolean;
}

interface RegistryEntry {
  id: string;
  kind: AssetKind;
  title: string;
  library_id: string;
  relative_path: string;
  commands: string[];
}

interface UserRegistry {
  version: number;
  entries: RegistryEntry[];
}

const LIBRARY_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const MAX_FILES = 10000;
const MAX_BYTES = 256 * 1024 * 1024;

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
  const temp = path.join(path.dirname(target), "." + path.basename(target) + ".tmp");
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("\\", "/")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "asset";
}

function accepted(kind: AssetKind, file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return kind === "lisp" ? ext === ".lsp" : ext === ".md" || ext === ".py";
}

async function walk(root: string, kind: AssetKind, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".svn" || entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    const stat = await fs.lstat(full);
    if (stat.isSymbolicLink()) throw new Error("Folder contains a symbolic link/junction entry that CadGPT will not register: " + full);
    if (stat.isDirectory()) {
      await walk(full, kind, out);
    } else if (stat.isFile() && accepted(kind, full)) {
      out.push(full);
      if (out.length > MAX_FILES) throw new Error("Folder contains too many files to register.");
    }
  }
  return out;
}

async function assertSourceFolder(folderPath: string): Promise<string> {
  if (!path.isAbsolute(folderPath.trim())) throw new Error("Không tìm thấy thư mục này. Hãy kiểm tra lại đường dẫn và thử lại.");
  const real = await fs.realpath(folderPath.trim());
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new Error("Đường dẫn phải trỏ tới một thư mục.");
  return real;
}

function lispCommands(source: string): string[] {
  return [...new Set([...source.matchAll(/\(\s*defun\s+c:([^\s()]+)/gi)].map((m) => m[1].toUpperCase()))].sort();
}

function titleFromLisp(source: string, file: string, commands: string[]): string {
  const header = source.match(/^\s*;+\s*(?:Title|Description)\s*:\s*(.+)$/im)?.[1]?.trim();
  if (header) return header.slice(0, 180);
  if (commands.length === 1) return commands[0];
  return path.basename(file, path.extname(file));
}

function titleFromJob(source: string, file: string): string {
  if (path.extname(file).toLowerCase() === ".md") {
    const heading = source.match(/^#\s+(?:Job:\s*)?(.+)$/mi)?.[1]?.trim();
    if (heading) return heading.slice(0, 180);
  } else {
    const doc = source.match(/^\s*(?:[rubf]*)(?:"""|''')\s*([^\r\n]+)/i)?.[1]?.trim();
    if (doc) return doc.slice(0, 180);
    const comment = source.match(/^\s*#\s*(.+)$/m)?.[1]?.trim();
    if (comment) return comment.slice(0, 180);
  }
  return path.basename(file, path.extname(file));
}

async function indexLibrary(kind: AssetKind, libraryId: string, root: string): Promise<RegistryEntry[]> {
  const files = (await walk(root, kind)).sort((a, b) => a.localeCompare(b));
  const result: RegistryEntry[] = [];
  let bytes = 0;

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    bytes += Buffer.byteLength(content);
    if (bytes > MAX_BYTES) throw new Error("Folder is too large to register.");
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const commands = kind === "lisp" ? lispCommands(content) : [];
    const title = kind === "lisp"
      ? titleFromLisp(content, file, commands)
      : titleFromJob(content, file);
    result.push({
      id: libraryId + "." + kind + "." + slug(relative),
      kind,
      title,
      library_id: libraryId,
      relative_path: relative,
      commands,
    });
  }
  return result;
}

async function saveLibraryAndRegistry(record: LibraryRecord, entries: RegistryEntry[]): Promise<void> {
  await fs.mkdir(getUserRegistryRoot(), { recursive: true });
  const manifest = await readJson<{ version: number; libraries: LibraryRecord[] }>(
    getUserLibrariesManifestPath(),
    { version: 1, libraries: [] }
  );
  const nextLibraries = manifest.libraries.filter(
    (item) => !(item.id === record.id && item.kind === record.kind)
  );
  nextLibraries.push(record);
  nextLibraries.sort((a, b) => (a.kind + ":" + a.id).localeCompare(b.kind + ":" + b.id));

  const registry = await readJson<UserRegistry>(
    getUserCapabilitiesPath(),
    { version: 1, entries: [] }
  );
  const nextEntries = registry.entries.filter(
    (item) => !(item.kind === record.kind && item.library_id === record.id)
  );
  nextEntries.push(...entries);
  nextEntries.sort((a, b) => a.id.localeCompare(b.id));

  await atomicJson(getUserLibrariesManifestPath(), { version: manifest.version || 1, libraries: nextLibraries });
  await atomicJson(getUserCapabilitiesPath(), { version: registry.version || 1, entries: nextEntries });
}

function managedRoot(kind: AssetKind, libraryId: string): string {
  return path.join(kind === "lisp" ? getLispLibrariesRoot() : getJobLibrariesRoot(), libraryId);
}

export async function resolveRegisteredAssetPath(
  kind: AssetKind,
  libraryId: string,
  relativePath: string
): Promise<string> {
  const manifest = await readJson<{ libraries?: LibraryRecord[] }>(
    getUserLibrariesManifestPath(),
    { libraries: [] }
  );
  const record = (manifest.libraries ?? []).find(
    (item) => item.kind === kind && item.id === libraryId && item.enabled !== false
  );
  if (!record) throw new Error("Registered library not found: " + libraryId);
  const root = await fs.realpath(record.root_path);
  const candidate = path.resolve(root, relativePath);
  if (!isPathInside(candidate, root)) throw new Error("Registered asset path escapes library root.");
  const real = await fs.realpath(candidate);
  if (!isPathInside(real, root)) throw new Error("Registered asset path escapes library root.");
  return real;
}

async function importLibrary(kind: AssetKind, libraryId: string, name: string, folderPath: string, replaceExisting: boolean) {
  const source = await assertSourceFolder(folderPath);
  const targetParent = kind === "lisp" ? getLispLibrariesRoot() : getJobLibrariesRoot();
  await fs.mkdir(targetParent, { recursive: true });
  const target = await resolveAbsoluteMutationPath(path.join(targetParent, libraryId), {
    allowedRoots: [targetParent],
    forCreate: true,
    label: "CadGPT user library",
  });

  let exists = false;
  try {
    await fs.stat(target);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (exists && !replaceExisting) throw new Error("Library đã tồn tại. Chỉ thay thế khi user yêu cầu.");

  const staging = target + ".importing";
  await fs.rm(staging, { recursive: true, force: true });
  await fs.cp(source, staging, {
    recursive: true,
    filter: (item) => ![".git", ".svn"].includes(path.basename(item)),
  });
  if (exists) await fs.rm(target, { recursive: true, force: true });
  await fs.rename(staging, target);

  const entries = await indexLibrary(kind, libraryId, target);
  await saveLibraryAndRegistry({
    id: libraryId,
    kind,
    name,
    mode: "managed",
    root_path: target,
    enabled: true,
  }, entries);

  return { library_id: libraryId, kind, folder_path: target, registered: entries.length, entries };
}

async function registerExternalLibrary(kind: AssetKind, libraryId: string, name: string, folderPath: string) {
  const root = await assertSourceFolder(folderPath);
  const entries = await indexLibrary(kind, libraryId, root);
  await saveLibraryAndRegistry({
    id: libraryId,
    kind,
    name,
    mode: "external",
    root_path: root,
    enabled: true,
  }, entries);
  return { library_id: libraryId, kind, folder_path: root, registered: entries.length, entries };
}

async function exportLibrary(kind: AssetKind, libraryId: string, folderPath: string, overwrite: boolean) {
  const manifest = await readJson<{ libraries?: LibraryRecord[] }>(
    getUserLibrariesManifestPath(),
    { libraries: [] }
  );
  const record = (manifest.libraries ?? []).find(
    (item) => item.kind === kind && item.id === libraryId && item.enabled !== false
  );
  if (!record) throw new Error("Library chưa được đăng ký: " + libraryId);
  if (record.mode !== "managed") throw new Error("Export chỉ áp dụng cho Lisp/Job đang được quản lý trong CadGPT AppData.");

  const source = await fs.realpath(record.root_path);
  const destination = path.resolve(folderPath.trim());
  if (!path.isAbsolute(folderPath.trim())) throw new Error("Không tìm thấy thư mục này. Hãy kiểm tra lại đường dẫn và thử lại.");
  if (isPathInside(destination, source) || isPathInside(source, destination)) {
    throw new Error("Thư mục export không được trùng hoặc nằm bên trong thư mục nguồn của CadGPT.");
  }
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: overwrite, errorOnExist: !overwrite });
  return { library_id: libraryId, kind, folder_path: destination, exported: true };
}

export function registerUserAssetTools(server: McpServer): void {
  server.registerTool(
    "asset_import",
    {
      title: "Import Lisp or Job",
      description: "Copy a user folder into CadGPT AppData, read the copied Lisp/Job files, and register a lightweight index.",
      inputSchema: {
        kind: z.enum(["lisp", "job"]),
        library_id: z.string().regex(LIBRARY_ID),
        name: z.string().min(1).max(160),
        folder_path: z.string().min(1).describe("Đường dẫn thư mục user cung cấp"),
        replace_existing: z.boolean().optional().default(false),
      },
    },
    async ({ kind, library_id, name, folder_path, replace_existing }) => {
      try {
        return toolResult("asset_import", await importLibrary(kind, library_id, name, folder_path, replace_existing));
      } catch (error) {
        return toolError("asset_import", error);
      }
    }
  );

  server.registerTool(
    "asset_export",
    {
      title: "Export Lisp or Job",
      description: "Copy one managed AppData Lisp/Job library to the folder supplied by the user.",
      inputSchema: {
        kind: z.enum(["lisp", "job"]),
        library_id: z.string().regex(LIBRARY_ID),
        folder_path: z.string().min(1).describe("Đường dẫn thư mục user cung cấp"),
        overwrite: z.boolean().optional().default(false),
      },
    },
    async ({ kind, library_id, folder_path, overwrite }) => {
      try {
        return toolResult("asset_export", await exportLibrary(kind, library_id, folder_path, overwrite));
      } catch (error) {
        return toolError("asset_export", error);
      }
    }
  );

  server.registerTool(
    "asset_register_external",
    {
      title: "Register External Lisp or Job Folder",
      description: "Register and index a user Lisp/Job folder in place without copying it into AppData.",
      inputSchema: {
        kind: z.enum(["lisp", "job"]),
        library_id: z.string().regex(LIBRARY_ID),
        name: z.string().min(1).max(160),
        folder_path: z.string().min(1).describe("Đường dẫn thư mục user cung cấp"),
      },
    },
    async ({ kind, library_id, name, folder_path }) => {
      try {
        return toolResult("asset_register_external", await registerExternalLibrary(kind, library_id, name, folder_path));
      } catch (error) {
        return toolError("asset_register_external", error);
      }
    }
  );
}
