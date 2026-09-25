import fs from "node:fs/promises";
import path from "node:path";

import { getRepoRoot, isPathInside } from "./path-security.js";

export interface BundledLispEntry {
  id: string;
  kind: "lisp";
  registry: "internal";
  title: string;
  library_id: string;
  relative_path: string;
  commands: string[];
}

export function getBundledLispLibrariesRoot(): string {
  // The committed TBH Lisp pack is installation content, not user AppData.
  return path.join(getRepoRoot(), "appdata", "libraries", "lisp");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("\\", "/")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "asset";
}

function commandsFromLisp(source: string): string[] {
  return [...new Set([...source.matchAll(/\(\s*defun\s+c:([^\s()]+)/gi)].map((m) => m[1].toUpperCase()))].sort();
}

function titleFromLisp(source: string, file: string, commands: string[]): string {
  const header = source.match(/^\s*;+\s*(?:Title|Description)\s*:\s*(.+)$/im)?.[1]?.trim();
  if (header) return header.slice(0, 180);
  if (commands.length === 1) return commands[0];
  return path.basename(file, path.extname(file));
}

async function walkLisp(root: string, out: string[] = []): Promise<string[]> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walkLisp(full, out);
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".lsp") out.push(full);
  }
  return out;
}

export async function listBundledLispEntries(): Promise<BundledLispEntry[]> {
  const root = getBundledLispLibrariesRoot();
  const files = await walkLisp(root);
  const result: BundledLispEntry[] = [];
  for (const file of files.sort((a, b) => a.localeCompare(b))) {
    const relFromRoot = path.relative(root, file).replaceAll("\\", "/");
    const parts = relFromRoot.split("/");
    if (parts.length < 2) continue;
    const libraryId = parts.shift()!;
    const relativePath = parts.join("/");
    const source = await fs.readFile(file, "utf8");
    const commands = commandsFromLisp(source);
    result.push({
      id: libraryId + ".lisp." + slug(relativePath),
      kind: "lisp",
      registry: "internal",
      title: titleFromLisp(source, file, commands),
      library_id: libraryId,
      relative_path: relativePath,
      commands,
    });
  }
  return result;
}

export async function resolveBundledLispPath(libraryId: string, relativePath: string): Promise<string> {
  const root = await fs.realpath(path.join(getBundledLispLibrariesRoot(), libraryId));
  const candidate = path.resolve(root, relativePath);
  if (!isPathInside(candidate, root)) throw new Error("Bundled Lisp path escapes library root.");
  const real = await fs.realpath(candidate);
  if (!isPathInside(real, root) || path.extname(real).toLowerCase() !== ".lsp") {
    throw new Error("Invalid bundled Lisp path.");
  }
  return real;
}
