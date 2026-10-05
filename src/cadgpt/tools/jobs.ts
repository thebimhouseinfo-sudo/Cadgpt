import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getJobDraftRoot,
  getJobLibrariesRoot,
  getUserCapabilitiesPath,
  getUserLibrariesManifestPath,
} from "../lib/appdata.js";
import { getRepoRoot, isPathInside, resolveAbsoluteMutationPath, resolveAllowedPath, toCadgptPath } from "../lib/path-security.js";
import { currentToolLease } from "../lib/work-registration.js";
import {
  getJobLocalCompatStatus,
  markJobLocalCompatChecked,
} from "../lib/job-local-compat.js";
import { getBoundDrawingsForExecution } from "../session/drawing-binding.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";
import { withCadHostLock } from "../runtime/cad-scheduler.js";
import { prepareDrawingMetadataLocation } from "../runtime/drawing-persistence.js";
import {
  cleanupJobRuntimeForExecution,
  prepareJobResultLocationForExecution,
  prepareJobRuntimeForExecution,
} from "../runtime/job-runtime.js";
import { resolveRegisteredAssetPath } from "./user-assets.js";
import {
  getBundledLispLibrariesRoot,
} from "../lib/bundled-assets.js";
import {
  getInternalJob,
  isInternalJobId,
  listInternalJobs,
  type InternalJobEntry,
} from "../lib/internal-jobs.js";
import {
  loadVerifiedLispForCurrentWork,
  markInternalLispGroupLoaded,
} from "./cad-proxy.js";
import {
  JOB_BUNDLE_ASSET_DIRS,
  inspectJobBundle,
  replaceJobBundleFromSource,
} from "../lib/job-bundle.js";

const execFileAsync = promisify(execFile);

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

async function atomicWrite(
  target: string,
  content: string
): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temp, content, "utf8");
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

async function readJson<T>(
  target: string,
  fallback: T
): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
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
    .filter(
      (entry) =>
        entry.kind === "job" &&
        !isInternalJobId(String(entry.id || ""))
    )
    .map((entry) => entry as unknown as JobEntry)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function assertJobLocalCompatReady(
  action: string
): Promise<void> {
  const status = await getJobLocalCompatStatus();
  if (!status.update_required) return;
  throw new Error(
    [
      "JOB_LOCAL_COMPAT_UPDATE_REQUIRED:",
      `local Custom Jobs have not been checked for the current Job compatibility epoch before ${action}.`,
      "Run job_local_compat_status, then use jobcreate CONTRACT UPDATE mode to scan User Registry Jobs, inspect/fix only affected local Job packages, validate/re-check them, report any externally blocked action, and finally call job_local_compat_mark_checked.",
      `source_epoch=${status.source_epoch}`,
      `checked_epoch=${status.checked_epoch}`,
    ].join(" ")
  );
}

export async function listRegisteredJobs(): Promise<Array<{
  id: string;
  title: string;
  summary?: string;
}>> {
  const jobs = await loadJobs();
  return [
    ...listInternalJobs().map((job) => ({
      id: job.id,
      title: job.title,
      summary: job.summary,
    })),
    ...jobs.map((job) => ({
      id: job.id,
      title: job.title,
      ...(job.summary ? { summary: job.summary } : {}),
    })),
  ].sort((a, b) => a.id.localeCompare(b.id));
}

function safeRelativeRegisteredJob(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const ext = path.extname(normalized).toLowerCase();
  if (!normalized || normalized.split("/").includes("..") || path.isAbsolute(normalized) || ![".md", ".py"].includes(ext)) {
    throw new Error("relative_path must be a safe .md or .py path inside the registered Job library");
  }
  return normalized;
}

type JobExecutionMode = "reasoning" | "direct";

function jobExecutionModeForPath(value: string): JobExecutionMode {
  return path.extname(value).toLowerCase() === ".py" ? "direct" : "reasoning";
}

function safeRelativeJob(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const ext = path.extname(normalized).toLowerCase();
  const invalid =
    !normalized ||
    normalized.split("/").includes("..") ||
    path.isAbsolute(normalized) ||
    ![".md", ".py"].includes(ext);
  if (invalid) {
    throw new Error("relative_path must be a safe .md or .py path inside the managed Job library");
  }
  if (ext === ".md" && path.basename(normalized).toLowerCase() !== "job.md") {
    throw new Error("Reasoning Job relative_path must end in JOB.md");
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

function assertDraftVirtualPath(value: string): JobExecutionMode {
  const target = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(
        getJobDraftRoot(),
        value.replaceAll("\\", "/").replace(/^appdata\/workspace\/job-draft\//i, "")
      );
  if (!isPathInside(target, getJobDraftRoot())) {
    throw new Error("Job draft path must stay under the approved Job draft root");
  }
  const ext = path.extname(target).toLowerCase();
  if (![".md", ".py"].includes(ext)) {
    throw new Error("Job draft must be a reasoning JOB.md or a direct .py script");
  }
  if (ext === ".md" && path.basename(target).toLowerCase() !== "job.md") {
    throw new Error("Reasoning Job draft path must end in JOB.md");
  }
  if (!path.isAbsolute(value)) {
    const normalized = value.replaceAll("\\", "/").toLowerCase();
    if (!normalized.startsWith("appdata/workspace/job-draft/")) {
      throw new Error("Relative Job draft paths must be under appdata/workspace/job-draft/**");
    }
  }
  return ext === ".py" ? "direct" : "reasoning";
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


async function validateDirectJobSource(
  target: string
): Promise<{ valid: boolean; diagnostics: string[]; steps: number }> {
  const python = directJobPython();
  try {
    await assertDirectJobPythonReady(python);
  } catch (error) {
    return {
      valid: false,
      diagnostics: [error instanceof Error ? error.message : String(error)],
      steps: 1,
    };
  }

  const probe = [
    "import ast, pathlib, sys",
    "p = pathlib.Path(sys.argv[1])",
    "ast.parse(p.read_text(encoding='utf-8'), filename=str(p))",
  ].join("; ");

  try {
    await execFileAsync(python, ["-c", probe, target], {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 512 * 1024,
    });
    return { valid: true, diagnostics: [], steps: 1 };
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr || error)
        : String(error);
    return {
      valid: false,
      diagnostics: [`Direct Python Job syntax validation failed: ${message.trim()}`],
      steps: 1,
    };
  }
}

async function validateJobDraft(
  target: string,
  content: string
): Promise<{
  valid: boolean;
  diagnostics: string[];
  steps: number;
  execution_mode: JobExecutionMode;
}> {
  const execution_mode = jobExecutionModeForPath(target);
  const validation =
    execution_mode === "direct"
      ? await validateDirectJobSource(target)
      : validateJobSource(content);
  return { ...validation, execution_mode };
}

async function assertManagedLibraryExists(libraryId: string): Promise<void> {
  if (libraryId.trim().toLowerCase() === "tbh-toolkit") {
    throw new Error(
      "INTERNAL_LIBRARY_RESERVED: tbh-toolkit is reserved for CadGPT Internal Registry/install content and cannot be a User Job library."
    );
  }
  const manifest = await readJson<{ libraries?: Array<Record<string, unknown>> }>(getUserLibrariesManifestPath(), { libraries: [] });
  const jobLibraries = (manifest.libraries ?? []).filter((item) => item.kind === "job" && item.enabled !== false);
  const match = jobLibraries.find((item) => item.id === libraryId);
  if (!match) {
    const available = jobLibraries.map((item) => String(item.id)).join(", ") || "(none)";
    throw new Error(
      `MANAGED_LIBRARY_NOT_FOUND: Enabled managed Job library '${libraryId}' not found in libraries.json. Available libraries: [${available}]. Create one with library_create, import one with library_import, or choose an existing library.`
    );
  }
}

export function registerJobDiscoveryTools(server: McpServer): void {
  server.registerTool(
    "job_local_compat_status",
    {
      title: "Check Local Job Compatibility Signal",
      description:
        "Lightweight O(1) compatibility check for local Custom Jobs. It reads only the small state marker and never scans User Registry Job packages. If update_required=true, jobcreate must run CONTRACT UPDATE mode before normal User Job create/run/update work.",
      inputSchema: {},
    },
    async () => {
      try {
        const status =
          await getJobLocalCompatStatus();
        return toolResult(
          "job_local_compat_status",
          {
            ...status,
            scan_mode: status.update_required
              ? "deep_scan_required"
              : "fast_path",
            instruction: status.update_required
              ? "Job build contract affecting local Custom Jobs changed. Before normal User Job create/run/update work, read knowledge/jobs/LOCAL_COMPAT_UPDATE.md and use jobcreate CONTRACT UPDATE mode: enumerate User Registry Jobs, inspect package/source only then, repair affected Jobs through the normal checkout/validate/test/promote lifecycle, report any blocked external action, then mark the epoch checked."
              : "Compatibility signal matches. Do not deep-scan local Job packages.",
          }
        );
      } catch (error) {
        return toolError(
          "job_local_compat_status",
          error
        );
      }
    }
  );

  server.registerTool(
    "job_list",
    {
      title: "List CadGPT Jobs",
      description:
        "List official Internal Registry Jobs plus concrete User Registry Jobs. Internal Jobs are read-only CadGPT capabilities and cannot be overridden by user assets.",
      inputSchema: { library_id: z.string().optional() },
    },
    async ({ library_id }) => {
      try {
        let jobs: Array<Record<string, unknown>> = [
          ...listInternalJobs().map((job) => ({
            id: job.id,
            title: job.title,
            library_id: job.library_id,
            registry: "internal",
            execution_mode: job.execution_mode,
            executor: job.executor,
            path: job.resource_root,
            summary: job.summary,
            status: job.status,
            risk: job.risk,
          })),
          ...(await loadJobs()).map((job) => ({
            id: job.id,
            title: job.title,
            library_id: job.library_id,
            registry: "user",
            execution_mode: jobExecutionModeForPath(job.relative_path),
            path: `appdata/libraries/jobs/${job.library_id}/${job.relative_path}`,
            ...(job.summary ? { summary: job.summary } : {}),
            ...(job.status ? { status: job.status } : {}),
            ...(job.risk ? { risk: job.risk } : {}),
          })),
        ];
        if (library_id) {
          jobs = jobs.filter(
            (job) => String(job.library_id ?? "") === library_id
          );
        }
        jobs.sort((a, b) =>
          String(a.id ?? "").localeCompare(String(b.id ?? ""))
        );
        return toolResult("job_list", {
          jobs,
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
      title: "Load CadGPT Job",
      description:
        "Load one official Internal Job or one concrete User Job. Internal Jobs expose read-only metadata; User Jobs resolve to managed AppData source.",
      inputSchema: { id: z.string().min(1).describe("Canonical Job registry id returned by job_list/registry_list") },
    },
    async ({ id }) => {
      try {
        const internal = getInternalJob(id);
        if (internal) {
          return toolResult("job_get", {
            id: internal.id,
            title: internal.title,
            library_id: internal.library_id,
            registry: "internal",
            path: internal.resource_root,
            execution_mode: internal.execution_mode,
            executor: internal.executor,
            summary: internal.summary,
            status: internal.status,
            risk: internal.risk,
            rules: "knowledge/jobs/JOB_RULES.md",
          });
        }

        const jobs = await loadJobs();
        const entry = jobs.find(
          (job) => job.id.toLowerCase() === id.trim().toLowerCase()
        );
        if (!entry) throw new Error(`Job not found: ${id}`);
        const relative = safeRelativeRegisteredJob(entry.relative_path);
        const real = await resolveRegisteredAssetPath(
          "job",
          entry.library_id,
          relative
        );
        const content = await fs.readFile(real, "utf8");
        const executionMode =
          path.extname(real).toLowerCase() === ".py" ? "direct" : "reasoning";
        const bundle = await inspectJobBundle(real);
        return toolResult("job_get", {
          id: entry.id,
          title: entry.title,
          library_id: entry.library_id,
          registry: "user",
          path: real,
          relative_path: relative,
          execution_mode: executionMode,
          content,
          bundle_sha256: bundle.sha256,
          bundle_files: bundle.files,
          ...(executionMode === "reasoning"
            ? { harness: "knowledge/jobs/REASONING_HARNESS.md" }
            : {}),
          rules: "knowledge/jobs/JOB_RULES.md",
        });
      } catch (error) {
        return toolError("job_get", error);
      }
    }
  );
}

function directJobPython(): string {
  const configured = (process.env.CAD_MCP_PYTHON || "").trim();
  if (configured) {
    if (path.isAbsolute(configured)) return configured;
    if (configured.includes("/") || configured.includes("\\")) {
      return path.resolve(getRepoRoot(), configured);
    }
    return configured;
  }
  return path.join(
    getRepoRoot(),
    ".venv-cad",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  );
}

function directJobPythonIsPathLike(python: string): boolean {
  return (
    path.isAbsolute(python) ||
    python.includes("/") ||
    python.includes("\\")
  );
}

async function assertDirectJobPythonReady(python: string): Promise<void> {
  if (!directJobPythonIsPathLike(python)) return;
  const stat = await fs.stat(python).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error("CadGPT Python runtime is not ready. Run setup.bat first.");
  }
}

async function executeDirectJobScript(
  script: string,
  args: string[],
  jobId: string
): Promise<Record<string, unknown>> {
  const python = directJobPython();
  await assertDirectJobPythonReady(python);

  const lease = currentToolLease();
  const drawings = getBoundDrawingsForExecution(lease.workId);
  if (drawings.length > 1) {
    throw new Error("DIRECT_JOB_DRAWING_AMBIGUOUS: one work may bind only one drawing.");
  }
  const drawing = drawings[0];
  const runtime =
    await prepareJobRuntimeForExecution(
      lease.workId,
      jobId,
      script
    );

  let jobResultRoot: string | null = null;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CADGPT_EXECUTION_ID: lease.workId,
    CADGPT_JOB_ID: jobId,
    CADGPT_JOB_RUNTIME_ROOT:
      runtime.runtime_root,
    CADGPT_REPO_ROOT: getRepoRoot(),
    CADGPT_BUNDLED_LISP_ROOT:
      getBundledLispLibrariesRoot(),
    ...(drawing
      ? {
          CADGPT_DRAWING_ID: drawing.drawing_id,
          CADGPT_DRAWING_NAME: drawing.name,
          CADGPT_DRAWING_PATH:
            drawing.full_name || drawing.name,
          CADGPT_DRAWING_HOST: drawing.host,
          CADGPT_DRAWING_RUNTIME_IDENTITY:
            drawing.runtime_document_identity,
        }
      : {}),
  };

  const execute = async () => {
    if (drawing) {
      const drawingLocation =
        await prepareDrawingMetadataLocation(
          lease.workId,
          drawing
        );
      const resultLocation =
        await prepareJobResultLocationForExecution(
          lease.workId,
          String(
            drawingLocation.absolute_path
          )
        );
      jobResultRoot = String(
        resultLocation.absolute_path
      );
      env.CADGPT_JOB_RESULT_ROOT =
        jobResultRoot;
    }
    return execFileAsync(
      python,
      [script, ...args],
      {
        cwd: runtime.runtime_root,
        env,
        windowsHide: true,
        timeout: 5 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
      }
    );
  };

  try {
    const result = drawing
      ? await withCadHostLock(
          drawing.host,
          execute
        )
      : await execute();

    return {
      script,
      execution_mode: "direct",
      exit_code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      runtime_root:
        runtime.runtime_root,
      job_result_root:
        jobResultRoot,
      drawing: drawing
        ? {
            drawing_id:
              drawing.drawing_id,
            name: drawing.name,
            full_name: drawing.full_name,
          }
        : null,
    };
  } finally {
    await cleanupJobRuntimeForExecution(
      lease.workId
    );
  }
}

const TBH_LOADER_PATH =
  "resources/cad/internal-lisp/tbh-toolkit/tbhloader.lsp";

export async function executeInternalDirectJob(
  entry: InternalJobEntry,
  args: string[],
  loader: typeof loadVerifiedLispForCurrentWork =
    loadVerifiedLispForCurrentWork,
  markLoaded: typeof markInternalLispGroupLoaded =
    markInternalLispGroupLoaded
): Promise<Record<string, unknown>> {
  if (entry.executor !== "builtin:tbh-toolkit-loader") {
    throw new Error(`INTERNAL_JOB_EXECUTOR_UNSUPPORTED: ${entry.executor}`);
  }
  if (args.length > 0) {
    throw new Error(
      "INTERNAL_JOB_ARGS_UNSUPPORTED: tbh does not accept positional arguments."
    );
  }

  const result = await loader(TBH_LOADER_PATH);
  if (!result.loaded) {
    throw new Error(
      `TBH_TOOLKIT_LOAD_FAILED: loader failed: ${JSON.stringify(
        result.raw
      )}`
    );
  }

  markLoaded(
    result.drawing_id,
    entry.library_id
  );

  return {
    execution_mode: "direct",
    registry: "internal",
    executor: entry.executor,
    library_id: entry.library_id,
    resource_root: entry.resource_root,
    drawing_id: result.drawing_id,
    loader_calls: 1,
    loader_path: TBH_LOADER_PATH,
    loaded: true,
    state: "on",
  };
}

export function registerJobAuthoringTools(server: McpServer): void {
  server.registerTool(
    "job_local_compat_mark_checked",
    {
      title: "Mark Local Job Compatibility Scan Complete",
      description:
        "After jobcreate CONTRACT UPDATE mode has scanned all User Registry Jobs for the current compatibility signal, repaired/validated affected local Jobs, and produced a report, persist the small checked marker. Pending external actions are recorded but do not force the full scan to repeat.",
      inputSchema: {
        scanned_user_jobs: z
          .number()
          .int()
          .min(0),
        report_summary: z
          .string()
          .min(1)
          .max(4000),
        pending_actions: z
          .array(z.string().min(1).max(1000))
          .max(100)
          .optional()
          .default([]),
      },
    },
    async ({
      scanned_user_jobs,
      report_summary,
      pending_actions,
    }) => {
      try {
        await markJobLocalCompatChecked({
          scanned_user_jobs,
          report_summary,
          pending_actions,
        });
        return toolResult(
          "job_local_compat_mark_checked",
          {
            ...(await getJobLocalCompatStatus()),
            scanned_user_jobs,
            pending_actions,
          }
        );
      } catch (error) {
        return toolError(
          "job_local_compat_mark_checked",
          error
        );
      }
    }
  );

  server.registerTool(
    "job_runtime_prepare",
    {
      title: "Prepare Job Runtime",
      description:
        "Reset and authorize the owning Job package runtime/ directory for one reasoning Job execution/test. Supply exactly one registered User Job id or one absolute managed Job draft path. Runtime scratch is reset at the start of each Job run; permanent source, tools, lisp and dynamic-lisp are not modified.",
      inputSchema: {
        id: z.string().min(1).optional(),
        draft_path: z
          .string()
          .min(1)
          .optional(),
      },
    },
    async ({ id, draft_path }) => {
      try {
        if (Boolean(id) === Boolean(draft_path)) {
          throw new Error(
            "JOB_RUNTIME_TARGET_REQUIRED: provide exactly one of id or draft_path."
          );
        }

        let jobId: string;
        let jobFile: string;
        if (id) {
          const jobs = await loadJobs();
          const entry = jobs.find(
            (job) =>
              job.id.toLowerCase() ===
              id.trim().toLowerCase()
          );
          if (!entry) {
            throw new Error(
              `Managed User Job not found: ${id}`
            );
          }
          jobId = entry.id;
          jobFile =
            await resolveRegisteredAssetPath(
              "job",
              entry.library_id,
              safeRelativeRegisteredJob(
                entry.relative_path
              )
            );
        } else {
          if (!path.isAbsolute(draft_path!)) {
            throw new Error(
              "ABSOLUTE_PATH_REQUIRED: job_runtime_prepare draft_path must be absolute."
            );
          }
          assertDraftVirtualPath(draft_path!);
          jobFile =
            await resolveAllowedPath(
              draft_path!
            );
          jobId =
            `draft:${path.basename(
              path.dirname(jobFile)
            )}`;
        }

        const lease = currentToolLease();
        const runtime =
          await prepareJobRuntimeForExecution(
            lease.workId,
            jobId,
            jobFile
          );
        return toolResult(
          "job_runtime_prepare",
          {
            job_id: runtime.job_id,
            job_name: runtime.job_name,
            job_root: runtime.job_root,
            runtime_root:
              runtime.runtime_root,
            runtime_display_path:
              toCadgptPath(
                runtime.runtime_root
              ),
            reset: true,
          }
        );
      } catch (error) {
        return toolError(
          "job_runtime_prepare",
          error
        );
      }
    }
  );

  server.registerTool(
    "job_runtime_finish",
    {
      title: "Finish Job Runtime",
      description:
        "Finish the current reasoning Job runtime context, remove empty Job result folders, and release execution-scoped Job file-write restrictions. Scratch runtime bytes are left in place only until the next run resets them.",
      inputSchema: {},
    },
    async () => {
      try {
        const lease = currentToolLease();
        const cleanup =
          await cleanupJobRuntimeForExecution(
            lease.workId
          );
        return toolResult(
          "job_runtime_finish",
          cleanup
        );
      } catch (error) {
        return toolError(
          "job_runtime_finish",
          error
        );
      }
    }
  );

  server.registerTool(
    "job_run_direct",
    {
      title: "Run Direct Job",
      description:
        "Run one direct Job without model planning. Official Internal Jobs use bounded built-in CadGPT executors; User Registry .py Jobs use CadGPT's fixed Python runtime. User .md Jobs are rejected and must use the reasoning Job harness.",
      inputSchema: {
        id: z.string().min(1),
        args: z.array(z.string()).max(50).optional().default([]),
      },
    },
    async ({ id, args }) => {
      try {
        const internal = getInternalJob(id);
        if (internal) {
          const executed = await executeInternalDirectJob(internal, args);
          return toolResult("job_run_direct", {
            id: internal.id,
            title: internal.title,
            ...executed,
          });
        }

        await assertJobLocalCompatReady(
          "running a User Job"
        );
        const jobs = await loadJobs();
        const entry = jobs.find(
          (job) => job.id.toLowerCase() === id.trim().toLowerCase()
        );
        if (!entry) throw new Error(`Job not found: ${id}`);
        const relative = safeRelativeRegisteredJob(entry.relative_path);
        if (path.extname(relative).toLowerCase() !== ".py") {
          throw new Error(
            "REASONING_JOB_REQUIRED: Markdown Jobs must run through the reasoning Job harness."
          );
        }
        const script = await resolveRegisteredAssetPath(
          "job",
          entry.library_id,
          relative
        );
        const executed = await executeDirectJobScript(script, args, entry.id);

        return toolResult("job_run_direct", {
          id: entry.id,
          title: entry.title,
          registry: "user",
          ...executed,
        });
      } catch (error) {
        return toolError("job_run_direct", error);
      }
    }
  );

  server.registerTool(
    "job_run_direct_draft",
    {
      title: "Run Direct Python Job Draft",
      description:
        "Run the exact validated .py Job draft before promotion. The draft must stay under appdata/workspace/job-draft/** and expected_sha256 must match the bytes returned by job_draft_validate.",
      inputSchema: {
        draft_path: z
          .string()
          .min(1)
          .describe("Absolute .py path under the approved Job draft root."),
        expected_sha256: z
          .string()
          .length(64)
          .describe("Exact sha256 returned by job_draft_validate for the draft being tested."),
        args: z.array(z.string()).max(50).optional().default([]),
      },
    },
    async ({ draft_path, expected_sha256, args }) => {
      try {
        if (!path.isAbsolute(draft_path)) {
          throw new Error(
            "ABSOLUTE_PATH_REQUIRED: job_run_direct_draft draft_path must be absolute"
          );
        }
        const mode = assertDraftVirtualPath(draft_path);
        if (mode !== "direct") {
          throw new Error(
            "DIRECT_JOB_DRAFT_REQUIRED: job_run_direct_draft accepts only .py drafts."
          );
        }
        const target = await resolveAllowedPath(draft_path);
        const content = await fs.readFile(target, "utf8");
        const currentHash = sha256(content);
        if (currentHash !== expected_sha256) {
          throw new Error(
            `RESOURCE_CONFLICT: Job draft changed after validation; expected ${expected_sha256}, current ${currentHash}`
          );
        }
        const validation = await validateJobDraft(target, content);
        if (!validation.valid) {
          throw new Error(
            `JOB_DRAFT_INVALID: ${validation.diagnostics.join(" ")}`
          );
        }
        const executed = await executeDirectJobScript(
          target,
          args,
          `draft:${path.basename(target)}`
        );
        return toolResult("job_run_direct_draft", {
          draft_path: target,
          draft_display_path: toCadgptPath(target),
          sha256: currentHash,
          validation_passed: true,
          ...executed,
        });
      } catch (error) {
        return toolError("job_run_direct_draft", error);
      }
    }
  );

  server.registerTool(
    "job_draft_new",
    {
      title: "Create New Job Draft",
      description:
        "Create a new blank Job draft file (.py for direct Jobs, JOB.md for reasoning Jobs) under the Job draft root. Use this when authoring a brand-new Job from scratch. For editing an existing registered Job use job_checkout instead.",
      inputSchema: {
        draft_path: z
          .string()
          .min(1)
          .describe(
            "Absolute .py or JOB.md path under the approved Job draft root (appdata/workspace/job-draft/**). .py = direct Job; JOB.md = reasoning Job."
          ),
        target_library_id: z
          .string()
          .regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i)
          .optional()
          .describe("Optional explicit target Job library id; otherwise inferred from the first draft-root path segment."),
        content: z.string().describe("Initial file content. For .py: valid Python source. For JOB.md: Job contract markdown."),
        overwrite: z.boolean().optional().default(false).describe("Allow replacing an existing draft only with expected_sha256 conflict protection."),
        expected_sha256: z.string().length(64).optional().describe("Required with overwrite=true when a draft already exists."),
      },
    },
    async ({ draft_path, target_library_id, content, overwrite, expected_sha256 }) => {
      try {
        await assertJobLocalCompatReady(
          "creating a new User Job"
        );
        const executionMode = assertDraftVirtualPath(draft_path);
        const target = await resolveAbsoluteMutationPath(draft_path, {
          allowedRoots: [getJobDraftRoot()],
          forCreate: true,
          label: "Job draft",
        });

        return await withFileMutationLocks([target], async () => {
          let previousContent: string | null = null;
          try {
            previousContent = await fs.readFile(target, "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          if (previousContent !== null) {
            if (!overwrite) {
              throw new Error(
                `JOB_DRAFT_EXISTS: draft already exists at ${target}. Pass overwrite=true with expected_sha256 to replace it.`
              );
            }
            const currentHash = sha256(previousContent);
            if (!expected_sha256 || expected_sha256 !== currentHash) {
              throw new Error(
                `RESOURCE_CONFLICT: existing Job draft changed or expected_sha256 was not supplied; current sha256=${currentHash}`
              );
            }
          }

          await atomicWrite(target, content);
          const validation = await validateJobDraft(target, content);
          console.log(`[AUDIT] job_draft_new ${target} execution_mode=${executionMode}`);

          const lexicalDraft = path.resolve(draft_path);
          const relFromDraftRoot = path
            .relative(path.resolve(getJobDraftRoot()), lexicalDraft)
            .replaceAll("\\", "/");
          const segments = relFromDraftRoot.split("/");
          let libraryStatus: { registered: boolean; library_id: string; note: string } | undefined;
          const potentialLibId = target_library_id || (segments.length > 1 ? segments[0] : "");
          if (potentialLibId) {
            const manifest = await readJson<{ libraries?: Array<Record<string, unknown>> }>(getUserLibrariesManifestPath(), { libraries: [] });
            const found = (manifest.libraries ?? []).some((item) => item.kind === "job" && item.id === potentialLibId && item.enabled !== false);
            libraryStatus = {
              registered: found,
              library_id: potentialLibId,
              note: found
                ? `Target library '${potentialLibId}' exists and is ready for eventual promotion.`
                : `Target library '${potentialLibId}' is not yet in libraries.json. You can continue drafting/testing, then create it with library_create or import it with library_import before job_promote_draft.`,
            };
          }

          return toolResult("job_draft_new", {
            draft_path: target,
            draft_display_path: toCadgptPath(target),
            execution_mode: executionMode,
            bytes: Buffer.byteLength(content),
            validation_passed: validation.valid,
            diagnostics: validation.diagnostics,
            ...(libraryStatus ? { library_status: libraryStatus } : {}),
            note: "Use job_draft_validate to re-validate, then job_promote_draft to register.",
          });
        });
      } catch (error) {
        return toolError("job_draft_new", error);
      }
    }
  );

  server.registerTool(
    "job_checkout",
    {
      title: "Checkout Managed Job for jobcreate",
      description:
        "Checkout one registered managed Job package into an explicit draft path. The primary JOB.md/.py plus Job-owned lisp/**, dynamic-lisp/** and tools/** assets move together. runtime/** is execution scratch and is never checked out. Existing draft bundles require hash-confirmed overwrite.",
      inputSchema: {
        registry_id: z.string().min(1),
        draft_path: z
          .string()
          .min(1)
          .describe(
            "Absolute .md or .py path under the approved Job draft root; extension must match the registered Job"
          ),
        overwrite_existing: z
          .boolean()
          .optional()
          .default(false),
        expected_sha256: z
          .string()
          .length(64)
          .optional()
          .describe(
            "Backward-compatible primary-file guard when the existing draft has no Job-owned assets"
          ),
        expected_bundle_sha256: z
          .string()
          .length(64)
          .optional()
          .describe(
            "Required for overwrite when the existing draft package contains Job-owned lisp/**, dynamic-lisp/** or tools/** assets"
          ),
      },
    },
    async ({
      registry_id,
      draft_path,
      overwrite_existing,
      expected_sha256,
      expected_bundle_sha256,
    }) => {
      try {
        const jobs = await loadJobs();
        const entry = jobs.find(
          (job) =>
            job.id.toLowerCase() ===
            registry_id.trim().toLowerCase()
        );
        if (!entry) {
          throw new Error(
            `Managed Job not found in User Registry: ${registry_id}`
          );
        }

        const source = await resolveAllowedPath(
          resolveManagedJob(entry)
        );
        const sourceMode =
          jobExecutionModeForPath(source);
        const sourceBundle =
          await inspectJobBundle(source);
        if (!sourceBundle.exists) {
          throw new Error(
            `Managed Job package is missing: ${toCadgptPath(source)}`
          );
        }

        const draftMode =
          assertDraftVirtualPath(draft_path);
        const draft = await resolveAbsoluteMutationPath(
          draft_path,
          {
            allowedRoots: [getJobDraftRoot()],
            forCreate: true,
            label: "Job draft",
          }
        );
        if (draftMode !== sourceMode) {
          throw new Error(
            `JOB_DRAFT_MODE_MISMATCH: registered Job is ${sourceMode} but draft path is ${draftMode}.`
          );
        }

        const draftAssetPaths =
          JOB_BUNDLE_ASSET_DIRS.map((asset) =>
            path.join(path.dirname(draft), asset)
          );

        return await withFileMutationLocks(
          [draft, ...draftAssetPaths],
          async () => {
            const existing =
              await inspectJobBundle(draft);
            if (existing.exists) {
              if (!overwrite_existing) {
                throw new Error(
                  `Draft package already exists; explicit overwrite_existing=true is required: ${draft}`
                );
              }

              if (existing.has_assets) {
                if (
                  !expected_bundle_sha256 ||
                  expected_bundle_sha256 !==
                    existing.sha256
                ) {
                  throw new Error(
                    `RESOURCE_CONFLICT: existing Job draft bundle changed or expected_bundle_sha256 was not supplied; current bundle sha256=${existing.sha256}`
                  );
                }
              } else {
                const previousDraft =
                  await fs.readFile(draft, "utf8");
                if (
                  !expected_sha256 ||
                  sha256(previousDraft) !==
                    expected_sha256
                ) {
                  throw new Error(
                    "RESOURCE_CONFLICT: existing Job draft changed or expected_sha256 was not supplied"
                  );
                }
              }
            }

            let mutation:
              | Awaited<
                  ReturnType<
                    typeof replaceJobBundleFromSource
                  >
                >
              | null = null;
            let installedBundleSha: string | null =
              null;
            try {
              mutation =
                await replaceJobBundleFromSource(
                  source,
                  draft
                );
              const content = await fs.readFile(
                draft,
                "utf8"
              );
              const validation =
                await validateJobDraft(
                  draft,
                  content
                );
              const checkedOut =
                await inspectJobBundle(draft);
              installedBundleSha =
                checkedOut.sha256;
              await mutation.finalize();

              return toolResult("job_checkout", {
                registry_id: entry.id,
                library_id: entry.library_id,
                execution_mode:
                  validation.execution_mode,
                source_path: toCadgptPath(source),
                source_bundle_sha256:
                  sourceBundle.sha256,
                draft_path: draft,
                draft_display_path:
                  toCadgptPath(draft),
                draft_bundle_sha256:
                  checkedOut.sha256,
                bundle_files: checkedOut.files,
                asset_directories:
                  mutation.asset_directories,
                source_contract_valid:
                  validation.valid,
                diagnostics:
                  validation.diagnostics,
                managed_source_unchanged: true,
              });
            } catch (error) {
              if (mutation) {
                const current =
                  await inspectJobBundle(draft);
                if (
                  installedBundleSha &&
                  current.sha256 !==
                    installedBundleSha
                ) {
                  throw new Error(
                    `RESOURCE_CONFLICT: checkout failed and draft bundle changed outside this operation; refusing rollback. Cause: ${String(error)}`
                  );
                }
                await mutation.rollback();
              }
              throw error;
            }
          }
        );
      } catch (error) {
        return toolError("job_checkout", error);
      }
    }
  );

  server.registerTool(
    "job_draft_validate",
    {
      title: "Validate Job Workspace Draft",
      description: "Validate a Job workspace draft. Reasoning JOB.md uses the canonical workflow contract; direct .py uses Python syntax validation. Absolute draft paths returned by job_checkout are accepted.",
      inputSchema: { path: z.string().min(1) },
    },
    async ({ path: input }) => {
      try {
        assertDraftVirtualPath(input);
        const target = await resolveAllowedPath(input);
        const content = await fs.readFile(target, "utf8");
        const validation = await validateJobDraft(target, content);
        const bundle = await inspectJobBundle(target);
        return toolResult(
          "job_draft_validate",
          {
            path: toCadgptPath(target),
            sha256: sha256(content),
            bundle_sha256: bundle.sha256,
            bundle_files: bundle.files,
            ...validation,
            rules: "knowledge/jobs/JOB_RULES.md",
          },
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
      description:
        "Promote one validated Job draft package into an explicit managed Job target and synchronize User Registry rollback-safely. JOB.md/.py, lisp/**, dynamic-lisp/** and tools/** are promoted as one bundle. runtime/** is never promoted.",
      inputSchema: {
        draft_path: z.string().min(1),
        target_path: z
          .string()
          .min(1)
          .describe(
            "Absolute target path that must exactly match library_id + relative_path"
          ),
        library_id: z
          .string()
          .regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i),
        relative_path: z.string().min(1),
        metadata: jobMetadataSchema,
        overwrite: z
          .boolean()
          .optional()
          .default(false),
        expected_target_sha256: z
          .string()
          .length(64)
          .optional()
          .describe(
            "Backward-compatible primary-file guard when the existing managed Job has no Job-owned assets"
          ),
        expected_target_bundle_sha256: z
          .string()
          .length(64)
          .optional()
          .describe(
            "Required for overwrite when the existing managed Job package contains Job-owned lisp/**, dynamic-lisp/** or tools/** assets"
          ),
        test_evidence: z.string().min(1).max(2000),
        final_validation_evidence: z
          .string()
          .min(1)
          .max(2000),
        user_accepted: z.literal(true),
      },
    },
    async ({
      draft_path,
      target_path,
      library_id,
      relative_path,
      metadata,
      overwrite,
      expected_target_sha256,
      expected_target_bundle_sha256,
      test_evidence,
      final_validation_evidence,
      user_accepted,
    }) => {
      try {
        if (!path.isAbsolute(draft_path)) {
          throw new Error(
            "ABSOLUTE_PATH_REQUIRED: job_promote_draft draft_path must be absolute"
          );
        }
        const draftMode =
          assertDraftVirtualPath(draft_path);
        if (isInternalJobId(metadata.id)) {
          throw new Error(
            `INTERNAL_JOB_ID_RESERVED: '${metadata.id}' is owned by CadGPT Internal Registry and cannot be promoted as a User Job.`
          );
        }
        await assertManagedLibraryExists(
          library_id
        );
        if (!user_accepted) {
          throw new Error(
            "Job promotion requires explicit user acceptance"
          );
        }

        const draft =
          await resolveAllowedPath(draft_path);
        const content = await fs.readFile(
          draft,
          "utf8"
        );
        const validation =
          await validateJobDraft(draft, content);
        if (!validation.valid) {
          throw new Error(
            `Job draft contract failed: ${validation.diagnostics.join(" ")}`
          );
        }
        const draftBundle =
          await inspectJobBundle(draft);
        if (!draftBundle.exists) {
          throw new Error(
            "Job draft package is missing."
          );
        }

        const normalizedRelative =
          safeRelativeJob(relative_path);
        const targetMode =
          jobExecutionModeForPath(
            normalizedRelative
          );
        if (draftMode !== targetMode) {
          throw new Error(
            `JOB_PROMOTION_MODE_MISMATCH: draft is ${draftMode} but managed target is ${targetMode}.`
          );
        }

        const expectedPermanent =
          managedJobPath(
            library_id,
            normalizedRelative
          );
        const libraryRoot = path.resolve(
          getJobLibrariesRoot(),
          library_id
        );
        const canonicalExpected =
          await resolveAbsoluteMutationPath(
            expectedPermanent,
            {
              allowedRoots: [libraryRoot],
              forCreate: true,
              label: "managed Job library",
            }
          );
        const permanent =
          await resolveAbsoluteMutationPath(
            target_path,
            {
              allowedRoots: [libraryRoot],
              forCreate: true,
              label: "managed Job library",
            }
          );
        if (
          path.relative(
            canonicalExpected,
            permanent
          ) !== ""
        ) {
          throw new Error(
            `TARGET_PATH_MISMATCH: target_path must exactly match managed Job target ${expectedPermanent}`
          );
        }

        const permanentAssetPaths =
          JOB_BUNDLE_ASSET_DIRS.map(
            (asset) =>
              path.join(
                path.dirname(permanent),
                asset
              )
          );
        const registryPath =
          getUserCapabilitiesPath();

        return await withFileMutationLocks(
          [
            permanent,
            ...permanentAssetPaths,
            registryPath,
          ],
          async () => {
            const targetBundle =
              await inspectJobBundle(permanent);
            if (
              targetBundle.exists &&
              !overwrite
            ) {
              throw new Error(
                `Managed Job package already exists; set overwrite=true for intentional replacement: ${toCadgptPath(permanent)}`
              );
            }
            if (
              targetBundle.exists &&
              overwrite
            ) {
              if (targetBundle.has_assets) {
                if (
                  !expected_target_bundle_sha256 ||
                  expected_target_bundle_sha256 !==
                    targetBundle.sha256
                ) {
                  throw new Error(
                    `RESOURCE_CONFLICT: managed Job bundle changed or expected_target_bundle_sha256 was not supplied; current bundle sha256=${targetBundle.sha256}`
                  );
                }
              } else {
                const previousPermanent =
                  await fs.readFile(
                    permanent,
                    "utf8"
                  );
                if (
                  !expected_target_sha256 ||
                  sha256(previousPermanent) !==
                    expected_target_sha256
                ) {
                  throw new Error(
                    "RESOURCE_CONFLICT: managed Job target changed or expected_target_sha256 was not supplied"
                  );
                }
              }
            }

            const registryBaseline =
              await fs
                .readFile(
                  registryPath,
                  "utf8"
                )
                .catch((error) => {
                  if (
                    (
                      error as NodeJS.ErrnoException
                    ).code === "ENOENT"
                  ) {
                    return null;
                  }
                  throw error;
                });
            const registry =
              await loadRegistry();
            for (const entry of registry.entries) {
              const id = String(
                entry.id || ""
              );
              const sameTarget =
                entry.kind === "job" &&
                String(
                  entry.library_id || ""
                ) === library_id &&
                String(
                  entry.relative_path || ""
                ).toLowerCase() ===
                  normalizedRelative.toLowerCase();
              if (
                id === metadata.id &&
                entry.kind !== "job"
              ) {
                throw new Error(
                  `Registry id belongs to a non-Job capability: ${metadata.id}`
                );
              }
              if (
                id !== metadata.id &&
                sameTarget
              ) {
                throw new Error(
                  `Managed Job path already belongs to another capability: ${id}`
                );
              }
            }

            const newEntry: Record<
              string,
              unknown
            > = {
              id: metadata.id,
              kind: "job",
              registry: "user",
              library_id,
              relative_path:
                normalizedRelative,
              title: metadata.title,
              class: metadata.class_name,
              subclass: metadata.subclass,
              tags: metadata.tags,
              summary: metadata.summary,
              status: metadata.status,
              risk: metadata.risk,
              execution_mode:
                validation.execution_mode,
              semantic_status: "curated",
              bundle_sha256:
                draftBundle.sha256,
              bundle_files:
                draftBundle.files,
              last_test_evidence:
                test_evidence,
              last_validation_evidence:
                final_validation_evidence,
            };
            const nextEntries =
              registry.entries.filter(
                (entry) =>
                  String(entry.id || "") !==
                  metadata.id
              );
            nextEntries.push(newEntry);
            nextEntries.sort((a, b) =>
              String(a.id || "").localeCompare(
                String(b.id || "")
              )
            );

            let mutation:
              | Awaited<
                  ReturnType<
                    typeof replaceJobBundleFromSource
                  >
                >
              | null = null;
            let installedBundleSha:
              | string
              | null = null;

            try {
              mutation =
                await replaceJobBundleFromSource(
                  draft,
                  permanent
                );
              const installed =
                await inspectJobBundle(
                  permanent
                );
              installedBundleSha =
                installed.sha256;

              const registryCurrent =
                await fs
                  .readFile(
                    registryPath,
                    "utf8"
                  )
                  .catch((error) => {
                    if (
                      (
                        error as NodeJS.ErrnoException
                      ).code === "ENOENT"
                    ) {
                      return null;
                    }
                    throw error;
                  });
              if (
                registryCurrent !==
                registryBaseline
              ) {
                throw new Error(
                  "RESOURCE_CONFLICT: User Registry changed during Job promotion"
                );
              }

              await atomicWrite(
                registryPath,
                `${JSON.stringify(
                  {
                    version:
                      registry.version,
                    entries:
                      nextEntries,
                  },
                  null,
                  2
                )}\n`
              );
              await mutation.finalize();

              return toolResult(
                "job_promote_draft",
                {
                  draft_path:
                    toCadgptPath(draft),
                  draft_bundle_sha256:
                    draftBundle.sha256,
                  managed_path:
                    toCadgptPath(
                      permanent
                    ),
                  managed_absolute_path:
                    permanent,
                  managed_bundle_sha256:
                    installed.sha256,
                  bundle_files:
                    installed.files,
                  asset_directories:
                    mutation.asset_directories,
                  library_id,
                  registry_id:
                    metadata.id,
                  execution_mode:
                    validation.execution_mode,
                  steps:
                    validation.steps,
                  registry_updated: true,
                  rollback_safe: true,
                  draft_retained: true,
                  test_evidence_recorded:
                    true,
                  final_validation_evidence_recorded:
                    true,
                }
              );
            } catch (registryError) {
              if (mutation) {
                try {
                  const current =
                    await inspectJobBundle(
                      permanent
                    );
                  if (
                    installedBundleSha &&
                    current.sha256 !==
                      installedBundleSha
                  ) {
                    throw new Error(
                      "RESOURCE_CONFLICT: managed Job bundle changed outside this promotion; refusing rollback overwrite"
                    );
                  }
                  await mutation.rollback();
                } catch (rollbackError) {
                  throw new Error(
                    `Registry/promotion update failed and rollback could not safely restore managed Job bundle. Cause: ${String(registryError)}; rollback: ${String(rollbackError)}`
                  );
                }
              }
              throw registryError;
            }
          }
        );
      } catch (error) {
        return toolError(
          "job_promote_draft",
          error
        );
      }
    }
  );
}
