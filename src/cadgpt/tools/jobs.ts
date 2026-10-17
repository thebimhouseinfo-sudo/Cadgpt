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
import { currentToolLease, activeWorkForSession } from "../lib/work-registration.js";
import {
  getJobLocalCompatStatus,
  markJobLocalCompatChecked,
} from "../lib/job-local-compat.js";
import { getBoundDrawingsForExecution } from "../session/drawing-binding.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";
import { withCadHostLock } from "../runtime/cad-scheduler.js";
import { hasVerifiedBoundSave, noteVerifiedBoundSave, invalidateBoundSave, notePotentialCadMutation, hasPotentialCadMutation, resetCadMutationTracking } from "../runtime/bound-save-ledger.js";
import { assertBuilderTarget } from "../runtime/builder-target.js";
import {
  drawingMetadataRootsForExecution,
  drawingMetadataWritableRootsForExecution,
  prepareDrawingMetadataLocation,
} from "../runtime/drawing-persistence.js";
import {
  activeJobRuntimeForExecution,
  jobStepsPath,
  cleanupJobRuntimeForExecution,
  cleanupJobRuntimeForSystemLease,
  detachJobRuntimeForSystemLease,
  prepareJobResultLocationForExecution,
  prepareJobRuntimeForExecution,
} from "../runtime/job-runtime.js";
import {
  acquireJobSystemLease,
  currentJobSystemLease,
  jobSystemLeaseForSession,
  releaseJobSystemLease,
} from "../runtime/system-lease.js";
import {
  releasePriorJobAuthorityForStart,
} from "../runtime/job-transition.js";
import { resolveRegisteredAssetPath } from "./user-assets.js";
import { ensureJobCapabilityIndex, getVerifiedJobCapability } from "../lib/job-capability-index.js";
import { resolveDrawingContext, activateDrawingContext } from "../session/drawing-binding.js";
import { cadUpstream } from "../runtime/cad-upstream.js";
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
  tags?: string[];
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
  action: string,
  jobId?: string
): Promise<void> {
  const status = await getJobLocalCompatStatus();
  const flagged = Boolean(jobId && status.blocked_job_ids.some(
    (id) => id.toLowerCase() === jobId.trim().toLowerCase()
  ));
  if (status.update_required || flagged) {
    console.warn("[CadGPT] JOB_CONTRACT_COMPAT_WARNING", {
      action,
      job_id: jobId ?? null,
      update_required: status.update_required,
      flagged_for_review: flagged,
      update_reason: status.update_reason,
      source_epoch: status.source_epoch,
      checked_epoch: status.checked_epoch,
    });
  }
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
        "Diagnostics only for legacy Job contract epochs. V5 does not require CONTRACT UPDATE or any compat scan to create, edit or RUN a Job.",
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
              ? "WARNING: Job behavior/contract changed. Notify the user and recommend a jobcreate CONTRACT UPDATE scan; allow the User Job to run or be tested with caution. Follow knowledge/jobs/LOCAL_COMPAT_UPDATE.md. Inspect each installed User Job, ask approval for changes to its business workflow, validate/test/promote affected Jobs, and report the results before marking this source contract checked."
              : status.pending_actions.length || status.blocked_job_ids.length
                ? "Compatibility scan finished but Custom Job reviews remain pending. Show pending_actions and flagged Job ids as warnings; execution and tests remain permitted. Do not claim repairs have passed."

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
        const compat = await getJobLocalCompatStatus();
        return toolResult("job_list", {
          jobs,
          count: jobs.length,
          rules: "knowledge/jobs/JOB_RULES.md",
          job_contract_compatibility: {
            update_required: compat.update_required,
            source_epoch: compat.source_epoch,
            checked_epoch: compat.checked_epoch,
            update_reason: compat.update_reason,
            pending_actions: compat.pending_actions,
            blocked_job_ids: compat.blocked_job_ids,
            ...(compat.update_required
              ? { instruction: "Warn the user about contract drift; allow execution/testing and recommend jobcreate CONTRACT UPDATE." }
              : {}),
          },
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
        "Load one official Internal Job or one concrete User Job. Always treat the CURRENT managed JOB.md returned here as the workflow source of truth, not older chat instructions or earlier run choices. Internal Jobs expose read-only metadata; User Jobs resolve to managed AppData source.",
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
        const exported = await ensureJobCapabilityIndex(entry.id).catch((error: unknown) => ({
          capabilities: [], unavailable: [{ file: "bundle", reason: error instanceof Error ? error.message : String(error) }],
        }));
        const compat = await getJobLocalCompatStatus();
        const blocked = compat.blocked_job_ids.some(
          (id) => id.toLowerCase() === entry.id.toLowerCase()
        );
        return toolResult("job_get", {
          id: entry.id,
          title: entry.title,
          library_id: entry.library_id,
          registry: "user",
          contract_compatibility: {
            update_required: compat.update_required,
            blocked,
            update_reason: compat.update_reason,
            ...(compat.update_required || blocked
              ? { instruction: "Warn the user this Custom Job needs compatibility review; allow execution/testing with its current JOB.md. Do not claim compatibility PASS." }
              : {}),
          },
          path: real,
          relative_path: relative,
          execution_mode: executionMode,
          content,
          source_sha256: sha256(content),
          bundle_sha256: bundle.sha256,
          bundle_files: bundle.files,
          capability_scan: { exported: exported.capabilities, dispatcher_ready: true, unavailable: exported.unavailable },
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

export async function executeDirectJobScript(
  script: string,
  args: string[],
  jobId: string,
  options: { fileOnly?: boolean } = {}
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
      script,
      { resetRuntime: true }
    );

  let jobResultRoot: string | null = null;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CADGPT_EXECUTION_ID: lease.workId,
    CADGPT_JOB_ID: jobId,
    CADGPT_JOB_ROOT:
      runtime.job_root,
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

  const prepare = async () => {
    // A FILE-only Work can access the verified Host drawing's metadata
    // without having any CAD authority or taking the CAD Host queue.
    const fileRoots = !drawing
      ? drawingMetadataRootsForExecution(lease.workId)
      : [];
    if (fileRoots.length > 1) {
      throw new Error("DIRECT_JOB_DRAWING_AMBIGUOUS: multiple metadata roots.");
    }
    const root = drawing
      ? String((await prepareDrawingMetadataLocation(lease.workId, drawing)).absolute_path)
      : fileRoots[0];
    if (root) {
      const resultLocation = await prepareJobResultLocationForExecution(lease.workId, root);
      jobResultRoot = String(resultLocation.absolute_path);
      env.CADGPT_JOB_RESULT_ROOT = jobResultRoot;
    }
  };
  const runScript = () => {
    // Legacy Direct Python can mutate AutoCAD through COM outside the CAD
    // proxy. Never reuse a Save witness across such an opaque invocation.
    if (!options.fileOnly) notePotentialCadMutation(lease.workId);
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
    // Legacy Direct Python Jobs may perform CAD COM operations themselves.
    // Preserve their existing serialization until explicitly classified by
    // the pre-existing Registry tag "file-only"; do not guess from script text.
    // Proven file-only scripts release the host queue before Python/Excel work.
    let result: { stdout: string; stderr: string };
    if (drawing && !options.fileOnly) {
      result = await withCadHostLock(drawing.host, async () => {
        await prepare();
        return runScript();
      });
    } else {
      if (drawing) {
        await withCadHostLock(drawing.host, prepare);
      } else {
        await prepare();
      }
      result = await runScript();
    }

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
    "job_capability_prepare",
    {
      title: "Prepare Verified Custom Job AutoLISP Capability",
      description:
        "Load a source-verified reusable Custom Job Lisp command without starting the parent Job. Execute it only through the normal cad__cad_run_lisp_command tool, which enforces bound-drawing and execution ownership.",
      inputSchema: {
        id: z.string().min(1),
        drawing_id: z.string().optional(),
      },
    },
    async ({ id, drawing_id }) => {
      try {
        const { capability, absolute_path } = await getVerifiedJobCapability(id);
        const loaded = await loadVerifiedLispForCurrentWork(
          absolute_path, drawing_id, [capability.command]
        );
        if (!loaded.loaded)
          throw new Error("JOB_CAPABILITY_LISP_LOAD_FAILED: " + capability.id +
            "; source=" + JSON.stringify(loaded.raw).slice(0, 2500));
        return toolResult("job_capability_prepare", {
          id: capability.id, loaded: true, command: capability.command,
          drawing_id: loaded.drawing_id,
          run_tool: "cad__cad_run_lisp_command",
          run_arguments: { name: capability.command, args: [], drawing_id: loaded.drawing_id },
        });
      } catch (error) {
        return toolError("job_capability_prepare", error);
      }
    }
  );

  server.registerTool(
    "job_local_compat_mark_checked",
    {
      title: "Mark Local Job Compatibility Scan Complete",
      description:
        "After jobcreate CONTRACT UPDATE has scanned all registered User Jobs and reported its findings to the user, mark the contract checked. Record pending_actions AND blocked_job_ids for any affected Job still requiring approval, tests or promotion; flagged Jobs remain executable/testable with warnings; no compatibility PASS is implied. Reject incorrect scan counts.",
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
        blocked_job_ids: z.array(z.string().min(1).max(160))
          .max(100)
          .describe("REQUIRED explicit review: [] only if every affected User Job was repaired/accepted; otherwise list registered IDs whose changes are untested/unpromoted. These Jobs remain flagged for review, not execution-blocked."),
      },
    },
    async ({
      scanned_user_jobs,
      report_summary,
      pending_actions,
      blocked_job_ids,
    }) => {
      try {
        const registryJobs = await loadJobs();
        if (scanned_user_jobs !== registryJobs.length) {
          throw new Error(
            `JOB_LOCAL_COMPAT_SCAN_COUNT_MISMATCH: received scanned_user_jobs=${scanned_user_jobs}; actual registered User Jobs=${registryJobs.length}. Read job_list/job_get and inspect all User Jobs before marking the local compatibility contract checked.`
          );
        }
        const canonicalIds = new Map(registryJobs.map(
          (job) => [job.id.toLowerCase(), job.id]
        ));
        const blocked = [...new Set(blocked_job_ids.map((id) => id.toLowerCase()))];
        if (blocked.some((id) => !canonicalIds.has(id))) {
          throw new Error(
            "JOB_LOCAL_COMPAT_BLOCKED_JOB_UNKNOWN: blocked_job_ids must refer only to registered User Jobs."
          );
        }
        await markJobLocalCompatChecked({
          scanned_user_jobs,
          report_summary,
          pending_actions,
          blocked_job_ids: blocked.map((id) => canonicalIds.get(id)!),
        });
        return toolResult(
          "job_local_compat_mark_checked",
          {
            ...(await getJobLocalCompatStatus()),
            scanned_user_jobs,
            pending_actions,
            blocked_job_ids: blocked.map((id) => canonicalIds.get(id)!),
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
        "V5 Operator/Builder: prepare a Job from a registered id or Builder-owned final managed JOB.md source_path (without registration/draft/promote). Return FRESH authoritative workflow, follow only declared steps, STOP/REPORT on error, and Save exact bound DWG immediately after the last actual CAD mutation. Legacy draft_path remains compatibility only; starting Job B releases stale Job A authority without deleting another Job's files.",
      inputSchema: {
        id: z.string().min(1).optional(),
        draft_path: z.string().min(1).optional(),
        source_path: z.string().min(1).optional()
          .describe("V5 direct Builder RUN of an existing final managed library JOB.md, without registry publication or draft."),
      },
    },
    async ({ id, draft_path, source_path }) => {
      try {
        if ([id, draft_path, source_path].filter(Boolean).length !== 1) {
          throw new Error(
            "JOB_RUNTIME_TARGET_REQUIRED: provide exactly one of id, source_path or legacy draft_path."
          );
        }

        let jobId: string;
        let jobFile: string;
        if (id) {
          await assertJobLocalCompatReady(
            "running a User Reasoning Job",
            id
          );
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
        } else if (source_path) {
          if (!path.isAbsolute(source_path) || path.win32.isAbsolute(source_path) !== (process.platform === "win32") ||
              path.basename(source_path).toLowerCase() !== "job.md") {
            throw new Error("V5_JOB_SOURCE_ABSOLUTE_JOB_MD_REQUIRED");
          }
          const sourceRoot = await fs.realpath(getJobLibrariesRoot());
          const realSource = await fs.realpath(source_path);
          if (!isPathInside(realSource, sourceRoot)) throw new Error("V5_JOB_SOURCE_OUTSIDE_MANAGED_LIBRARY");
          const actual = await fs.realpath(path.dirname(realSource));
          // Alias under the library is acceptable only when it maps to the same
          // canonical directory (Windows DOS aliases are normalized by realpath).
          if (!isPathInside(actual, sourceRoot)) throw new Error("V5_JOB_SOURCE_OWNER_ESCAPE");
          const currentWork = activeWorkForSession(currentToolLease().sessionKey);
          if (!currentWork || currentWork.executionId !== currentToolLease().workId ||
              currentWork.ownerType === "job" ||
              !["jobcreate", "job-authoring"].includes(currentWork.ownerId) &&
              !currentWork.capabilities.includes("job-authoring")) {
            throw new Error("V5_JOB_SOURCE_BUILDER_WORK_REQUIRED");
          }
          jobFile = realSource;
          assertBuilderTarget(currentToolLease().workId, path.dirname(realSource));
          jobId = "v5:" + path.relative(sourceRoot, path.dirname(jobFile)).replaceAll("\\", "/");
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

        // Read the authoritative current Job definition BEFORE transitioning
        // prior Job authority. A failed source read cannot stop another Job.
        const workflowSource = await fs.readFile(jobFile, "utf8");
        if (path.extname(jobFile).toLowerCase() !== ".md") {
          throw new Error(
            "JOB_RUNTIME_REASONING_SOURCE_REQUIRED: use job_run_direct for .py Jobs."
          );
        }
        // Mandatory lazy export scan on the next registered Custom Job use.
        // Scan problems never silently rewrite or prevent the original workflow.
        if (id) await ensureJobCapabilityIndex(id).catch((error: unknown) => {
          console.warn("[CadGPT] Custom Job capability scan unavailable:", error);
        });
        const workflowSha256 = sha256(workflowSource);
        const lease = currentToolLease();
        const activeRuntime = activeJobRuntimeForExecution(lease.workId);
        // Compare canonical filesystem identities; Windows may supply a
        // short 8.3 alias for the same Job directory.
        const currentRoot = await fs.realpath(path.dirname(jobFile));
        const sameActiveJob = Boolean(
          activeRuntime &&
          activeRuntime.job_id === jobId &&
          (process.platform === "win32"
            ? activeRuntime.job_root.toLowerCase() === currentRoot.toLowerCase()
            : activeRuntime.job_root === currentRoot)
        );
        // A repeat prepare for the SAME active Job is a continuation,
        // not a new Job start. Preserve its Job Steps and tool authority.
        const transition = sameActiveJob
          ? { resumed_same_active_job: true }
          : await releasePriorJobAuthorityForStart({
              executionId: lease.workId,
              sessionKey: lease.sessionKey,
            });
        const runtime =
          await prepareJobRuntimeForExecution(
            lease.workId,
            jobId,
            jobFile,
            { resetRuntime: false, isolatedRun: Boolean(id || source_path) }
          );
        if (!sameActiveJob) resetCadMutationTracking(lease.workId);
        // A FILE-only Job B can resume on a drawing root already verified
        // during Job A, with no second CAD bind or invented AppData path.
        // Only B's own result namespace becomes writable; other Job results
        // remain readable handoff inputs.
        const roots = drawingMetadataRootsForExecution(lease.workId);
        const resultLocation =
          roots.length === 1
            ? await prepareJobResultLocationForExecution(
                lease.workId,
                roots[0]
              )
            : null;
        return toolResult(
          "job_runtime_prepare",
          {
            job_id: runtime.job_id,
            job_name: runtime.job_name,
            job_root: runtime.job_root,
            job_steps: {
              path: jobStepsPath(runtime),
              instruction: "Use this Job-owned runtime/JOB_STEPS.md to record the actual steps for this invocation, with - [ ] pending, - [✓] verified PASS, - [✗] FAIL. Change only the CURRENT step after tool/readback evidence; never advance past an unchecked or failed required step. On run finish, error+finish, stop, or another Job replacing this Job, CadGPT resets progress marks to [ ] without deleting the file, raw, result, or metadata. On a later run, reconcile this checklist to the newly read JOB.md and observed raw/result state before proceeding.",
            },
            workflow: {
              source_path: jobFile,
              source_sha256: workflowSha256,
              content: workflowSource,
              instruction: "This is the current registered JOB.md, freshly read for this run. Follow its exact entry conditions and user choices. Do not invent business steps. After the final DWG mutation call job_runtime_save_now immediately; STOP/REPORT if Save fails. If no later CAD call occurs, job_runtime_finish reuses the verified Save and will not save twice. For a file-only Job, do not invent a CAD mutation or Save requirement.",
            },
            runtime_root:
              runtime.runtime_root,
            runtime_display_path:
              toCadgptPath(
                runtime.runtime_root
              ),
            reset:
              runtime.runtime_reset,
            runtime_created:
              runtime.runtime_created,
            runtime_existing_entries:
              runtime.runtime_existing_entries,
            recovery_pending:
              runtime.recovery_pending,
            prior_job_transition:
              transition,
            ...(resultLocation ? {
              drawing_result: resultLocation,
              drawing_metadata_read_only:
                !drawingMetadataWritableRootsForExecution(lease.workId)
                  .includes(roots[0]),
              note: "Job-owned result is now writable; other drawing-scoped Job results are read-only handoff inputs.",
            } : {}),
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
    "job_runtime_save_now",
    {
      title: "Save exact bound DWG after final CAD mutation",
      description: "Operator/Builder calls immediately after the last DWG mutation. Save is verified on the exact bound runtime document identity; subsequent CAD operations invalidate this proof, preventing false Job DONE.",
      inputSchema: {},
    },
    async () => {
      try {
        const lease = currentToolLease();
        if (!activeJobRuntimeForExecution(lease.workId)) {
          throw new Error("JOB_RUNTIME_NOT_ACTIVE");
        }
        const drawing = resolveDrawingContext();
        return await withCadHostLock(drawing.host, async () => {
          await activateDrawingContext(drawing);
          invalidateBoundSave(lease.workId);
          const response = await cadUpstream.callTool("acad_save_bound_document", {
            runtime_document_id: drawing.runtime_document_identity,
          }) as { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown };
          if (response.isError) throw new Error("JOB_BOUND_SAVE_UPSTREAM_ERROR");
          let saved: unknown = response.structuredContent;
          if (saved === undefined) {
            const rawText = (response.content as Array<{ type?: string; text?: string }> | undefined)
              ?.find(item => item.type === "text")?.text;
            if (rawText) {
              try { saved = JSON.parse(rawText); } catch { saved = undefined; }
            }
          }
          const evidence = saved as { saved?: unknown; runtime_document_id?: unknown } | undefined;
          if (!evidence || evidence.saved !== true ||
              evidence.runtime_document_id !== drawing.runtime_document_identity) {
            throw new Error("JOB_BOUND_SAVE_UNVERIFIED");
          }
          noteVerifiedBoundSave(lease.workId, drawing.runtime_document_identity);
          return toolResult("job_runtime_save_now", {
            saved: true,
            drawing_id: drawing.drawing_id,
            runtime_document_identity: drawing.runtime_document_identity,
            final_save_verified: true,
          });
        });
      } catch (error) {
        return toolError("job_runtime_save_now", error);
      }
    }
  );

  server.registerTool(
    "job_runtime_finish",
    {
      title: "Finish Job Runtime",
      description:
        "Finish the current Custom Job. Set outcome=done only after actual Job steps succeed. If the exact bound DWG was already verified saved after the last CAD change, do not save twice; otherwise run verified bound-DWG Save before DONE. Save failure is a real tool error and preserves runtime for repair. On failure use outcome=failed. This does not add a TEST or promotion stage.",
      inputSchema: {
        outcome: z.enum(["done", "failed"]).optional().default("failed"),
        dwg_changed: z.boolean().optional().default(true)
          .describe("Set false ONLY for a genuinely read-only/file-only Job; never skip Save after changing the DWG."),
      },
    },
    async ({ outcome, dwg_changed }) => {
      try {
        const lease = currentToolLease();
        const runtime = activeJobRuntimeForExecution(lease.workId);
        if (!runtime) throw new Error("JOB_RUNTIME_NOT_ACTIVE: no Custom Job to finish.");
        let autoSave: Record<string, unknown> = { attempted: false };
        if (outcome === "done" && !dwg_changed && hasPotentialCadMutation(lease.workId)) {
          throw new Error("JOB_READ_ONLY_CONFLICT: this execution issued a CAD mutation; verified Save is required.");
        }
        if (outcome === "done" && dwg_changed) {
          // Save before releasing the Work's drawing authority. Cad host FIFO
          // prevents overlap with other chats' CAD calls; no new manager.
          try {
            const drawing = resolveDrawingContext();
            if (hasVerifiedBoundSave(lease.workId, drawing.runtime_document_identity)) {
              autoSave = { attempted: false, saved: true, drawing: drawing.full_name, early_save_verified: true };
            } else {
            await withCadHostLock(drawing.host, async () => {
              await activateDrawingContext(drawing);
              const response = await cadUpstream.callTool("acad_save_bound_document", {
                runtime_document_id: drawing.runtime_document_identity,
              }) as { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown };
              if (response.isError) throw new Error("CAD MCP returned tool error during autosave.");
              let saved: unknown = response.structuredContent;
              if (saved === undefined) {
                const rawText = (response.content as Array<{ type?: string; text?: string }> | undefined)
                  ?.find((item) => item.type === "text")?.text;
                if (rawText) {
                  try { saved = JSON.parse(rawText); } catch { saved = undefined; }
                }
              }
              const evidence = saved as { saved?: unknown; runtime_document_id?: unknown } | undefined;
              if (!evidence || evidence.saved !== true ||
                  evidence.runtime_document_id !== drawing.runtime_document_identity) {
                throw new Error("AUTOSAVE_UNVERIFIED: Python CAD MCP did not confirm save.");
              }
              autoSave = { attempted: true, saved: true, drawing: drawing.full_name };
            });
            }
          } catch (error) {
            autoSave = { attempted: true, saved: false,
              error: error instanceof Error ? error.message : String(error) };
          }
        }
        if (outcome === "done" && dwg_changed && autoSave.saved !== true) {
          // Save failure is a real Job failure, not an ok tool payload.
          // Retain the prepared runtime and raw/result so Builder can repair
          // and safely complete after a verified save.
          throw new Error("JOB_SAVE_FAILED: " + String(autoSave.error ?? "bound DWG save not verified"));
        }
        const cleanup = await cleanupJobRuntimeForExecution(lease.workId);
        return toolResult("job_runtime_finish", { outcome, cleanup, autosave: autoSave,
          status: outcome === "done" ? (dwg_changed ? "JOB_DONE_SAVED" : "JOB_DONE_READ_ONLY") : "JOB_FAILED" });
      } catch (error) {
        return toolError(
          "job_runtime_finish",
          error
        );
      }
    }
  );


  server.registerTool(
    "job_system_acquire",
    {
      title: "Legacy Job SYSTEM Lease Acquire",
      description:
        "Legacy compatibility only. V5 Job helper runs from the execution-owned prepared Job runtime without manual SYSTEM lease acquire/release; new Jobs must not require this transition.",
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      try {
        const callLease = currentToolLease();
        const requestedId = id.trim();
        const existing = jobSystemLeaseForSession(
          requestedId,
          callLease.sessionKey
        );
        if (existing) {
          return toolResult("job_system_acquire", {
            acquired: true,
            reused: true,
            tool_id: existing.tool_id,
            job_id: existing.job_id,
            job_name: existing.job_name,
          });
        }

        const runtime = activeJobRuntimeForExecution(
          callLease.workId
        );
        if (!runtime) {
          throw new Error(
            "JOB_RUNTIME_NOT_PREPARED: call job_runtime_prepare before acquiring a Job SYSTEM lease."
          );
        }
        if (
          runtime.job_id.toLowerCase() !==
          requestedId.toLowerCase()
        ) {
          throw new Error(
            `SYSTEM_LEASE_JOB_MISMATCH: active Job '${runtime.job_id}' cannot acquire '${requestedId}'.`
          );
        }

        const registered = await loadJobs();
        const jobName =
          registered.find(
            (job) =>
              job.id.toLowerCase() ===
              runtime.job_id.toLowerCase()
          )?.title ?? runtime.job_name;

        const systemLease = acquireJobSystemLease({
          toolId: runtime.job_id,
          jobId: runtime.job_id,
          jobName,
          jobRoot: runtime.job_root,
          sessionKey: callLease.sessionKey,
          readableRoots:
            drawingMetadataRootsForExecution(
              callLease.workId
            ),
          writableRoots: [
            runtime.runtime_root,
            ...runtime.result_roots,
          ],
        });

        try {
          detachJobRuntimeForSystemLease(
            callLease.workId,
            systemLease.tool_id
          );
        } catch (error) {
          releaseJobSystemLease(
            systemLease.tool_id,
            callLease.sessionKey
          );
          throw error;
        }

        return toolResult("job_system_acquire", {
          acquired: true,
          reused: false,
          tool_id: systemLease.tool_id,
          job_id: systemLease.job_id,
          job_name: systemLease.job_name,
        });
      } catch (error) {
        return toolError(
          "job_system_acquire",
          error
        );
      }
    }
  );

  server.registerTool(
    "job_system_release",
    {
      title: "Legacy Job SYSTEM Lease Release",
      description:
        "Legacy compatibility only for already-detached jobs; V5 owned helper calls do not require a release step.",
      inputSchema: {},
    },
    async () => {
      const systemLease = currentJobSystemLease();
      if (!systemLease) {
        return toolError(
          "job_system_release",
          new Error(
            "NO_SYSTEM_LEASE: operation requires an active Job SYSTEM lease."
          )
        );
      }

      try {
        const cleanup =
          await cleanupJobRuntimeForSystemLease(
            systemLease.tool_id
          );
        return toolResult(
          "job_system_release",
          {
            released: true,
            tool_id: systemLease.tool_id,
            job_id: systemLease.job_id,
            job_name: systemLease.job_name,
            cleanup,
          }
        );
      } catch (error) {
        return toolError(
          "job_system_release",
          error
        );
      } finally {
        releaseJobSystemLease(
          systemLease.tool_id,
          systemLease.session_key
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
          const callLease =
            currentToolLease();
          await releasePriorJobAuthorityForStart({
            executionId:
              callLease.workId,
            sessionKey:
              callLease.sessionKey,
          });
          const executed = await executeInternalDirectJob(internal, args);
          return toolResult("job_run_direct", {
            id: internal.id,
            title: internal.title,
            ...executed,
          });
        }

        await assertJobLocalCompatReady(
          "running a User Job",
          id
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
        await ensureJobCapabilityIndex(entry.id).catch((error: unknown) => {
          console.warn("[CadGPT] Direct Job capability scan unavailable:", error);
        });
        const callLease =
          currentToolLease();
        await releasePriorJobAuthorityForStart({
          executionId:
            callLease.workId,
          sessionKey:
            callLease.sessionKey,
        });
        const executed = await executeDirectJobScript(script, args, entry.id, {
          fileOnly: entry.tags?.some((tag) => tag.toLowerCase() === "file-only") === true,
        });

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
        const callLease =
          currentToolLease();
        await releasePriorJobAuthorityForStart({
          executionId:
            callLease.workId,
          sessionKey:
            callLease.sessionKey,
        });
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
        "Legacy migration utility only. V5 Builder must author directly in the owned final Job folder using v5_source_create/v5_source_update; no Job draft, checkout or promotion is required to RUN. This tool is retained only for older package workflows.",
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
        "Legacy compatibility utility. V5 direct Builder editing uses v5_source_update in the exact owned managed Job folder; never require checkout before editing/running. This tool preserves old package workflows only.",
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
        "Legacy package migration utility only. V5 execution and in-place authoring never require this promotion; registered publication is separate and explicit when reusable capability discovery is requested.",
      inputSchema: {
        draft_path: z.string().min(1),
        registry_id: z.string().min(1).optional(),
        expected_draft_bundle_sha256: z.string().length(64).optional(),
        target_path: z
          .string()
          .min(1).optional()
          .describe(
            "Absolute target path that must exactly match library_id + relative_path"
          ),
        library_id: z
          .string()
          .regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i).optional(),
        relative_path: z.string().min(1).optional(),
        metadata: jobMetadataSchema.optional(),
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
      registry_id,
      expected_draft_bundle_sha256,
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
        // Existing managed Jobs can be promoted with compact arguments.
        // Resolve target/metadata only from the registered Job entry, never
        // from a guessed draft basename or free-form target path.
        if (registry_id) {
          const registered = (await loadJobs()).find(
            (entry) => entry.id.toLowerCase() === registry_id.trim().toLowerCase()
          );
          if (!registered) throw new Error("JOB_PROMOTION_REGISTERED_JOB_REQUIRED");
          if ((library_id && library_id !== registered.library_id) ||
              (relative_path && relative_path !== registered.relative_path)) {
            throw new Error("JOB_PROMOTION_REGISTERED_TARGET_MISMATCH");
          }
          library_id = registered.library_id;
          relative_path = registered.relative_path;
          const managed = managedJobPath(library_id, safeRelativeJob(relative_path));
          if (target_path && path.resolve(target_path) !== path.resolve(managed)) {
            throw new Error("JOB_PROMOTION_REGISTERED_TARGET_MISMATCH");
          }
          target_path = managed;
          if (metadata && metadata.id !== registered.id) {
            throw new Error("JOB_PROMOTION_REGISTERED_ID_MISMATCH");
          }
          metadata ??= jobMetadataSchema.parse({
            id: registered.id,
            title: registered.title,
            class_name: (registered as unknown as Record<string, unknown>).class ?? "workflow.user",
            subclass: (registered as unknown as Record<string, unknown>).subclass ?? "custom",
            summary: registered.summary ?? registered.title,
            tags: registered.tags ?? [],
            status: registered.status ?? "active",
            risk: registered.risk ?? "medium",
          });
          // Validate actual managed bundle against the prior Registry
          // fingerprint before using it as optimistic overwrite evidence.
          const oldBundle = await inspectJobBundle(target_path);
          const priorRegistry = (await loadRegistry()).entries.find(
            (entry) => entry.kind === "job" && entry.id === registered.id
          );
          if (!oldBundle.exists || !priorRegistry ||
              oldBundle.sha256 !== priorRegistry.bundle_sha256) {
            throw new Error("JOB_PROMOTION_MANAGED_BUNDLE_DRIFT: checkout again or reconcile Registry.");
          }
          if (oldBundle.has_assets) {
            expected_target_bundle_sha256 ??= oldBundle.sha256 ?? undefined;
          } else {
            expected_target_sha256 ??= sha256(await fs.readFile(target_path, "utf8"));
          }
          overwrite = true;
        }
        if (!target_path || !library_id || !relative_path || !metadata) {
          throw new Error("JOB_PROMOTION_TARGET_REQUIRED: supply full promotion fields or registry_id for an existing Job.");
        }
        // Keep narrowed values stable inside the asynchronous mutation callback.
        const promotionMetadata = metadata;
        if (!path.isAbsolute(draft_path)) {
          throw new Error(
            "ABSOLUTE_PATH_REQUIRED: job_promote_draft draft_path must be absolute"
          );
        }
        const draftMode =
          assertDraftVirtualPath(draft_path);
        if (isInternalJobId(promotionMetadata.id)) {
          throw new Error(
            `INTERNAL_JOB_ID_RESERVED: '${promotionMetadata.id}' is owned by CadGPT Internal Registry and cannot be promoted as a User Job.`
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
        if (expected_draft_bundle_sha256 &&
            draftBundle.sha256 !== expected_draft_bundle_sha256) {
          throw new Error("RESOURCE_CONFLICT: validated draft bundle SHA-256 no longer matches.");
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
                id === promotionMetadata.id &&
                entry.kind !== "job"
              ) {
                throw new Error(
                  `Registry id belongs to a non-Job capability: ${promotionMetadata.id}`
                );
              }
              if (
                id !== promotionMetadata.id &&
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
              id: promotionMetadata.id,
              kind: "job",
              registry: "user",
              library_id,
              relative_path:
                normalizedRelative,
              title: promotionMetadata.title,
              class: promotionMetadata.class_name,
              subclass: promotionMetadata.subclass,
              tags: promotionMetadata.tags,
              summary: promotionMetadata.summary,
              status: promotionMetadata.status,
              risk: promotionMetadata.risk,
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
                  promotionMetadata.id
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
                    promotionMetadata.id,
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
