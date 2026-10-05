import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getAppDataRoot } from "../lib/appdata.js";
import { getAllowedRoots, getRepoRoot, getWritableRoots, resolveAbsoluteMutationPath, resolveAllowedPath, toCadgptPath } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { currentHumanPower, currentToolLease } from "../lib/work-registration.js";
import { currentJobSystemLease } from "../runtime/system-lease.js";
import {
  auditHumanPowerSourceMutation,
  isCadGptSourcePath,
} from "../runtime/human-power.js";
import { drawingMetadataRootsForExecution } from "../runtime/drawing-persistence.js";
import { jobRuntimeWritableRootsForExecution } from "../runtime/job-runtime.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";

const TEXT_EXTENSIONS = new Set([".lsp", ".dcl", ".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".py"]);

function currentDrawingMetadataRoots(): string[] {
  try {
    return drawingMetadataRootsForExecution(currentToolLease().workId);
  } catch {
    return [];
  }
}

function currentReadableRoots(): string[] {
  const systemLease = currentJobSystemLease();
  if (systemLease) {
    return [
      ...new Set([
        ...getAllowedRoots(),
        ...systemLease.readable_roots,
      ]),
    ];
  }

  const humanPowerRoots = currentHumanPower()
    ? [getAppDataRoot(), getRepoRoot()]
    : [];
  return [
    ...new Set([
      ...getAllowedRoots(),
      ...currentDrawingMetadataRoots(),
      ...humanPowerRoots,
    ]),
  ];
}

function currentWritableRoots(): string[] {
  const systemLease = currentJobSystemLease();
  if (systemLease) {
    return [...systemLease.writable_roots];
  }

  const humanPowerRoots = currentHumanPower()
    ? [getAppDataRoot(), getRepoRoot()]
    : [];
  let jobRoots: string[] = [];
  try {
    jobRoots = jobRuntimeWritableRootsForExecution(
      currentToolLease().workId
    );
  } catch {
    jobRoots = [];
  }
  const ordinaryRoots = jobRoots.length
    ? jobRoots
    : [
        ...getWritableRoots(),
        ...currentDrawingMetadataRoots(),
      ];
  return [
    ...new Set([
      ...ordinaryRoots,
      ...humanPowerRoots,
    ]),
  ];
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function assertTextExtension(target: string): void {
  if (currentHumanPower()) return;
  const ext = path.extname(target).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported CadGPT text asset type: ${ext || "<no extension>"}`
    );
  }
}

async function reloadCadMcpChildIfNeeded(target: string): Promise<boolean> {
  const runtimeRoot = path.resolve(getRepoRoot(), "runtimes", "cad-mcp");
  const normalized = path.resolve(target);
  if (
    normalized !== runtimeRoot &&
    !normalized.startsWith(runtimeRoot + path.sep)
  ) {
    return false;
  }
  const { cadUpstream } = await import("../runtime/cad-upstream.js");
  if (cadUpstream.status().enabled || cadUpstream.status().connected) {
    await cadUpstream.deactivate();
  }
  return true;
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
      description: "Show managed AppData roots readable/writable by generic file tools. Drawing metadata roots appear only after drawing_metadata_location authorizes the exact drawing folder for this execution.",
      inputSchema: {},
    },
    async () => toolResult("file_roots", {
      roots: currentReadableRoots().map(toCadgptPath),
      absolute_roots: currentReadableRoots(),
      writable_roots: currentWritableRoots().map(toCadgptPath),
      absolute_writable_roots: currentWritableRoots(),
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
        const target = await resolveAllowedPath(input, { allowedRoots: currentReadableRoots() });
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
        const target = await resolveAllowedPath(input, { allowedRoots: currentReadableRoots() });
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
          sha256: sha256(content),
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
      description: "Search text inside managed AppData libraries/workspaces/data or the execution-authorized drawing metadata root without accessing arbitrary machine paths.",
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
        const target = await resolveAllowedPath(input, { allowedRoots: currentReadableRoots() });
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
      description: "Create a new text asset inside generic writable AppData roots (workspace/data plus the execution-authorized drawing metadata root). path MUST be an absolute filesystem path. Permanent managed libraries are not writable through this tool.",
      inputSchema: {
        path: z.string(),
        content: z.string(),
        human_power_fix: z.string().max(6000).optional(),
      },
    },
    async ({ path: input, content, human_power_fix }) => {
      try {
        const target = await resolveAbsoluteMutationPath(input, {
          forCreate: true,
          allowedRoots: currentWritableRoots(),
          label: currentHumanPower()
            ? "Human Power writable scope"
            : "execution-authorized writable AppData",
        });
        assertTextExtension(target);
        const sourceMutation = isCadGptSourcePath(target);
        if (sourceMutation && !currentHumanPower()) {
          throw new Error(
            "HUMAN_POWER_REQUIRED: CadGPT source creation requires active Human Power."
          );
        }
        if (sourceMutation && !human_power_fix?.trim()) {
          throw new Error(
            "HUMAN_POWER_SOURCE_FIX_REQUIRED: source creation must explain how this change fixes the recorded Human Power error."
          );
        }
        return await withFileMutationLocks([target], async () => {
          await fs.mkdir(path.dirname(target), { recursive: true });
          try {
            await fs.writeFile(target, content, {
              encoding: "utf8",
              flag: "wx",
            });
            if (sourceMutation) {
              try {
                await auditHumanPowerSourceMutation({
                  executionId: currentToolLease().workId,
                  target,
                  action: "create",
                  fixSummary: human_power_fix || "",
                  sha256Before: null,
                  sha256After: sha256(content),
                });
              } catch (auditError) {
                await fs.rm(target, { force: true });
                throw auditError;
              }
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") {
              throw new Error(
                `Target already exists: ${toCadgptPath(target)}`
              );
            }
            throw error;
          }
          const cadMcpChildReloaded =
            sourceMutation && (await reloadCadMcpChildIfNeeded(target));
          console.log(
            `[AUDIT] file_create ${toCadgptPath(target)} bytes=${Buffer.byteLength(content)}`
          );
          return toolResult("file_create", {
            path: toCadgptPath(target),
            absolute_path: target,
            bytes: Buffer.byteLength(content),
            human_power_source_mutation: sourceMutation,
            cad_mcp_child_reloaded: cadMcpChildReloaded,
            runtime_effect:
              sourceMutation && !cadMcpChildReloaded
                ? "source_changed; non-CAD-MCP core changes require normal CadGPT rebuild/restart before they take effect"
                : "active",
          });
        });
      } catch (error) {
        return toolError("file_create", error);
      }
    }
  );

  server.registerTool(
    "file_edit",
    {
      title: "Edit CadGPT Managed Text File",
      description: "Apply an exact text replacement inside generic writable AppData roots (workspace/data plus the execution-authorized drawing metadata root). path MUST be an absolute filesystem path. Permanent managed libraries must use controlled promotion/import tools.",
      inputSchema: {
        path: z.string(),
        expected_sha256: z.string().length(64).describe("sha256 returned by file_read; prevents silent overwrite if another execution changed the file"),
        old_text: z.string(),
        new_text: z.string(),
        replace_all: z.boolean().optional().default(false),
        human_power_fix: z.string().max(6000).optional(),
      },
    },
    async ({
      path: input,
      expected_sha256,
      old_text,
      new_text,
      replace_all,
      human_power_fix,
    }) => {
      try {
        const target = await resolveAbsoluteMutationPath(input, {
          allowedRoots: currentWritableRoots(),
          label: currentHumanPower()
            ? "Human Power writable scope"
            : "execution-authorized writable AppData",
        });
        assertTextExtension(target);
        const sourceMutation = isCadGptSourcePath(target);
        if (sourceMutation && !currentHumanPower()) {
          throw new Error(
            "HUMAN_POWER_REQUIRED: CadGPT source editing requires active Human Power."
          );
        }
        if (sourceMutation && !human_power_fix?.trim()) {
          throw new Error(
            "HUMAN_POWER_SOURCE_FIX_REQUIRED: source edits must explain how the patch fixes the recorded Human Power error."
          );
        }
        return await withFileMutationLocks([target], async () => {
          const original = await fs.readFile(target, "utf8");
          const currentHash = sha256(original);
          if (currentHash !== expected_sha256) {
            throw new Error(`RESOURCE_CONFLICT: expected sha256 ${expected_sha256}, current ${currentHash}`);
          }
          if (!original.includes(old_text)) {
            throw new Error("old_text not found; read the file and use an exact match");
          }
          const updated = replace_all
            ? original.split(old_text).join(new_text)
            : original.replace(old_text, new_text);

          // Re-check immediately before replace. This cannot force unrelated
          // external writers to honor our lock, but it closes the ordinary
          // stale-write window and prevents silent same-process overwrite.
          const latest = await fs.readFile(target, "utf8");
          if (sha256(latest) !== currentHash) {
            throw new Error("RESOURCE_CONFLICT: file changed during edit preparation");
          }

          await atomicWrite(target, updated);
          const updatedHash = sha256(updated);
          if (sourceMutation) {
            try {
              await auditHumanPowerSourceMutation({
                executionId: currentToolLease().workId,
                target,
                action: "edit",
                fixSummary: human_power_fix || "",
                sha256Before: currentHash,
                sha256After: updatedHash,
              });
            } catch (auditError) {
              await atomicWrite(target, original);
              throw auditError;
            }
          }
          const cadMcpChildReloaded =
            sourceMutation && (await reloadCadMcpChildIfNeeded(target));
          console.log(
            `[AUDIT] file_edit ${toCadgptPath(target)} replace_all=${replace_all}`
          );
          return toolResult("file_edit", {
            path: toCadgptPath(target),
            absolute_path: target,
            changed: true,
            sha256_before: currentHash,
            sha256_after: updatedHash,
            bytes_before: Buffer.byteLength(original),
            bytes_after: Buffer.byteLength(updated),
            human_power_source_mutation: sourceMutation,
            cad_mcp_child_reloaded: cadMcpChildReloaded,
            runtime_effect:
              sourceMutation && !cadMcpChildReloaded
                ? "source_changed; non-CAD-MCP core changes require normal CadGPT rebuild/restart before they take effect"
                : "active",
          });
        });
      } catch (error) {
        return toolError("file_edit", error);
      }
    }
  );
  server.registerTool(
    "file_delete",
    {
      title: "Delete CadGPT Managed Text File",
      description:
        "Delete one text file inside the current execution-authorized writable scope. Intended for Job runtime/result cleanup after successful persist/verify. Directories and CadGPT source files are never deleted by this generic tool. expected_sha256 must match the current file bytes to prevent stale cleanup.",
      inputSchema: {
        path: z.string(),
        expected_sha256: z
          .string()
          .length(64)
          .describe(
            "sha256 returned by file_read; deletion is refused if the file changed after verification"
          ),
      },
    },
    async ({ path: input, expected_sha256 }) => {
      try {
        const target =
          await resolveAbsoluteMutationPath(input, {
            allowedRoots:
              currentWritableRoots(),
            label:
              "execution-authorized writable AppData",
          });
        assertTextExtension(target);
        if (isCadGptSourcePath(target)) {
          throw new Error(
            "SOURCE_DELETE_UNSUPPORTED: generic file_delete never deletes CadGPT source files."
          );
        }

        return await withFileMutationLocks(
          [target],
          async () => {
            const stat = await fs.stat(target);
            if (!stat.isFile()) {
              throw new Error(
                "FILE_DELETE_FILE_REQUIRED: file_delete accepts files only; directories are not allowed."
              );
            }

            const original =
              await fs.readFile(target, "utf8");
            const currentHash =
              sha256(original);
            if (
              currentHash !== expected_sha256
            ) {
              throw new Error(
                `RESOURCE_CONFLICT: expected sha256 ${expected_sha256}, current ${currentHash}`
              );
            }

            const latest =
              await fs.readFile(target, "utf8");
            if (
              sha256(latest) !==
              currentHash
            ) {
              throw new Error(
                "RESOURCE_CONFLICT: file changed during delete preparation"
              );
            }

            await fs.unlink(target);
            console.log(
              `[AUDIT] file_delete ${toCadgptPath(target)} bytes=${Buffer.byteLength(original)}`
            );
            return toolResult(
              "file_delete",
              {
                path:
                  toCadgptPath(target),
                absolute_path: target,
                deleted: true,
                sha256: currentHash,
                bytes:
                  Buffer.byteLength(
                    original
                  ),
              }
            );
          }
        );
      } catch (error) {
        return toolError(
          "file_delete",
          error
        );
      }
    }
  );

}
