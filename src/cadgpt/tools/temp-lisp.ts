import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getDynamicLispRoot } from "../lib/appdata.js";
import { currentToolLease } from "../lib/work-registration.js";
import { validateLispSource } from "./lisp-harness.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";
import { toolError, toolResult } from "../lib/tool-result.js";

const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const workTag = () => digest(currentToolLease().workId).slice(0, 16);
const safeName = /^cg-temp-[a-f0-9]{16}-[a-f0-9]{32}\.lsp$/;

export function registerTempLispTools(server: McpServer): void {
  server.registerTool(
    "file_temp_lisp_create",
    {
      title: "Create Disposable AutoLISP",
      description:
        "Create one syntax-validated disposable AutoLISP source in the shared approved runtime. User approval for the planned action must precede use. Returns a path for the ordinary CAD Lisp loader; does not execute code or create a Custom Job.",
      inputSchema: { source: z.string().min(1).max(500_000) },
    },
    async ({ source }) => {
      try {
        const valid = validateLispSource(source, [], { profile: "syntax" });
        if (!valid.valid || !valid.commands.length)
          throw new Error("TEMP_LISP_VALID_COMMAND_REQUIRED");
        const fileName = "cg-temp-" + workTag() +
          "-" + randomUUID().replaceAll("-", "") + ".lsp";
        const root = getDynamicLispRoot();
        await fs.mkdir(root, { recursive: true });
        const absolute = path.join(root, fileName);
        await withFileMutationLocks([absolute], async () => {
          await fs.writeFile(absolute, source, { encoding: "utf8", flag: "wx" });
        });
        return toolResult("file_temp_lisp_create", {
          absolute_path: absolute, file_name: fileName, commands: valid.commands,
          sha256: digest(source), disposable: true, loaded: false,
        });
      } catch (error) {
        return toolError("file_temp_lisp_create", error);
      }
    }
  );
  server.registerTool(
    "file_temp_lisp_cleanup",
    {
      title: "Delete Owned Disposable AutoLISP",
      description:
        "Delete an owned temporary source file after use. Requires the exact source hash. Does not delete Job libraries or non-temp Lisp files.",
      inputSchema: {
        file_name: z.string().min(1),
        expected_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      },
    },
    async ({ file_name, expected_sha256 }) => {
      try {
        if (!safeName.test(file_name) ||
            !file_name.startsWith("cg-temp-" + workTag() + "-"))
          throw new Error("TEMP_LISP_OWNERSHIP_REQUIRED");
        const absolute = path.join(getDynamicLispRoot(), file_name);
        await withFileMutationLocks([absolute], async () => {
          const st = await fs.lstat(absolute);
          if (!st.isFile() || st.isSymbolicLink())
            throw new Error("TEMP_LISP_INVALID_FILE");
          const bytes = await fs.readFile(absolute);
          if (digest(bytes) !== expected_sha256)
            throw new Error("RESOURCE_CONFLICT: temporary Lisp changed");
          await fs.rm(absolute);
        });
        return toolResult("file_temp_lisp_cleanup", {
          file_name, removed: true,
        });
      } catch (error) {
        return toolError("file_temp_lisp_cleanup", error);
      }
    }
  );
}

/** Remove orphaned disposable Lisp files belonging to a retiring Work only. */
export async function cleanupTempLispForWork(executionId: string): Promise<number> {
  const root = getDynamicLispRoot();
  const prefix = "cg-temp-" + digest(executionId).slice(0, 16) + "-";
  const names = await fs.readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  let removed = 0;
  for (const name of names) {
    if (!safeName.test(name) || !name.startsWith(prefix)) continue;
    const absolute = path.join(root, name);
    await withFileMutationLocks([absolute], async () => {
      const stat = await fs.lstat(absolute).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (stat && stat.isFile() && !stat.isSymbolicLink()) {
        await fs.rm(absolute);
        removed++;
      }
    });
  }
  return removed;
}
