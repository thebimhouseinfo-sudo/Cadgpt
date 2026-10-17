import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { activeWorkForSession, currentToolLease } from "../lib/work-registration.js";
import { ownedSourceRoot, resolveOwnedSourceMutation, type OwnedSource } from "../lib/owned-source.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";
import { toolError, toolResult } from "../lib/tool-result.js";

const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const extension = new Set([".md", ".txt", ".json", ".py", ".lsp", ".dcl", ".csv", ".yaml", ".yml"]);
function assertBuilder(): void {
  const lease = currentToolLease();
  const active = activeWorkForSession(lease.sessionKey);
  if (!active || active.executionId !== lease.workId ||
      active.ownerType === "job" || active.executionPath === "cad" ||
      (active.ownerId !== "job-authoring" && active.ownerId !== "lisp-authoring" &&
       active.ownerId !== "jobcreate" &&
       !active.capabilities.includes("job-authoring") &&
       !active.capabilities.includes("lisp-authoring"))) {
    throw new Error("V5_EXPLICIT_BUILDER_WORK_REQUIRED");
  }
}
function owner(kind: "reusable-job" | "reusable-lisp", libraryId: string, folder: string): OwnedSource {
  return { kind, libraryId, relativeFolder: folder };
}
function targetFor(o: OwnedSource, relative: string): string {
  if (!relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative) ||
      relative.replaceAll("\\", "/").split("/").some(s => !s || s === "." || s === "..")) {
    throw new Error("V5_INVALID_SOURCE_RELATIVE_PATH");
  }
  const target = path.resolve(ownedSourceRoot(o), relative);
  if (!extension.has(path.extname(target).toLowerCase())) throw new Error("V5_SOURCE_EXTENSION_NOT_SUPPORTED");
  return target;
}
export function registerV5BuilderSourceTools(server: McpServer): void {
  const schema = {
    kind: z.enum(["reusable-job", "reusable-lisp"]),
    library_id: z.string().min(1),
    folder: z.string().min(1),
    relative_file: z.string().min(1),
    content: z.string(),
  };
  server.registerTool("v5_source_create", {
    title: "Create reusable Job/Lisp source in final owner folder",
    description: "Builder-only new file in explicitly requested owned managed folder. No checkout/draft/promote.",
    inputSchema: schema,
  }, async ({ kind, library_id, folder, relative_file, content }) => {
    try {
      assertBuilder();
      const o = owner(kind, library_id, folder);
      const target = targetFor(o, relative_file);
      const directory = ownedSourceRoot(o);
      await fs.mkdir(directory, { recursive: true });
      const result = await withFileMutationLocks([target], async () => {
        const resolved = await resolveOwnedSourceMutation(target, o, { forCreate: true });
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        const checked = await resolveOwnedSourceMutation(target, o, { forCreate: true });
        await fs.writeFile(checked, content, { flag: "wx" });
        return { path: checked, sha256: digest(content) };
      });
      return toolResult("v5_source_create", result);
    } catch (e) { return toolError("v5_source_create", e); }
  });
  server.registerTool("v5_source_update", {
    title: "Update existing owned reusable Job/Lisp source",
    description: "Builder-only exact SHA-256 compare and replace. No promotion or registry side effects.",
    inputSchema: { ...schema, expected_sha256: z.string().regex(/^[0-9a-f]{64}$/i) },
  }, async ({ kind, library_id, folder, relative_file, content, expected_sha256 }) => {
    try {
      assertBuilder();
      const o = owner(kind, library_id, folder);
      const target = targetFor(o, relative_file);
      return await withFileMutationLocks([target], async () => {
        const resolved = await resolveOwnedSourceMutation(target, o);
        const before = await fs.readFile(resolved);
        if (digest(before) !== expected_sha256.toLowerCase()) throw new Error("V5_SOURCE_REVISION_CONFLICT");
        const tmp = path.join(path.dirname(resolved), "." + randomUUID() + ".tmp");
        try {
          await fs.writeFile(tmp, content, { flag: "wx" });
          if (digest(await fs.readFile(resolved)) !== digest(before)) throw new Error("V5_SOURCE_REVISION_CONFLICT");
          await fs.rename(tmp, resolved);
        } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
        return toolResult("v5_source_update", { path: resolved, sha256: digest(content) });
      });
    } catch (e) { return toolError("v5_source_update", e); }
  });
}
