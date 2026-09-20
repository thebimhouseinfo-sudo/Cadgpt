import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getJobDraftRoot,
  getJobLibrariesRoot,
  getUserCapabilitiesPath,
  getUserLibrariesManifestPath,
} from "../lib/appdata.js";
import { isPathInside, resolveAbsoluteMutationPath, resolveAllowedPath, toCadgptPath } from "../lib/path-security.js";
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

interface UserRegistry {
  version: number;
  entries: Array<Record<string, unknown>>;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

const jobMetadataSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  class_name: z.string().min(1).max(160).default("workflow.user"),
  subclass: z.string().min(1).max(160).default("custom"),
  tags: z.array(z.string().min(1).max(80)).max(50).default([]),
  summary: z.string().min(1).max(1200),
  status: z.string().min(1).max(160).default("active"),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
});

async function atomicWrite(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, content, "utf8");
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

async function readJson<T>(target: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function loadRegistry(): Promise<UserRegistry> {
  const parsed = await readJson<Partial<UserRegistry>>(getUserCapabilitiesPath(), { version: 1, entries: [] });
  if (!Array.isArray(parsed.entries)) throw new Error("User Registry is missing entries[]");
  return { version: Number(parsed.version || 1), entries: parsed.entries };
}

async function loadJobs(): Promise<JobEntry[]> {
  const parsed = await loadRegistry();
  return parsed.entries
    .filter((entry) => entry.kind === "job")
    .map((entry) => entry as unknown as JobEntry)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function safeRelativeJob(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..") || path.isAbsolute(normalized) || path.basename(normalized).toLowerCase() !== "job.md") {
    throw new Error("relative_path must be a safe JOB.md path inside the managed Job library");
  }
  return normalized;
}

function managedJobPath(libraryId: string, relativePath: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(libraryId)) throw new Error("Invalid library_id");
  const relative = safeRelativeJob(relativePath);
  const root = path.resolve(getJobLibrariesRoot(), libraryId);
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Managed Job path escapes library root");
  return target;
}

function resolveManagedJob(entry: JobEntry): string {
  return managedJobPath(entry.library_id, entry.relative_path);
}

function draftPathFor(libraryId: string, relativePath: string): string {
  return path.resolve(getJobDraftRoot(), libraryId, safeRelativeJob(relativePath));
}

function assertDraftVirtualPath(value: string): void {
  if (path.isAbsolute(value)) {
    const target = path.resolve(value);
    if (!isPathInside(target, getJobDraftRoot()) || path.basename(target).toLowerCase() !== "job.md") {
      throw new Error("Draft path must be an absolute JOB.md path under the approved Job draft root");
    }
    return;
  }
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  if (!normalized.startsWith("appdata/workspace/job-draft/") || path.basename(normalized) !== "job.md") {
    throw new Error("Draft path must point to JOB.md under appdata/workspace/job-draft/**");
  }
}

function validateJobSource(content: string): { valid: boolean; diagnostics: string[]; steps: number } {
  const diagnostics: string[] = [];
  if (!/^#\s+(?:Job:\s*)?\S.+$/mi.test(content)) diagnostics.push("Missing Job title heading (# Job: ...).");
  if (!/^##\s+Goal\b/im.test(content)) diagnostics.push("Missing ## Goal section.");
  if (!/^##\s+Preconditions\b/im.test(content)) diagnostics.push("Missing ## Preconditions section.");
  if (!/^##\s+(?:Final\s+)?Validation\b/im.test(content)) diagnostics.push("Missing final ## Validation section.");

  const matches = [...content.matchAll(/^##\s+Step\s+[^\n]+$/gim)];
  if (!matches.length) diagnostics.push("Job must contain at least one ## Step section.");

  for (let index = 0; index < matches.length; index++) {
    const start = matches[index].index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? content.length) : content.length;
    const segment = content.slice(start, end);
    const label = matches[index][0].trim();
    if (!/success[_\s-]*criteria/i.test(segment)) diagnostics.push(`${label}: missing success criteria.`);
    if (!/failure[_\s-]*handling/i.test(segment)) diagnostics.push(`${label}: missing failure handling.`);
    if (!/(available[_\s-]*tools|preferred[_\s-]*tools|executor|tool scope)/i.test(segment)) diagnostics.push(`${label}: missing explicit tool/executor scope.`);
    if (!/(output|postcondition|evidence)/i.test(segment)) diagnostics.push(`${label}: missing output/postcondition/evidence.`);
  }

  return { valid: diagnostics.length === 0, diagnostics, steps: matches.length };
}

async function assertManagedLibraryExists(libraryId: string): Promise<void> {
  const manifest = await readJson<{ libraries?: Array<Record<string, unknown>> }>(getUserLibrariesManifestPath(), { libraries: [] });
  const match = (manifest.libraries ?? []).find((item) => item.kind === "job" && item.id === libraryId && item.enabled !== false);
  if (!match) throw new Error(`Enabled managed Job library not found in libraries.json: ${libraryId}`);
}

export function registerJobTools(server: McpServer): void {
  server.registerTool(
    "job_list",
    {
      title: "List User Jobs",
      description: "List concrete Jobs from User Registry. Job rules/spec are internal CadGPT knowledge, not user Jobs.",
      inputSchema: { library_id: z.string().optional() },
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
      inputSchema: { id: z.string().min(1).describe("Canonical Job registry id returned by job_list/registry_list") },
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

  server.registerTool(
    "job_checkout",
    {
      title: "Checkout Managed Job for jobcreate",
      description: "Copy one registered managed Job into an explicit absolute JOB.md draft path. Existing drafts require hash-confirmed overwrite.",
      inputSchema: {
        registry_id: z.string().min(1),
        draft_path: z.string().min(1).describe("Absolute JOB.md path under the approved Job draft root"),
        overwrite_existing: z.boolean().optional().default(false),
        expected_sha256: z.string().length(64).optional(),
      },
    },
    async ({ registry_id, draft_path, overwrite_existing, expected_sha256 }) => {
      try {
        const jobs = await loadJobs();
        const entry = jobs.find((job) => job.id.toLowerCase() === registry_id.trim().toLowerCase());
        if (!entry) throw new Error(`Managed Job not found in User Registry: ${registry_id}`);
        const source = resolveManagedJob(entry);
        const content = await fs.readFile(source, "utf8");
        const draft = await resolveAbsoluteMutationPath(draft_path, {
          allowedRoots: [getJobDraftRoot()],
          forCreate: true,
          label: "Job draft",
        });
        if (path.basename(draft).toLowerCase() !== "job.md") {
          throw new Error("Job checkout draft_path must end in JOB.md");
        }

        let previousDraft: string | null = null;
        try {
          previousDraft = await fs.readFile(draft, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (previousDraft !== null) {
          if (!overwrite_existing) {
            throw new Error(`Draft already exists; explicit overwrite_existing=true is required: ${draft}`);
          }
          if (!expected_sha256 || sha256(previousDraft) !== expected_sha256) {
            throw new Error("RESOURCE_CONFLICT: existing Job draft changed or expected_sha256 was not supplied");
          }
        }

        await atomicWrite(draft, content);
        const validation = validateJobSource(content);
        return toolResult("job_checkout", {
          registry_id: entry.id,
          library_id: entry.library_id,
          source_path: toCadgptPath(source),
          draft_path: draft,
          draft_display_path: toCadgptPath(draft),
          source_contract_valid: validation.valid,
          diagnostics: validation.diagnostics,
          managed_source_unchanged: true,
        });
      } catch (error) {
        return toolError("job_checkout", error);
      }
    }
  );

  server.registerTool(
    "job_draft_validate",
    {
      title: "Validate Job Workspace Draft",
      description: "Validate the canonical structural Job contract for a JOB.md draft. Absolute draft paths returned by job_checkout are accepted.",
      inputSchema: { path: z.string().min(1) },
    },
    async ({ path: input }) => {
      try {
        assertDraftVirtualPath(input);
        const target = await resolveAllowedPath(input);
        const content = await fs.readFile(target, "utf8");
        const validation = validateJobSource(content);
        return toolResult(
          "job_draft_validate",
          { path: toCadgptPath(target), ...validation, rules: "knowledge/jobs/JOB_RULES.md" },
          validation.valid ? "Job draft validation passed" : "Job draft validation failed"
        );
      } catch (error) {
        return toolError("job_draft_validate", error);
      }
    }
  );

  server.registerTool(
    "job_promote_draft",
    {
      title: "Promote Tested Job Draft to Managed Library",
      description: "Promote one validated absolute-path Job draft into an explicit absolute managed Job target and synchronize User Registry rollback-safely.",
      inputSchema: {
        draft_path: z.string().min(1),
        target_path: z.string().min(1).describe("Absolute target path that must exactly match library_id + relative_path"),
        library_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i),
        relative_path: z.string().min(1),
        metadata: jobMetadataSchema,
        overwrite: z.boolean().optional().default(false),
        expected_target_sha256: z.string().length(64).optional(),
        test_evidence: z.string().min(1).max(2000),
        final_validation_evidence: z.string().min(1).max(2000),
        user_accepted: z.literal(true),
      },
    },
    async ({ draft_path, target_path, library_id, relative_path, metadata, overwrite, expected_target_sha256, test_evidence, final_validation_evidence, user_accepted }) => {
      try {
        if (!path.isAbsolute(draft_path)) {
          throw new Error("ABSOLUTE_PATH_REQUIRED: job_promote_draft draft_path must be absolute");
        }
        assertDraftVirtualPath(draft_path);
        await assertManagedLibraryExists(library_id);
        if (!user_accepted) throw new Error("Job promotion requires explicit user acceptance");

        const draft = await resolveAllowedPath(draft_path);
        const content = await fs.readFile(draft, "utf8");
        const validation = validateJobSource(content);
        if (!validation.valid) throw new Error(`Job draft contract failed: ${validation.diagnostics.join(" ")}`);

        const normalizedRelative = safeRelativeJob(relative_path);
        const expectedPermanent = managedJobPath(library_id, normalizedRelative);
        const permanent = await resolveAbsoluteMutationPath(target_path, {
          allowedRoots: [path.resolve(getJobLibrariesRoot(), library_id)],
          forCreate: true,
          label: "managed Job library",
        });
        if (path.relative(expectedPermanent, permanent) !== "") {
          throw new Error(
            `TARGET_PATH_MISMATCH: target_path must exactly match managed Job target ${expectedPermanent}`
          );
        }
        let targetExists = false;
        let previousPermanent: string | null = null;
        try {
          previousPermanent = await fs.readFile(permanent, "utf8");
          targetExists = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (targetExists && !overwrite) throw new Error(`Managed Job already exists; set overwrite=true for intentional replacement: ${toCadgptPath(permanent)}`);
        if (targetExists && overwrite) {
          if (!expected_target_sha256 || previousPermanent === null || sha256(previousPermanent) !== expected_target_sha256) {
            throw new Error("RESOURCE_CONFLICT: managed Job target changed or expected_target_sha256 was not supplied");
          }
        }

        const registry = await loadRegistry();
        for (const entry of registry.entries) {
          const id = String(entry.id || "");
          const sameTarget = entry.kind === "job" && String(entry.library_id || "") === library_id && String(entry.relative_path || "").toLowerCase() === normalizedRelative.toLowerCase();
          if (id === metadata.id && entry.kind !== "job") throw new Error(`Registry id belongs to a non-Job capability: ${metadata.id}`);
          if (id !== metadata.id && sameTarget) throw new Error(`Managed Job path already belongs to another capability: ${id}`);
        }

        const newEntry: Record<string, unknown> = {
          id: metadata.id,
          kind: "job",
          registry: "user",
          library_id,
          relative_path: normalizedRelative,
          title: metadata.title,
          class: metadata.class_name,
          subclass: metadata.subclass,
          tags: metadata.tags,
          summary: metadata.summary,
          status: metadata.status,
          risk: metadata.risk,
          semantic_status: "curated",
          last_test_evidence: test_evidence,
          last_validation_evidence: final_validation_evidence,
        };
        const nextEntries = registry.entries.filter((entry) => String(entry.id || "") !== metadata.id);
        nextEntries.push(newEntry);
        nextEntries.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

        await fs.mkdir(path.dirname(permanent), { recursive: true });
        await atomicWrite(permanent, content);
        try {
          await atomicWrite(getUserCapabilitiesPath(), `${JSON.stringify({ version: registry.version, entries: nextEntries }, null, 2)}\n`);
        } catch (registryError) {
          try {
            if (targetExists && previousPermanent !== null) await atomicWrite(permanent, previousPermanent);
            else await fs.rm(permanent, { force: true });
          } catch (rollbackError) {
            throw new Error(`Registry update failed and Job rollback failed. Registry: ${String(registryError)}; rollback: ${String(rollbackError)}`);
          }
          throw registryError;
        }

        return toolResult("job_promote_draft", {
          draft_path: toCadgptPath(draft),
          managed_path: toCadgptPath(permanent),
          managed_absolute_path: permanent,
          library_id,
          registry_id: metadata.id,
          steps: validation.steps,
          registry_updated: true,
          rollback_safe: true,
          draft_retained: true,
          test_evidence_recorded: true,
          final_validation_evidence_recorded: true,
        });
      } catch (error) {
        return toolError("job_promote_draft", error);
      }
    }
  );
}
