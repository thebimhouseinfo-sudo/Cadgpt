import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { importLibrary } from "./user-assets.js";
import { runOwnedTempPython } from "../runtime/temp-python-v5.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { currentToolLease } from "../lib/work-registration.js";
import { loadVerifiedLispForCurrentWork } from "./cad-proxy.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { createTempJob, readTempSource, writeTempSource, updateTempSource, createTempResult, writeTempResult, getOwnedTempLisp, finishTempJob, clearTempJobs } from "../runtime/temp-job-v5.js";

export async function assertIndependentLispFolder(root: string): Promise<void> {
  const canonical = await fs.realpath(root);
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name);
      const stat = await fs.lstat(item);
      if (stat.isSymbolicLink()) throw new Error("TEMP_LISP_DEPENDENCY_SYMLINK");
      if (stat.isDirectory()) {
        await visit(item);
      } else if (stat.isFile()) {
        files.push(item);
      } else {
        throw new Error("TEMP_LISP_DEPENDENCY_SPECIAL_FILE");
      }
    }
  }
  await visit(canonical);
  const inside = (target: string) => {
    const rel = path.relative(canonical, target);
    return rel && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
  };
  for (const file of files.filter(item => path.extname(item).toLowerCase() === ".lsp")) {
    const code = await fs.readFile(file, "utf8");
    // Obvious literal file dependencies must be copied along with the Lisp.
    // Dynamically computed dependencies cannot be inferred safely.
    const literal = /\(\s*(?:load|load_dialog)\s+"([^"]+)"/gi;
    for (const match of code.matchAll(literal)) {
      const value = match[1];
      if (path.isAbsolute(value) || path.win32.isAbsolute(value)) {
        throw new Error("TEMP_LISP_EXTERNAL_DEPENDENCY: " + value);
      }
      const ref = path.resolve(path.dirname(file), value);
      if (!inside(ref)) throw new Error("TEMP_LISP_DEPENDENCY_OUTSIDE_SELECTED_FOLDER: " + value);
      const tries = path.extname(ref) ? [ref] : [ref, ref + ".lsp"];
      if (!(await Promise.all(tries.map(candidate => fs.stat(candidate).then(
        stat => stat.isFile(), () => false
      )))).some(Boolean)) {
        throw new Error("TEMP_LISP_DEPENDENCY_NOT_COPIED: " + value);
      }
    }
  }
}

export function registerTempJobV5Tools(server: McpServer): void {
  server.registerTool("temp_job_create", {
    title: "Create temporary Job workspace",
    description: "Create an independently owned, random-ID temporary Job source folder. No JOB.md or promotion required.",
    inputSchema: {},
  }, async () => {
    try {
      const l = currentToolLease();
      return toolResult("temp_job_create", await createTempJob(l.workId, l.sessionKey));
    } catch (e) { return toolError("temp_job_create", e); }
  });
  server.registerTool("temp_job_source_create", {
    title: "Write one new owned Temp Job source file",
    description: "Create source inside the calling Builder's own Temp Job only. Never overwrites.",
    inputSchema: {
      id: z.string().uuid(),
      relative_path: z.string().min(1),
      content: z.string(),
    },
  }, async ({ id, relative_path, content }) => {
    try {
      const l = currentToolLease();
      return toolResult("temp_job_source_create", await writeTempSource(id, l.workId, l.sessionKey, relative_path, content));
    } catch (e) { return toolError("temp_job_source_create", e); }
  });
  server.registerTool("temp_job_source_read", {
    title: "Read owned Temp Job source and current revision",
    description: "Read source text and SHA-256 within this logical session's own Temp Job. Use the returned revision for safe source correction; no generic FILE or Registry permission is needed.",
    inputSchema: { id: z.string().uuid(), relative_path: z.string().min(1) },
  }, async ({ id, relative_path }) => {
    try {
      const lease = currentToolLease();
      return toolResult("temp_job_source_read", await readTempSource(id, lease.workId, lease.sessionKey, relative_path));
    } catch (error) { return toolError("temp_job_source_read", error); }
  });
  server.registerTool("temp_job_source_update", {
    title: "Fix one owned Temp Job source file",
    description: "Replace source after an error with exact SHA-256 expected content, then user can re-run real CAD operation.",
    inputSchema: {
      id: z.string().uuid(),
      relative_path: z.string().min(1),
      content: z.string(),
      expected_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    },
  }, async ({ id, relative_path, content, expected_sha256 }) => {
    try {
      const l = currentToolLease();
      return toolResult("temp_job_source_update",
        await updateTempSource(id, l.workId, l.sessionKey, relative_path, content, expected_sha256));
    } catch (e) { return toolError("temp_job_source_update", e); }
  });
  server.registerTool("temp_job_result_create", {
    title: "Create named Temp Job result on verified bound DWG",
    description: "Only when persistent output is needed. Ask user for the folder name; never generate it from the Temp Job UUID.",
    inputSchema: {
      id: z.string().uuid(),
      folder_name: z.string().min(1),
    },
  }, async ({ id, folder_name }) => {
    try {
      const lease = currentToolLease();
      return toolResult("temp_job_result_create", await createTempResult(id, lease.workId, lease.sessionKey, folder_name));
    } catch (error) { return toolError("temp_job_result_create", error); }
  });
  server.registerTool("temp_job_result_write", {
    title: "Write into this Temp Job's named Drawing Anchor result",
    description: "Create a new result file in the exact user-named, verified bound drawing result. No overwrite or cross-Job access.",
    inputSchema: {
      id: z.string().uuid(),
      relative_file: z.string().min(1),
      content: z.string(),
    },
  }, async ({ id, relative_file, content }) => {
    try {
      const lease = currentToolLease();
      return toolResult("temp_job_result_write",
        await writeTempResult(id, lease.workId, lease.sessionKey, relative_file, content));
    } catch (error) { return toolError("temp_job_result_write", error); }
  });
  server.registerTool("temp_job_lisp_load", {
    title: "Load a Temp Job Lisp on the bound AutoCAD drawing",
    description: "Real AutoCAD LOAD of an owned Temp Job Lisp. Uses existing CAD host lock and requires confirmed loaded=true; no simulated TEST step.",
    inputSchema: {
      id: z.string().uuid(),
      relative_file: z.string().min(1),
      drawing_id: z.string().optional(),
    },
  }, async ({ id, relative_file, drawing_id }) => {
    try {
      const lease = currentToolLease();
      const source = await getOwnedTempLisp(id, lease.workId, lease.sessionKey, relative_file);
      const result = await loadVerifiedLispForCurrentWork(source, drawing_id);
      if (!result.loaded) throw new Error("TEMP_JOB_LISP_LOAD_NOT_CONFIRMED");
      return toolResult("temp_job_lisp_load",
        { id, source, drawing_id: result.drawing_id, loaded: true, commands: result.commands });
    } catch (error) { return toolError("temp_job_lisp_load", error); }
  });
  server.registerTool("temp_job_python_run", {
    title: "Run trusted owned Temp Python file-only helper",
    description: "Execute one exact SHA-verified Builder-owned Temp .py script with JSON input via isolated Python -I and no shell. Trusted source only; not an OS sandbox and never a replacement for bound CAD operations.",
    inputSchema: {
      id: z.string().uuid(),
      relative_file: z.string().min(1),
      expected_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
      input_json: z.string().default("{}"),
    },
  }, async ({ id, relative_file, expected_sha256, input_json }) => {
    try {
      const lease = currentToolLease();
      return toolResult("temp_job_python_run", await runOwnedTempPython({
        id, execution: lease.workId, session: lease.sessionKey,
        relativeFile: relative_file, expectedSha256: expected_sha256, inputJson: input_json,
      }));
    } catch (error) { return toolError("temp_job_python_run", error); }
  });
  server.registerTool("temp_job_done", {
    title: "Mark Temp Job complete",
    description: "Complete the current Builder-owned Temp Job without registering or promoting it.",
    inputSchema: { id: z.string().uuid() },
  }, async ({ id }) => {
    try {
      const l = currentToolLease();
      return toolResult("temp_job_done", await finishTempJob(id, l.workId, l.sessionKey));
    } catch (e) { return toolError("temp_job_done", e); }
  });
  server.registerTool("temp_job_lisp_publish", {
    title: "Publish selected Temp Lisp folder as independent reusable Lisp library",
    description: "Only on explicit user request. Copy the owning Temp Lisp folder and its dependencies to an independent managed library, index/register once, refuse existing library collisions. No Temp Job promotion or mandatory rerun.",
    inputSchema: {
      id: z.string().uuid(),
      relative_file: z.string().min(1),
      library_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/),
      library_name: z.string().min(1),
    },
  }, async ({ id, relative_file, library_id, library_name }) => {
    try {
      const lease = currentToolLease();
      const source = await getOwnedTempLisp(id, lease.workId, lease.sessionKey, relative_file);
      const folder = path.dirname(source);
      await assertIndependentLispFolder(folder);
      const published = await importLibrary("lisp", library_id, library_name, folder, false);
      return toolResult("temp_job_lisp_publish", {
        ...published, source, copied_folder: folder,
        note: "Published independently; original Temp Job and its result are untouched.",
      });
    } catch (error) { return toolError("temp_job_lisp_publish", error); }
  });
  server.registerTool("temp_job_clear", {
    title: "Clear completed Temp Jobs",
    description: "Delete only recognized completed and inactive Temp Job source folders. Never delete bound-DWG results.",
    inputSchema: { id: z.string().uuid().optional() },
  }, async ({ id }) => {
    try { return toolResult("temp_job_clear", await clearTempJobs(id)); }
    catch (e) { return toolError("temp_job_clear", e); }
  });
}
