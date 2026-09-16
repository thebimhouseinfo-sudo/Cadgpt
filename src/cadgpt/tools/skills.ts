import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getRepoRoot } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";

const SKILLS_ROOT = path.resolve(getRepoRoot(), "skills");
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function normalized(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function inside(candidate: string, root: string): boolean {
  const c = normalized(candidate);
  const r = normalized(root);
  return c === r || c.startsWith(r + path.sep);
}

async function resolveSkillResource(name: string, resource = "SKILL.md"): Promise<string> {
  if (!SKILL_NAME.test(name)) throw new Error("Invalid skill name");
  if (!resource.trim() || path.isAbsolute(resource)) throw new Error("Invalid skill resource path");

  const skillDir = path.resolve(SKILLS_ROOT, name);
  const candidate = path.resolve(skillDir, resource);
  if (!inside(candidate, skillDir)) throw new Error("Skill resource escapes its skill directory");

  const realSkillDir = await fs.realpath(skillDir);
  const realTarget = await fs.realpath(candidate);
  if (!inside(realTarget, realSkillDir)) throw new Error("Skill resource resolves outside its skill directory");
  if (path.extname(realTarget).toLowerCase() !== ".md") {
    throw new Error("Only Markdown skill resources are readable");
  }
  return realTarget;
}

async function walkMarkdown(root: string, current: string, out: string[], max = 100): Promise<void> {
  if (out.length >= max) return;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= max || entry.name.startsWith(".")) break;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(root, full, out, max);
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
      out.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  }
}

export function registerSkillTools(server: McpServer): void {
  server.registerTool(
    "skill_list",
    {
      title: "List CadGPT Skills",
      description: "List reusable CadGPT Skills. Skill resources are read-only guidance; they are not editable workspace files.",
      inputSchema: {},
    },
    async () => {
      try {
        const entries = await fs.readdir(SKILLS_ROOT, { withFileTypes: true });
        const skills: Array<{ name: string; title: string; status?: string }> = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
          try {
            const skillFile = await resolveSkillResource(entry.name);
            const content = await fs.readFile(skillFile, "utf8");
            const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || entry.name;
            const status = content.match(/^Status:\s*(.+)$/mi)?.[1]?.trim();
            skills.push({ name: entry.name, title, ...(status ? { status } : {}) });
          } catch {
            // A directory without a valid SKILL.md is not an active skill.
          }
        }
        skills.sort((a, b) => a.name.localeCompare(b.name));
        return toolResult("skill_list", { skills, count: skills.length });
      } catch (error) {
        return toolError("skill_list", error);
      }
    }
  );

  server.registerTool(
    "skill_get",
    {
      title: "Read CadGPT Skill Resource",
      description: "Read SKILL.md or one Markdown resource belonging to an explicitly selected CadGPT Skill.",
      inputSchema: {
        name: z.string().min(1).describe("Skill directory name returned by skill_list"),
        resource: z.string().optional().default("SKILL.md").describe("Relative Markdown resource path inside the skill"),
      },
    },
    async ({ name, resource }) => {
      try {
        const target = await resolveSkillResource(name, resource);
        const content = await fs.readFile(target, "utf8");
        const skillDir = path.resolve(SKILLS_ROOT, name);
        const resources: string[] = [];
        await walkMarkdown(skillDir, skillDir, resources);
        return toolResult("skill_get", {
          name,
          resource: path.relative(skillDir, target).replaceAll("\\", "/"),
          content,
          resources: resources.sort(),
        });
      } catch (error) {
        return toolError("skill_get", error);
      }
    }
  );
}
