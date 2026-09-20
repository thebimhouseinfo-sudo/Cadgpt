import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getAllowedRoots, getWritableRoots, resolveAbsoluteMutationPath, resolveAllowedPath, toCadgptPath } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";

const TEXT_EXTENSIONS = new Set([".lsp", ".dcl", ".md", ".txt", ".json", ".yaml", ".yml", ".csv"]);

function assertTextExtension(target: string): void {
  const ext = path.extname(target).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) throw new Error(`Unsupported CadGPT text asset type: ${ext || "<no extension>"}`);
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
      title: "CadGPT Managed File Roots",
      description: "Show managed AppData roots readable by generic file tools and the narrower roots writable by them. Permanent libraries are read-only here and change only through controlled import/promotion tools.",
      inputSchema: {},
    },
    async () => toolResult("file_roots", {
      roots: getAllowedRoots().map(toCadgptPath),
      absolute_roots: getAllowedRoots(),
      writable_roots: getWritableRoots().map(toCadgptPath),
      absolute_writable_roots: getWritableRoots(),
      managed_libraries_write_policy: "read-only to generic file tools; mutate through library_import/lisp_promote_draft/job_promote_draft",
    })
  );

  server.registerTool(
    "file_list",
    {
      title: "List CadGPT Managed Files",
      description: "List files/directories inside appdata/libraries/**, appdata/workspace/** or appdata/data/**.",
      inputSchema: {
        path: z.string().default("appdata/libraries"),
        recursive: z.boolean().optional().default(false),
        max_entries: z.number().int().positive().max(5000).optional().default(500),
      },
    },
    async ({ path: input, recursive, max_entries }) => {
      try {
        const target = await resolveAllowedPath(input);
        const stat = await fs.stat(target);
        if (stat.isFile()) return toolResult("file_list", { entries: [{ path: toCadgptPath(target), absolute_path: target, type: "file" }] });

        if (!recursive) {
          const entries = await fs.readdir(target, { withFileTypes: true });
          return toolResult("file_list", {
            entries: entries.slice(0, max_entries).map((entry) => ({
              path: toCadgptPath(path.join(target, entry.name)),
              absolute_path: path.join(target, entry.name),
              type: entry.isDirectory() ? "directory" : "file",
            })),
            truncated: entries.length > max_entries,
          });
        }

        const files: string[] = [];
        await walkFiles(target, files, max_entries + 1);
        const truncated = files.length > max_entries;
        return toolResult("file_list", {
          entries: files.slice(0, max_entries).map((item) => ({ path: toCadgptPath(item), absolute_path: item, type: "file" })),
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
      title: "Read CadGPT Managed Text File",
      description: "Read a text asset inside managed AppData. Supports line ranges.",
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
          path: toCadgptPath(target),
          absolute_path: target,
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
      title: "Search CadGPT Managed Files",
      description: "Search text inside managed AppData libraries/workspaces/data without accessing arbitrary machine paths.",
      inputSchema: {
        query: z.string().min(1),
        path: z.string().optional().default("appdata/libraries"),
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
            if (hit) results.push({ path: toCadgptPath(file), absolute_path: file, line: index + 1, text: line.trim() } as any);
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
      title: "Create CadGPT Managed Text File",
      description: "Create a new text asset inside generic writable AppData roots (workspace/data). path MUST be an absolute filesystem path. Permanent managed libraries are not writable through this tool.",
      inputSchema: { path: z.string(), content: z.string() },
    },
    async ({ path: input, content }) => {
      try {
        const target = await resolveAbsoluteMutationPath(input, { forCreate: true, allowedRoots: getWritableRoots(), label: "generic writable AppData" });
        assertTextExtension(target);
        try {
          await fs.lstat(target);
          throw new Error(`Target already exists: ${toCadgptPath(target)}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await atomicWrite(target, content);
        console.log(`[AUDIT] file_create ${toCadgptPath(target)} bytes=${Buffer.byteLength(content)}`);
        return toolResult("file_create", { path: toCadgptPath(target), absolute_path: target, bytes: Buffer.byteLength(content) });
      } catch (error) {
        return toolError("file_create", error);
      }
    }
  );

  server.registerTool(
    "file_edit",
    {
      title: "Edit CadGPT Managed Text File",
      description: "Apply an exact text replacement inside generic writable AppData roots (workspace/data). path MUST be an absolute filesystem path. Permanent managed libraries must use controlled promotion/import tools.",
      inputSchema: {
        path: z.string(),
        old_text: z.string(),
        new_text: z.string(),
        replace_all: z.boolean().optional().default(false),
      },
    },
    async ({ path: input, old_text, new_text, replace_all }) => {
      try {
        const target = await resolveAbsoluteMutationPath(input, { allowedRoots: getWritableRoots(), label: "generic writable AppData" });
        assertTextExtension(target);
        const original = await fs.readFile(target, "utf8");
        if (!original.includes(old_text)) throw new Error("old_text not found; read the file and use an exact match");
        const updated = replace_all ? original.split(old_text).join(new_text) : original.replace(old_text, new_text);
        await atomicWrite(target, updated);
        console.log(`[AUDIT] file_edit ${toCadgptPath(target)} replace_all=${replace_all}`);
        return toolResult("file_edit", {
          path: toCadgptPath(target),
          absolute_path: target,
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
