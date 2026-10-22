import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { activeWorkForSession, currentToolLease } from "../lib/work-registration.js";
import { ownedSourceRoot, assertOwnedSourceRootSafe, resolveOwnedSourceMutation, type OwnedSource } from "../lib/owned-source.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { assertBuilderTarget, currentBuilderTarget } from "../runtime/builder-target.js";
import { publishManagedLibrary } from "./user-assets.js";
import { getJobLibrariesRoot, getLispLibrariesRoot } from "../lib/appdata.js";
import { assertJobUpdateGrant, hasJobUpdateGrantForWork, isNewSourcePackageForSession, recordNewSourcePackage, withSourceMutation } from "../runtime/job-update-grant.js";

const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const extension = new Set([".md", ".txt", ".json", ".py", ".lsp", ".dcl", ".csv", ".yaml", ".yml"]);
function assertBuilder(kind: "reusable-job" | "reusable-lisp"): void {
  const lease = currentToolLease();
  const active = activeWorkForSession(lease.sessionKey);
  const conventionalBuilder = active && active.ownerType !== "job" &&
    (active.ownerId === "job-authoring" || active.ownerId === "lisp-authoring" ||
     active.ownerId === "jobcreate" || active.capabilities.includes("job-authoring") ||
     active.capabilities.includes("lisp-authoring"));
  const explicitlyGrantedSource = hasJobUpdateGrantForWork(lease.sessionKey, lease.workId);
  if (!active || active.closing || active.executionId !== lease.workId ||
      active.executionPath === "cad" || (!conventionalBuilder && !explicitlyGrantedSource)) {
    throw new Error("V5_EXPLICIT_BUILDER_WORK_REQUIRED");
  }
}

function assertExistingSourceEdit(root: string): void {
  const lease = currentToolLease();
  if (!isNewSourcePackageForSession(lease.sessionKey, root)) {
    assertJobUpdateGrant(lease.sessionKey, lease.workId, root);
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
  server.registerTool("v5_source_publish", {
    title: "Publish already-authored managed Job/Lisp library",
    description: "Explicit publication of reusable capabilities already written and run in their final managed library. No draft, checkout or Job promotion stage.",
    inputSchema: {
      kind: z.enum(["job", "lisp"]),
      library_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/),
      library_name: z.string().min(1),
    },
  }, async ({ kind, library_id, library_name }) => {
    try {
      assertBuilder(kind === "job" ? "reusable-job" : "reusable-lisp");
      const builderTarget = currentBuilderTarget(currentToolLease().workId);
      if (!builderTarget) throw new Error("V5_PUBLISH_BUILDER_TARGET_REQUIRED");
      const libraryRoot = path.join(
        kind === "job" ? getJobLibrariesRoot() : getLispLibrariesRoot(),
        library_id,
      );
      const canonicalLibrary = await fs.realpath(libraryRoot);
      const canonicalOwner = await fs.realpath(builderTarget);
      const equal = (value: string) => process.platform === "win32"
        ? value.toLowerCase() : value;
      const relative = path.relative(equal(canonicalLibrary), equal(canonicalOwner));
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("V5_PUBLISH_BUILDER_TARGET_MISMATCH");
      }
      return toolResult("v5_source_publish",
        await publishManagedLibrary(kind, library_id, library_name));
    } catch (error) { return toolError("v5_source_publish", error); }
  });
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
      assertBuilder(kind);
      const o = owner(kind, library_id, folder);
      const target = targetFor(o, relative_file);
      const directory = ownedSourceRoot(o);
      const result = await withSourceMutation(() => withFileMutationLocks([directory, target], async () => {
        assertBuilder(kind);
        const existingPackage = await fs.stat(directory).then(() => true, (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        });
        if (existingPackage) assertExistingSourceEdit(directory);
        await assertOwnedSourceRootSafe(o);
        assertBuilderTarget(currentToolLease().workId, directory);
        await fs.mkdir(directory, { recursive: true });
        const resolved = await resolveOwnedSourceMutation(target, o, { forCreate: true });
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        const checked = await resolveOwnedSourceMutation(target, o, { forCreate: true });
        await fs.writeFile(checked, content, { flag: "wx" });
        if (!existingPackage) recordNewSourcePackage(currentToolLease().sessionKey, directory);
        return { path: checked, sha256: digest(content) };
      }));
      return toolResult("v5_source_create", { ...result, source_created: true });
    } catch (e) { return toolError("v5_source_create", e); }
  });
  server.registerTool("v5_source_update", {
    title: "Update existing owned reusable Job/Lisp source",
    description: "Builder-only existing source edit. Source changes take effect on next run; use explicit Promote to update Registry discovery when wanted.",
    inputSchema: { ...schema, expected_sha256: z.string().regex(/^[0-9a-f]{64}$/i) },
  }, async ({ kind, library_id, folder, relative_file, content, expected_sha256 }) => {
    try {
      assertBuilder(kind);
      const o = owner(kind, library_id, folder);
      const target = targetFor(o, relative_file);
      const directory = ownedSourceRoot(o);
      const result = await withSourceMutation(() => withFileMutationLocks([directory, target], async () => {
        assertBuilder(kind);
        assertExistingSourceEdit(directory);
        await assertOwnedSourceRootSafe(o);
        assertBuilderTarget(currentToolLease().workId, directory);
        const resolved = await resolveOwnedSourceMutation(target, o);
        const before = await fs.readFile(resolved);
        if (digest(before) !== expected_sha256.toLowerCase()) throw new Error("V5_SOURCE_REVISION_CONFLICT");
        const tmp = path.join(path.dirname(resolved), "." + randomUUID() + ".tmp");
        try {
          await fs.writeFile(tmp, content, { flag: "wx" });
          if (digest(await fs.readFile(resolved)) !== digest(before)) throw new Error("V5_SOURCE_REVISION_CONFLICT");
          await fs.rename(tmp, resolved);
        } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
        return { path: resolved, sha256: digest(content) };
      }));
      return toolResult("v5_source_update", { ...result, source_updated: true });
    } catch (e) { return toolError("v5_source_update", e); }
  });
}
