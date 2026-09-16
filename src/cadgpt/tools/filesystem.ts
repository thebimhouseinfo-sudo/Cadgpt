import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getAllowedRoots,
  getRepoRoot,
  resolveAllowedPath,
  toRepoRelative,
} from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";

const TEXT_EXTENSIONS = new Set([
  ".lsp",
  ".dcl",
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
]);

function assertTextExtension(target: string): void {
  const ext = path.extname(target).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported CadGPT text asset type: ${ext || "<no extension>"}`);
  }
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

async function walkFiles(root: string, out: string[], maxFiles: number): Promise<void> {
  if (out.length >= maxFiles) return;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= maxFiles) return;
    if (entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walkFiles(full, out, maxFiles);
    else if (entry.isFile()) out.push(full);
  }
}

export function registerFilesystemTools(server: McpServer): void {
  server.registerTool(
    "file_roots",
    {
      title: "CadGPT File Roots",
      description: "Show the only local repository roots accessible to CadGPT file tools.",
      inputSchema: {},
    },
    async () =>
      toolResult("file_roots", {
        repository: getRepoRoot(),
        roots: getAllowedRoots().map(toRepoRelative),
      })
  );

  server.registerTool(
    "file_list",
    {
      title: "List CadGPT Files",
      description: "List files or directories inside lisp/** or jobs/**. Paths outside the sandbox are rejected.",
      inputSchema: {
        path: z.string().default("lisp"),
        recursive: z.boolean().optional().default(false),
        max_entries: z.number().int().positive().max(5000).optional().default(500),
      },
    },
    async ({ path: input, recursive, max_entries }) => {
      try {
        const target = await resolveAllowedPath(input);
        const stat = await fs.stat(target);
        if (stat.isFile()) {
          return toolResult("file_list", { entries: [{ path: toRepoRelative(target), type: "file" }] });
        }

        if (!recursive) {
          const entries = await fs.readdir(target, { withFileTypes: true });
          return toolResult("file_list", {
            entries: entries.slice(0, max_entries).map((entry) => ({
              path: toRepoRelative(path.join(target, entry.name)),
              type: entry.isDirectory() ? "directory" : "file",
            })),
            truncated: entries.length > max_entries,
          });
        }

        const files: string[] = [];
        await walkFiles(target, files, max_entries + 1);
        const truncated = files.length > max_entries;
        return toolResult("file_list", {
          entries: files.slice(0, max_entries).map((item) => ({ path: toRepoRelative(item), type: "file" })),
          truncated,
        });
      } catch (error) {
        return toolError("file_list", error);
      }
    }
  );

  server.registerTool(
    "file_read",
    {
      title: "Read CadGPT Text File",
      description: "Read a text asset inside lisp/** or jobs/**. Supports line ranges.",
      inputSchema: {
        path: z.string(),
        start_line: z.number().int().positive().optional(),
        end_line: z.number().int().positive().optional(),
      },
    },
    async ({ path: input, start_line, end_line }) => {
      try {
        const target = await resolveAllowedPath(input);
        assertTextExtension(target);
        const content = await fs.readFile(target, "utf8");
        const lines = content.split(/\r?\n/);
        const start = start_line ? Math.max(0, start_line - 1) : 0;
        const end = end_line ? Math.min(lines.length, end_line) : lines.length;
        if (end < start) throw new Error("end_line must be greater than or equal to start_line");
        const selected = lines.slice(start, end);
        return toolResult("file_read", {
          path: toRepoRelative(target),
          start_line: start + 1,
          end_line: start + selected.length,
          total_lines: lines.length,
          content: selected.join("\n"),
        });
      } catch (error) {
        return toolError("file_read", error);
      }
    }
  );

  server.registerTool(
    "file_search",
    {
      title: "Search CadGPT Files",
      description: "Search text inside lisp/** or jobs/** without accessing the rest of the machine.",
      inputSchema: {
        query: z.string().min(1),
        path: z.string().optional().default("lisp"),
        regex: z.boolean().optional().default(false),
        case_sensitive: z.boolean().optional().default(false),
        max_results: z.number().int().positive().max(1000).optional().default(100),
      },
    },
    async ({ query, path: input, regex, case_sensitive, max_results }) => {
      try {
        const target = await resolveAllowedPath(input);
        const candidates: string[] = [];
        const stat = await fs.stat(target);
        if (stat.isFile()) candidates.push(target);
        else await walkFiles(target, candidates, 10000);

        const flags = case_sensitive ? "" : "i";
        const matcher = regex ? new RegExp(query, flags) : null;
        const needle = case_sensitive ? query : query.toLowerCase();
        const results: Array<{ path: string; line: number; text: string }> = [];

        for (const file of candidates) {
          if (results.length >= max_results) break;
          if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
          let content: string;
          try {
            content = await fs.readFile(file, "utf8");
          } catch {
            continue;
          }
          const lines = content.split(/\r?\n/);
          for (let index = 0; index < lines.length && results.length < max_results; index++) {
            const line = lines[index];
            const hit = matcher ? matcher.test(line) : (case_sensitive ? line : line.toLowerCase()).includes(needle);
            if (matcher) matcher.lastIndex = 0;
            if (hit) results.push({ path: toRepoRelative(file), line: index + 1, text: line.trim() });
          }
        }

        return toolResult("file_search", { results, count: results.length });
      } catch (error) {
        return toolError("file_search", error);
      }
    }
  );

  server.registerTool(
    "file_create",
    {
      title: "Create CadGPT Text File",
      description: "Create a new text asset inside lisp/** or jobs/**. Fails if the target already exists.",
      inputSchema: { path: z.string(), content: z.string() },
    },
    async ({ path: input, content }) => {
      try {
        const target = await resolveAllowedPath(input, { forCreate: true });
        assertTextExtension(target);
        try {
          await fs.lstat(target);
          throw new Error(`Target already exists: ${toRepoRelative(target)}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await atomicWrite(target, content);
        console.log(`[AUDIT] file_create ${toRepoRelative(target)} bytes=${Buffer.byteLength(content)}`);
        return toolResult("file_create", { path: toRepoRelative(target), bytes: Buffer.byteLength(content) });
      } catch (error) {
        return toolError("file_create", error);
      }
    }
  );

  server.registerTool(
    "file_edit",
    {
      title: "Edit CadGPT Text File",
      description: "Apply an exact text replacement inside lisp/** or jobs/**. Read the target first.",
      inputSchema: {
        path: z.string(),
        old_text: z.string(),
        new_text: z.string(),
        replace_all: z.boolean().optional().default(false),
      },
    },
    async ({ path: input, old_text, new_text, replace_all }) => {
      try {
        const target = await resolveAllowedPath(input);
        assertTextExtension(target);
        const original = await fs.readFile(target, "utf8");
        if (!original.includes(old_text)) throw new Error("old_text not found; read the file and use an exact match");
        const updated = replace_all ? original.split(old_text).join(new_text) : original.replace(old_text, new_text);
        await atomicWrite(target, updated);
        console.log(`[AUDIT] file_edit ${toRepoRelative(target)} replace_all=${replace_all}`);
        return toolResult("file_edit", {
          path: toRepoRelative(target),
          changed: true,
          bytes_before: Buffer.byteLength(original),
          bytes_after: Buffer.byteLength(updated),
        });
      } catch (error) {
        return toolError("file_edit", error);
      }
    }
  );
}
