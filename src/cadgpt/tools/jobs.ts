import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getJobLibrariesRoot, getUserCapabilitiesPath } from "../lib/appdata.js";
import { toCadgptPath } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";

interface JobEntry {
  id: string;
  kind: "job";
  library_id: string;
  relative_path: string;
  title: string;
  summary?: string;
  status?: string;
  risk?: string;
}

async function loadJobs(): Promise<JobEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(getUserCapabilitiesPath(), "utf8")) as { entries?: Array<Record<string, unknown>> };
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .filter((entry) => entry.kind === "job")
      .map((entry) => entry as unknown as JobEntry)
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function resolveManagedJob(entry: JobEntry): string {
  const root = path.resolve(getJobLibrariesRoot(), entry.library_id);
  const relative = entry.relative_path.replaceAll("\\", "/");
  if (path.isAbsolute(relative) || relative.split("/").includes("..")) throw new Error(`Unsafe Job registry path: ${entry.id}`);
  const candidate = path.resolve(root, relative);
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Job registry path escapes managed library: ${entry.id}`);
  return candidate;
}

export function registerJobTools(server: McpServer): void {
  server.registerTool(
    "job_list",
    {
      title: "List User Jobs",
      description: "List concrete Jobs from User Registry. Job rules/spec are internal CadGPT knowledge, not user Jobs.",
      inputSchema: {
        library_id: z.string().optional(),
      },
    },
    async ({ library_id }) => {
      try {
        let jobs = await loadJobs();
        if (library_id) jobs = jobs.filter((job) => job.library_id === library_id);
        return toolResult("job_list", {
          jobs: jobs.map((job) => ({
            id: job.id,
            title: job.title,
            library_id: job.library_id,
            path: `appdata/libraries/jobs/${job.library_id}/${job.relative_path}`,
            ...(job.summary ? { summary: job.summary } : {}),
            ...(job.status ? { status: job.status } : {}),
            ...(job.risk ? { risk: job.risk } : {}),
          })),
          count: jobs.length,
          rules: "knowledge/jobs/JOB_RULES.md",
        });
      } catch (error) {
        return toolError("job_list", error);
      }
    }
  );

  server.registerTool(
    "job_get",
    {
      title: "Load User Job",
      description: "Load one concrete Job registered from a managed AppData Job Library.",
      inputSchema: {
        id: z.string().min(1).describe("Canonical Job registry id returned by job_list/registry_list"),
      },
    },
    async ({ id }) => {
      try {
        const jobs = await loadJobs();
        const entry = jobs.find((job) => job.id.toLowerCase() === id.trim().toLowerCase());
        if (!entry) throw new Error(`Job not found in User Registry: ${id}`);
        const target = resolveManagedJob(entry);
        const real = await fs.realpath(target);
        const content = await fs.readFile(real, "utf8");
        return toolResult("job_get", {
          id: entry.id,
          title: entry.title,
          library_id: entry.library_id,
          path: toCadgptPath(real),
          content,
          rules: "knowledge/jobs/JOB_RULES.md",
        });
      } catch (error) {
        return toolError("job_get", error);
      }
    }
  );
}
