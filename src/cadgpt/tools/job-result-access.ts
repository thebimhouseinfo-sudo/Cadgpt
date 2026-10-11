import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getDrawingStorageRoot } from "../lib/appdata.js";
import { currentToolLease } from "../lib/work-registration.js";
import { getBoundDrawingsForExecution } from "../session/drawing-binding.js";
import { toolError, toolResult } from "../lib/tool-result.js";

const RESULT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}-result$/;
const FILE_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ANCHOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

async function boundResultDirectory(jobResult: string): Promise<{
  drawing_anchor: string; directory: string;
}> {
  if (!RESULT_ID.test(jobResult) || jobResult.includes(".."))
    throw new Error("JOB_RESULT_ID_INVALID");
  const lease = currentToolLease();
  const bindings = getBoundDrawingsForExecution(lease.workId);
  if (bindings.length !== 1)
    throw new Error("JOB_RESULT_BOUND_DRAWING_REQUIRED: exactly one drawing must be bound");
  const binding = bindings[0];
  if (!binding.anchor_verified_readback ||
      typeof binding.drawing_anchor !== "string" ||
      !ANCHOR.test(binding.drawing_anchor) ||
      binding.drawing_anchor === "..")
    throw new Error("JOB_RESULT_VERIFIED_ANCHOR_REQUIRED");
  const storage = path.resolve(getDrawingStorageRoot());
  const drawingRoot = path.join(storage, binding.drawing_anchor);
  const resultRoot = path.join(drawingRoot, "jobs", jobResult);
  const realStorage = await fs.realpath(storage);
  const realDrawing = await fs.realpath(drawingRoot);
  if (path.dirname(realDrawing) !== realStorage ||
      (await fs.lstat(drawingRoot)).isSymbolicLink())
    throw new Error("JOB_RESULT_DRAWING_SCOPE");
  const realJobs = await fs.realpath(path.join(drawingRoot, "jobs"));
  if (path.dirname(realJobs) !== realDrawing ||
      (await fs.lstat(path.join(drawingRoot, "jobs"))).isSymbolicLink())
    throw new Error("JOB_RESULT_JOBS_SCOPE");
  const realResult = await fs.realpath(resultRoot);
  if (path.dirname(realResult) !== realJobs ||
      (await fs.lstat(resultRoot)).isSymbolicLink())
    throw new Error("JOB_RESULT_DIRECTORY_SCOPE");
  return { drawing_anchor: binding.drawing_anchor, directory: realResult };
}

export function registerJobResultAccessTools(server: McpServer): void {
  server.registerTool(
    "file_job_result_read",
    {
      title: "Read Bound Drawing Custom Job Result",
      description:
        "Read persisted Custom Job JSON metadata from the verified, currently bound Drawing Anchor without waking CAD MCP. Omit relative_file to list JSON names in that result. This is a stored-data read, not a live AutoCAD state query.",
      inputSchema: {
        job_result: z.string().min(1),
        relative_file: z.string().optional(),
      },
    },
    async ({ job_result, relative_file }) => {
      try {
        const { drawing_anchor, directory } = await boundResultDirectory(job_result);
        if (!relative_file) {
          const names = (await fs.readdir(directory, { withFileTypes: true }))
            .filter((x) => x.isFile() && !x.isSymbolicLink() &&
              FILE_PART.test(x.name) && x.name.toLowerCase().endsWith(".json"))
            .map((x) => x.name).sort();
          return toolResult("file_job_result_read", {
            drawing_anchor, job_result, files: names, source: "stored_metadata",
          });
        }
        if (!FILE_PART.test(relative_file) || !relative_file.toLowerCase().endsWith(".json") ||
            relative_file === "." || relative_file === "..")
          throw new Error("JOB_RESULT_FILE_INVALID");
        const target = path.join(directory, relative_file);
        const stat = await fs.lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES)
          throw new Error("JOB_RESULT_FILE_UNSUPPORTED");
        const bytes = await fs.readFile(target);
        if (bytes.length > MAX_JSON_BYTES)
          throw new Error("JOB_RESULT_FILE_TOO_LARGE");
        const content = JSON.parse(bytes.toString("utf8")) as unknown;
        return toolResult("file_job_result_read", {
          drawing_anchor, job_result, file: relative_file,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          source: "stored_metadata", content,
        });
      } catch (error) {
        return toolError("file_job_result_read", error);
      }
    }
  );
}
