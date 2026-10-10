import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getRepoRoot, isPathInside, toCadgptPath } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { currentJobSystemLease } from "../runtime/system-lease.js";

const execFileAsync = promisify(execFile);
const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

function pythonExecutable(): string {
  const override = process.env.CAD_MCP_PYTHON?.trim();
  if (override) {
    if (path.isAbsolute(override)) return override;
    if (override.includes("/") || override.includes("\\")) {
      return path.resolve(getRepoRoot(), override);
    }
    return override;
  }
  return path.resolve(
    getRepoRoot(), ".venv-cad",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  );
}

/**
 * Execute only a hash-verified source asset from tools/** of the CURRENT
 * managed Job bundle. Scripts are trusted Job code, never user document code;
 * this is not an OS sandbox. No shell, free command line or arbitrary Python
 * expression is supported, and the environment deliberately omits secrets.
 */
export function registerJobSystemHelperTools(server: McpServer): void {
  server.registerTool(
    "job_system_run_helper",
    {
      title: "Run hash-pinned Job Python helper under SYSTEM lease",
      description:
        "Run an approved Python .py asset from the current Job tools/**. " +
        "Requires an exact source sha256 and a JSON input file in that Job runtime. " +
        "No shell/command arguments. This executes trusted Job code, not untrusted PDFs/Excels.",
      inputSchema: {
        script_path: z.string(),
        expected_sha256: z.string().length(64),
        input_json_path: z.string(),
      },
    },
    async ({ script_path, expected_sha256, input_json_path }) => {
      let snapshot: string | null = null;
      try {
        const lease = currentJobSystemLease();
        if (!lease?.job_root) {
          throw new Error("SYSTEM_HELPER_LEASE_REQUIRED");
        }
        const jobRoot = path.resolve(lease.job_root);
        const toolsRoot = path.join(jobRoot, "tools");
        const runtimeRoot = lease.writable_roots.find(
          (root) =>
            path.basename(root).toLowerCase() === "runtime" &&
            isPathInside(root, jobRoot)
        );
        if (!runtimeRoot) throw new Error("SYSTEM_HELPER_RUNTIME_REQUIRED");

        if (!path.isAbsolute(script_path) || !path.isAbsolute(input_json_path)) {
          throw new Error("ABSOLUTE_PATH_REQUIRED");
        }
        if (!isPathInside(script_path, toolsRoot) || path.extname(script_path).toLowerCase() !== ".py") {
          throw new Error("SYSTEM_HELPER_TOOLS_ONLY");
        }
        if (!isPathInside(input_json_path, runtimeRoot) || path.extname(input_json_path).toLowerCase() !== ".json") {
          throw new Error("SYSTEM_HELPER_INPUT_RUNTIME_ONLY");
        }

        const realToolsRoot = await fs.realpath(toolsRoot);
        const realScript = await fs.realpath(script_path);
        const realInput = await fs.realpath(input_json_path);
        const realRuntime = await fs.realpath(runtimeRoot);
        if (!isPathInside(realScript, realToolsRoot) || !isPathInside(realInput, realRuntime)) {
          throw new Error("SYSTEM_HELPER_SYMLINK_ESCAPE");
        }
        if (!(await fs.stat(realScript)).isFile() || !(await fs.stat(realInput)).isFile()) {
          throw new Error("SYSTEM_HELPER_FILE_REQUIRED");
        }
        const source = await fs.readFile(realScript);
        if (sha256(source) !== expected_sha256) {
          throw new Error("RESOURCE_CONFLICT: helper source hash changed");
        }
        const inputBytes = await fs.readFile(realInput);
        if (inputBytes.length > 2 * 1024 * 1024) {
          throw new Error("SYSTEM_HELPER_INPUT_TOO_LARGE");
        }
        JSON.parse(inputBytes.toString("utf8")); // Reject invalid manifests before execution.

        // Snapshot the verified source, closing the normal hash/check/run race.
        snapshot = path.join(realRuntime, ".cg-job-helper-" + randomUUID() + ".py");
        await fs.writeFile(snapshot, source, { flag: "wx" });
        if (sha256(await fs.readFile(snapshot)) !== expected_sha256) {
          throw new Error("SYSTEM_HELPER_SNAPSHOT_CHANGED");
        }
        const resultRoots = lease.writable_roots.filter(
          (root) => path.resolve(root) !== path.resolve(runtimeRoot)
        );
        const resultRoot = resultRoots.length === 1 ? resultRoots[0] : "";
        const env: NodeJS.ProcessEnv = {
          PATH: process.env.PATH,
          Path: process.env.Path,
          SYSTEMROOT: process.env.SYSTEMROOT,
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          PYTHONNOUSERSITE: "1",
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONIOENCODING: "utf-8",
          CADGPT_JOB_ROOT: jobRoot,
          CADGPT_JOB_RUNTIME_ROOT: realRuntime,
          CADGPT_JOB_RESULT_ROOT: resultRoot,
        };
        const { stdout, stderr } = await execFileAsync(
          pythonExecutable(), ["-I", "-X", "utf8", snapshot, realInput], {
            cwd: realRuntime,
            env,
            windowsHide: true,
            timeout: 120_000,
            maxBuffer: 256 * 1024,
          }
        );
        return toolResult("job_system_run_helper", {
          script: toCadgptPath(realScript),
          sha256: expected_sha256,
          input: toCadgptPath(realInput),
          result_root: resultRoot ? toCadgptPath(resultRoot) : null,
          stdout,
          stderr,
          exit_code: 0,
        });
      } catch (error) {
        return toolError("job_system_run_helper", error);
      } finally {
        if (snapshot) await fs.rm(snapshot, { force: true }).catch(() => undefined);
      }
    }
  );
}
