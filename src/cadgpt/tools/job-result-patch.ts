import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { boundResultDirectory } from "./job-result-access.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";
import { toolError, toolResult } from "../lib/tool-result.js";

const JSON_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/i;
const PART = /^(?:[A-Za-z_][A-Za-z0-9_-]*|[0-9]+)$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const PROTECTED_FIELDS = new Set(["handle", "drawing_anchor", "drawing_id", "ref_no", "refno", "job_id"]);
const MAX_BYTES = 2 * 1024 * 1024;
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const primitive = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

function findLeaf(data: unknown, members: string[]): { record: Record<string, unknown>; field: string } {
  if (members.length < 1 || members.length > 10 || members.some((part) => !PART.test(part) || FORBIDDEN.has(part)))
    throw new Error("JOB_RESULT_FIELD_PATH_INVALID");
  let current: unknown = data;
  for (const part of members.slice(0, -1)) {
    if (!current || typeof current !== "object") throw new Error("JOB_RESULT_RECORD_NOT_FOUND");
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object" || Array.isArray(current))
    throw new Error("JOB_RESULT_RECORD_NOT_FOUND");
  const field = members[members.length - 1];
  if (PROTECTED_FIELDS.has(field.toLowerCase()))
    throw new Error("JOB_RESULT_IDENTITY_FIELD_PROTECTED");
  if (!Object.prototype.hasOwnProperty.call(current, field))
    throw new Error("JOB_RESULT_FIELD_MISSING");
  return { record: current as Record<string, unknown>, field };
}

export function registerJobResultPatchTools(server: McpServer): void {
  server.registerTool(
    "file_job_result_patch",
    {
      title: "Patch One Verified Custom Job Result Field",
      description:
        "Apply a user-approved, exact single-field JSON mutation in the bound Drawing Anchor's existing Job result. Requires a pre-read SHA256, exact previous scalar value and explicit JSON path. Does not load CAD or start the parent Job.",
      inputSchema: {
        job_result: z.string().min(1),
        relative_file: z.string().min(1),
        expected_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        field_path: z.array(z.string()).min(1).max(10),
        expected_previous_value: primitive,
        new_value: primitive,
        record_handle: z.string().min(1).max(100).optional(),
      },
    },
    async ({ job_result, relative_file, expected_sha256, field_path,
      expected_previous_value, new_value, record_handle }) => {
      try {
        if (!JSON_FILE.test(relative_file) || relative_file.includes(".."))
          throw new Error("JOB_RESULT_FILE_INVALID");
        const { drawing_anchor, directory } = await boundResultDirectory(job_result);
        const target = path.join(directory, relative_file);
        const result = await withFileMutationLocks([target], async () => {
          const st = await fs.lstat(target);
          if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_BYTES)
            throw new Error("JOB_RESULT_FILE_UNSUPPORTED");
          const before = await fs.readFile(target);
          if (before.length > MAX_BYTES) throw new Error("JOB_RESULT_FILE_TOO_LARGE");
          if (sha(before) !== expected_sha256)
            throw new Error("RESOURCE_CONFLICT: Job result changed since approved read");
          const object = JSON.parse(before.toString("utf8")) as unknown;
          const { record, field } = findLeaf(object, field_path);
          if (record_handle !== undefined) {
            const handle = record.handle ?? record.HANDLE;
            if (typeof handle !== "string" || handle.toLowerCase() !== record_handle.toLowerCase())
              throw new Error("JOB_RESULT_HANDLE_MISMATCH");
          }
          if ((record[field] !== null && typeof record[field] === "object") ||
              !Object.is(record[field], expected_previous_value))
            throw new Error("RESOURCE_CONFLICT: selected field no longer has approved value");
          record[field] = new_value;
          const updated = Buffer.from(JSON.stringify(object, null, 2) + "\n", "utf8");
          if (updated.length > MAX_BYTES) throw new Error("JOB_RESULT_FILE_TOO_LARGE");
          const pending = path.join(directory, "." + path.basename(target) + "." + randomUUID() + ".tmp");
          try {
            await fs.writeFile(pending, updated, { flag: "wx" });
            await fs.rename(pending, target);
          } finally {
            await fs.rm(pending, { force: true }).catch(() => undefined);
          }
          return { prior_sha256: expected_sha256, sha256: sha(updated) };
        });
        return toolResult("file_job_result_patch", {
          drawing_anchor, job_result, file: relative_file,
          field_path, old_value: expected_previous_value, new_value, ...result,
          cad_sync: "not_performed",
        });
      } catch (error) {
        return toolError("file_job_result_patch", error);
      }
    }
  );
}

export function registerJobResultBatchPatchTools(server: McpServer): void {
  server.registerTool(
    "file_job_result_patch_batch",
    {
      title: "Patch Multiple Verified Result Fields Atomically",
      description:
        "Apply a bounded user-approved set of field changes to one existing Job result JSON using one SHA compare-and-swap. All field paths and expected prior values must match; all-or-nothing, no CAD access.",
      inputSchema: {
        job_result: z.string().min(1),
        relative_file: z.string().min(1),
        expected_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        updates: z.array(z.object({
          field_path: z.array(z.string()).min(1).max(10),
          expected_previous_value: primitive,
          new_value: primitive,
          record_handle: z.string().min(1).max(100).optional(),
        })).min(1).max(500),
      },
    },
    async ({ job_result, relative_file, expected_sha256, updates }) => {
      try {
        if (!JSON_FILE.test(relative_file) || relative_file.includes(".."))
          throw new Error("JOB_RESULT_FILE_INVALID");
        const { drawing_anchor, directory } = await boundResultDirectory(job_result);
        const target = path.join(directory, relative_file);
        const result = await withFileMutationLocks([target], async () => {
          const st = await fs.lstat(target);
          if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_BYTES)
            throw new Error("JOB_RESULT_FILE_UNSUPPORTED");
          const before = await fs.readFile(target);
          if (before.length > MAX_BYTES) throw new Error("JOB_RESULT_FILE_TOO_LARGE");
          if (sha(before) !== expected_sha256)
            throw new Error("RESOURCE_CONFLICT: Job result changed since approved read");
          const object = JSON.parse(before.toString("utf8")) as unknown;
          const prepared: Array<{ record: Record<string, unknown>; field: string; newValue: unknown }> = [];
          const seen = new Set<string>();
          for (const update of updates) {
            const identity = JSON.stringify(update.field_path);
            if (seen.has(identity)) throw new Error("JOB_RESULT_DUPLICATE_FIELD_PATH");
            seen.add(identity);
            const { record, field } = findLeaf(object, update.field_path);
            if (update.record_handle !== undefined) {
              const handle = record.handle ?? record.HANDLE;
              if (typeof handle !== "string" ||
                  handle.toLowerCase() !== update.record_handle.toLowerCase())
                throw new Error("JOB_RESULT_HANDLE_MISMATCH");
            }
            if ((record[field] !== null && typeof record[field] === "object") ||
                !Object.is(record[field], update.expected_previous_value))
              throw new Error("RESOURCE_CONFLICT: a selected result field changed");
            prepared.push({ record, field, newValue: update.new_value });
          }
          for (const item of prepared) item.record[item.field] = item.newValue;
          const after = Buffer.from(JSON.stringify(object, null, 2) + "\n", "utf8");
          if (after.length > MAX_BYTES) throw new Error("JOB_RESULT_FILE_TOO_LARGE");
          const pending = path.join(directory, "." + path.basename(target) + "." + randomUUID() + ".tmp");
          try {
            await fs.writeFile(pending, after, { flag: "wx" });
            await fs.rename(pending, target);
          } finally {
            await fs.rm(pending, { force: true }).catch(() => undefined);
          }
          return { sha256: sha(after), count: prepared.length };
        });
        return toolResult("file_job_result_patch_batch", {
          drawing_anchor, job_result, file: relative_file,
          prior_sha256: expected_sha256, ...result, cad_sync: "not_performed",
        });
      } catch (error) {
        return toolError("file_job_result_patch_batch", error);
      }
    }
  );
}
