import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getRepoRoot, resolveAllowedPath, toRepoRelative } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";

interface JobSummary {
  name: string;
  path: string;
  title: string;
  status?: string;
}

async function parseJobSummary(jobDir: string): Promise<JobSummary | null> {
  const jobFile = path.join(jobDir, "JOB.md");
  try {
    const content = await fs.readFile(jobFile, "utf8");
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(jobDir);
    const status = content.match(/^Status:\s*(.+)$/mi)?.[1]?.trim();
    return {
      name: path.basename(jobDir),
      path: toRepoRelative(jobFile),
      title,
      ...(status ? { status } : {}),
    };
  } catch {
    return null;
  }
}

export function registerJobTools(server: McpServer): void {
  server.registerTool(
    "job_list",
    {
      title: "List CadGPT Jobs",
      description: "List repeatable CAD Jobs available under jobs/**. Use this when the user asks /job or wants to remember available workflows.",
      inputSchema: {},
    },
    async () => {
      try {
        const jobsRoot = await resolveAllowedPath("jobs");
        const entries = await fs.readdir(jobsRoot, { withFileTypes: true });
        const jobs: JobSummary[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
          const summary = await parseJobSummary(path.join(jobsRoot, entry.name));
          if (summary) jobs.push(summary);
        }
        jobs.sort((a, b) => a.name.localeCompare(b.name));
        return toolResult("job_list", {
          jobs,
          count: jobs.length,
          rules: "jobs/JOB_RULES.md",
        });
      } catch (error) {
        return toolError("job_list", error);
      }
    }
  );

  server.registerTool(
    "job_get",
    {
      title: "Load CadGPT Job",
      description: "Load the exact JOB.md for an explicitly selected repeatable CAD workflow.",
      inputSchema: {
        name: z.string().min(1).describe("Job directory name returned by job_list"),
      },
    },
    async ({ name }) => {
      try {
        if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
          throw new Error("Job name must be a directory name returned by job_list");
        }
        const target = await resolveAllowedPath(path.join("jobs", name, "JOB.md"));
        const content = await fs.readFile(target, "utf8");
        return toolResult("job_get", {
          name,
          path: toRepoRelative(target),
          content,
          repository: getRepoRoot(),
        });
      } catch (error) {
        return toolError("job_get", error);
      }
    }
  );
}
