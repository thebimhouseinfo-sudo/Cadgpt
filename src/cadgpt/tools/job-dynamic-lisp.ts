import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getUserCapabilitiesPath } from "../lib/appdata.js";
import { isPathInside, toCadgptPath } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";
import { listBundledLispEntries, resolveBundledLispPath } from "../lib/bundled-assets.js";
import { resolveRegisteredAssetPath } from "./user-assets.js";
import { validateLispSource } from "./lisp-harness.js";

interface RegistryEntry {
  id?: string;
  kind?: string;
  library_id?: string;
  relative_path?: string;
  semantic_status?: string;
  title?: string;
}

interface RegistryFile {
  version?: number;
  entries?: RegistryEntry[];
}

interface JobEntry {
  id: string;
  library_id: string;
  relative_path: string;
  title?: string;
}

interface SeedSource {
  registry_id: string;
  registry: "internal" | "user";
  library_id: string;
  relative_path: string;
  source_path: string;
  display_path: string;
  source: string;
  sha256: string;
  semantic_status?: string;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function atomicWrite(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), "." + path.basename(target) + "." + randomUUID() + ".tmp");
  try {
    await fs.writeFile(temp, content, "utf8");
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

async function loadRegistry(): Promise<RegistryEntry[]> {
  let parsed: RegistryFile;
  try {
    parsed = JSON.parse(await fs.readFile(getUserCapabilitiesPath(), "utf8")) as RegistryFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!Array.isArray(parsed.entries)) throw new Error("User Registry is missing entries[]");
  return parsed.entries;
}

async function findJob(jobId: string): Promise<JobEntry> {
  const needle = jobId.trim().toLowerCase();
  const entries = await loadRegistry();
  const matches = entries.filter(
    (entry) =>
      entry.kind === "job" &&
      String(entry.id || "").trim().toLowerCase() === needle
  );
  if (!matches.length) throw new Error("Managed User Job not found: " + jobId);
  if (matches.length > 1) throw new Error("Managed User Job is ambiguous: " + jobId);
  const entry = matches[0];
  const libraryId = String(entry.library_id || "");
  const relativePath = String(entry.relative_path || "");
  if (!libraryId || !relativePath) {
    throw new Error("Managed User Job is missing library_id/relative_path: " + jobId);
  }
  return {
    id: String(entry.id),
    library_id: libraryId,
    relative_path: relativePath,
    ...(entry.title ? { title: String(entry.title) } : {}),
  };
}

function safeDynamicRelative(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (
    parts.length < 2 ||
    parts[0].toLowerCase() !== "dynamic-lisp" ||
    parts.includes("..") ||
    path.extname(normalized).toLowerCase() !== ".lsp"
  ) {
    throw new Error(
      "JOB_DYNAMIC_LISP_PATH: relative_path must be a safe .lsp path under dynamic-lisp/**"
    );
  }
  return normalized;
}

async function jobTarget(
  job: JobEntry,
  relativePath: string
): Promise<{ job_root: string; target: string; relative_path: string }> {
  const entrypoint = await resolveRegisteredAssetPath(
    "job",
    job.library_id,
    job.relative_path
  );
  const jobRoot = path.dirname(entrypoint);
  const relative = safeDynamicRelative(relativePath);
  const target = path.resolve(jobRoot, relative);
  if (!isPathInside(target, jobRoot)) {
    throw new Error("JOB_DYNAMIC_LISP_PATH: dynamic Lisp path escapes the owning Job folder");
  }
  return { job_root: jobRoot, target, relative_path: relative };
}

async function seedSource(sourceLispId: string): Promise<SeedSource> {
  const needle = sourceLispId.trim().toLowerCase();
  if (!needle) throw new Error("source_lisp_id is required");

  const internal = (await listBundledLispEntries()).find(
    (entry) => entry.id.toLowerCase() === needle
  );
  if (internal) {
    const sourcePath = await resolveBundledLispPath(
      internal.library_id,
      internal.relative_path
    );
    const source = await fs.readFile(sourcePath, "utf8");
    const validation = validateLispSource(source, [], {
      profile: "syntax",
      fileName: path.basename(sourcePath),
    });
    if (!validation.valid) {
      throw new Error(
        "JOB_DYNAMIC_LISP_SOURCE_INVALID: " +
          internal.id +
          " failed syntax validation: " +
          validation.diagnostics
            .filter((item) => item.severity === "error")
            .map((item) => item.code)
            .join(", ")
      );
    }
    return {
      registry_id: internal.id,
      registry: "internal",
      library_id: internal.library_id,
      relative_path: internal.relative_path,
      source_path: sourcePath,
      display_path: toCadgptPath(sourcePath),
      source,
      sha256: validation.sha256,
    };
  }

  const entries = await loadRegistry();
  const matches = entries.filter(
    (entry) =>
      entry.kind === "lisp" &&
      String(entry.id || "").trim().toLowerCase() === needle
  );
  if (!matches.length) {
    throw new Error(
      "JOB_DYNAMIC_LISP_SOURCE_NOT_FOUND: registered Lisp capability not found: " +
        sourceLispId
    );
  }
  if (matches.length > 1) {
    throw new Error(
      "JOB_DYNAMIC_LISP_SOURCE_AMBIGUOUS: multiple registered Lisp capabilities match: " +
        sourceLispId
    );
  }

  const entry = matches[0];
  const libraryId = String(entry.library_id || "");
  const relativePath = String(entry.relative_path || "");
  const sourcePath = await resolveRegisteredAssetPath(
    "lisp",
    libraryId,
    relativePath
  );
  const source = await fs.readFile(sourcePath, "utf8");
  const validation = validateLispSource(source, [], {
    profile: "syntax",
    fileName: path.basename(sourcePath),
  });
  if (!validation.valid) {
    throw new Error(
      "JOB_DYNAMIC_LISP_SOURCE_INVALID: " +
        String(entry.id) +
        " failed syntax validation: " +
        validation.diagnostics
          .filter((item) => item.severity === "error")
          .map((item) => item.code)
          .join(", ")
    );
  }

  return {
    registry_id: String(entry.id),
    registry: "user",
    library_id: libraryId,
    relative_path: relativePath,
    source_path: sourcePath,
    display_path: toCadgptPath(sourcePath),
    source,
    sha256: validation.sha256,
    ...(entry.semantic_status
      ? { semantic_status: String(entry.semantic_status) }
      : {}),
  };
}

async function readJsonIfExists(
  target: string
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function registerJobDynamicLispTools(server: McpServer): void {
  server.registerTool(
    "job_dynamic_lisp_prepare",
    {
      title: "Prepare or Reuse Job-owned Dynamic Lisp",
      description:
        "Seed a persistent Job-owned dynamic Lisp from a registered working Lisp source exactly once. Later calls reuse the existing Job copy instead of copying the base source again.",
      inputSchema: {
        job_id: z.string().min(1),
        source_lisp_id: z.string().min(1),
        relative_path: z
          .string()
          .optional()
          .describe(
            "Optional path under dynamic-lisp/** inside the Job folder. Defaults to dynamic-lisp/<source filename>."
          ),
      },
    },
    async ({ job_id, source_lisp_id, relative_path }) => {
      try {
        const job = await findJob(job_id);
        const seed = await seedSource(source_lisp_id);
        const targetInfo = await jobTarget(
          job,
          relative_path?.trim() ||
            "dynamic-lisp/" + path.basename(seed.source_path)
        );
        const provenancePath = targetInfo.target + ".source.json";

        return await withFileMutationLocks(
          [targetInfo.target, provenancePath],
          async () => {
            let existing: string | null = null;
            try {
              existing = await fs.readFile(targetInfo.target, "utf8");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }

            if (existing !== null) {
              const validation = validateLispSource(existing, [], {
                profile: "syntax",
                fileName: path.basename(targetInfo.target),
              });
              if (!validation.valid) {
                throw new Error(
                  "JOB_DYNAMIC_LISP_EXISTING_INVALID: persistent Job copy failed syntax validation: " +
                    validation.diagnostics
                      .filter((item) => item.severity === "error")
                      .map((item) => item.code)
                      .join(", ")
                );
              }
              const provenance = await readJsonIfExists(provenancePath);
              const seededHash =
                typeof provenance?.source_sha256 === "string"
                  ? String(provenance.source_sha256)
                  : null;
              return toolResult("job_dynamic_lisp_prepare", {
                job_id: job.id,
                job_root: toCadgptPath(targetInfo.job_root),
                dynamic_lisp_path: toCadgptPath(targetInfo.target),
                dynamic_lisp_absolute_path: targetInfo.target,
                relative_path: targetInfo.relative_path,
                reused: true,
                copied_from_source: false,
                sha256: validation.sha256,
                source_registry_id: seed.registry_id,
                source_registry: seed.registry,
                source_path: seed.display_path,
                source_sha256: seed.sha256,
                source_changed_since_seed:
                  seededHash !== null && seededHash !== seed.sha256,
                provenance: provenance ?? null,
                rule:
                  "Reuse the existing Job-owned dynamic Lisp. Do not recopy the base source on normal runs.",
              });
            }

            await fs.mkdir(path.dirname(targetInfo.target), {
              recursive: true,
            });
            await atomicWrite(targetInfo.target, seed.source);
            const provenance = {
              version: 1,
              job_id: job.id,
              source_lisp_id: seed.registry_id,
              source_registry: seed.registry,
              source_path: seed.display_path,
              source_sha256: seed.sha256,
              dynamic_lisp_relative_path: targetInfo.relative_path,
              current_sha256: seed.sha256,
              created_at: new Date().toISOString(),
              mutation_policy:
                "exact-replacement-only; preserve source code outside declared dynamic data/sections",
            };
            await atomicWrite(
              provenancePath,
              JSON.stringify(provenance, null, 2) + "\n"
            );

            return toolResult("job_dynamic_lisp_prepare", {
              job_id: job.id,
              job_root: toCadgptPath(targetInfo.job_root),
              dynamic_lisp_path: toCadgptPath(targetInfo.target),
              dynamic_lisp_absolute_path: targetInfo.target,
              relative_path: targetInfo.relative_path,
              reused: false,
              copied_from_source: true,
              byte_for_byte_seed: true,
              sha256: seed.sha256,
              source_registry_id: seed.registry_id,
              source_registry: seed.registry,
              source_path: seed.display_path,
              source_sha256: seed.sha256,
              provenance_path: toCadgptPath(provenancePath),
              rule:
                "Patch only declared dynamic data/sections; do not wrap or adapt the original command.",
            });
          }
        );
      } catch (error) {
        return toolError("job_dynamic_lisp_prepare", error);
      }
    }
  );

  server.registerTool(
    "job_dynamic_lisp_patch",
    {
      title: "Patch Job-owned Dynamic Lisp",
      description:
        "Apply hash-guarded exact replacements to a persistent Job-owned dynamic Lisp. Untouched source remains unchanged and the result must pass AutoLISP syntax validation before write.",
      inputSchema: {
        job_id: z.string().min(1),
        relative_path: z
          .string()
          .min(1)
          .describe("Path under dynamic-lisp/** inside the registered Job folder."),
        expected_sha256: z.string().length(64),
        replacements: z
          .array(
            z.object({
              section: z.string().min(1).max(160),
              old_text: z.string().min(1),
              new_text: z.string(),
              replace_all: z.boolean().optional().default(false),
            })
          )
          .min(1)
          .max(50),
      },
    },
    async ({ job_id, relative_path, expected_sha256, replacements }) => {
      try {
        const job = await findJob(job_id);
        const targetInfo = await jobTarget(job, relative_path);
        const provenancePath = targetInfo.target + ".source.json";

        return await withFileMutationLocks(
          [targetInfo.target, provenancePath],
          async () => {
            const original = await fs.readFile(targetInfo.target, "utf8");
            const beforeHash = sha256(original);
            if (beforeHash !== expected_sha256) {
              throw new Error(
                "RESOURCE_CONFLICT: expected sha256 " +
                  expected_sha256 +
                  ", current " +
                  beforeHash
              );
            }

            let updated = original;
            const applied: Array<{
              section: string;
              replace_all: boolean;
              occurrences: number;
            }> = [];

            for (const replacement of replacements) {
              if (replacement.old_text === replacement.new_text) {
                throw new Error(
                  "JOB_DYNAMIC_LISP_NOOP: section '" +
                    replacement.section +
                    "' old_text and new_text are identical"
                );
              }
              const occurrences =
                updated.split(replacement.old_text).length - 1;
              if (occurrences < 1) {
                throw new Error(
                  "JOB_DYNAMIC_LISP_SECTION_NOT_FOUND: exact old_text for section '" +
                    replacement.section +
                    "' was not found"
                );
              }
              updated = replacement.replace_all
                ? updated
                    .split(replacement.old_text)
                    .join(replacement.new_text)
                : updated.replace(
                    replacement.old_text,
                    replacement.new_text
                  );
              applied.push({
                section: replacement.section,
                replace_all: replacement.replace_all,
                occurrences: replacement.replace_all ? occurrences : 1,
              });
            }

            const validation = validateLispSource(updated, [], {
              profile: "syntax",
              fileName: path.basename(targetInfo.target),
            });
            if (!validation.valid) {
              throw new Error(
                "JOB_DYNAMIC_LISP_PATCH_INVALID: patch would create invalid AutoLISP: " +
                  validation.diagnostics
                    .filter((item) => item.severity === "error")
                    .map((item) => item.code)
                    .join(", ")
              );
            }

            const latest = await fs.readFile(targetInfo.target, "utf8");
            if (sha256(latest) !== beforeHash) {
              throw new Error(
                "RESOURCE_CONFLICT: dynamic Lisp changed during patch preparation"
              );
            }

            await atomicWrite(targetInfo.target, updated);
            const provenance =
              (await readJsonIfExists(provenancePath)) ?? {};
            await atomicWrite(
              provenancePath,
              JSON.stringify(
                {
                  ...provenance,
                  current_sha256: validation.sha256,
                  last_patch_at: new Date().toISOString(),
                  last_patched_sections: applied.map(
                    (item) => item.section
                  ),
                },
                null,
                2
              ) + "\n"
            );

            return toolResult("job_dynamic_lisp_patch", {
              job_id: job.id,
              dynamic_lisp_path: toCadgptPath(targetInfo.target),
              dynamic_lisp_absolute_path: targetInfo.target,
              relative_path: targetInfo.relative_path,
              sha256_before: beforeHash,
              sha256_after: validation.sha256,
              syntax_valid: true,
              applied,
              preserved_unmatched_source: true,
              rule:
                "Only exact declared dynamic sections were replaced; reuse this persisted Job copy on the next run.",
            });
          }
        );
      } catch (error) {
        return toolError("job_dynamic_lisp_patch", error);
      }
    }
  );
}
