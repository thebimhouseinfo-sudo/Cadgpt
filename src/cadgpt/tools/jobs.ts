import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getAppDataPath,
  getJobDraftRoot,
  getJobLibrariesRoot,
  getUserCapabilitiesPath,
  getUserLibrariesManifestPath,
} from "../lib/appdata.js";
import { getRepoRoot, isPathInside, resolveAbsoluteMutationPath, resolveAllowedPath, toCadgptPath } from "../lib/path-security.js";
import { currentToolLease } from "../lib/work-registration.js";
import { getBoundDrawingsForExecution } from "../session/drawing-binding.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";
import { withCadHostLock } from "../runtime/cad-scheduler.js";
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
  workflow_bypass?: boolean;
  workflow_bypass_record?: WorkflowBypassRecord;
}

interface UserRegistry {
  version: number;
  entries: Array<Record<string, unknown>>;
}

interface WorkflowBypassRecord {
  bypass_id: string;
  status: "ACTIVE" | "CLEARED";
  job_id: string;
  workflow_gate: string;
  reason: string;
  observed_behavior: string;
  expected_behavior: string;
  error_evidence: string;
  workaround?: string;
  approved_at: string;
  approved_by: "human";
  draft_path: string;
  cleared_at?: string;
  workflow_fix_evidence?: string;
  final_validation_evidence?: string;
}

const WORKFLOW_BYPASS_SIDECAR = ".cadgpt-workflow-bypass.json";

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

function workflowBypassSidecarPath(jobFilePath: string): string {
  return path.join(path.dirname(jobFilePath), WORKFLOW_BYPASS_SIDECAR);
}

async function readWorkflowBypassState(
  jobFilePath: string
): Promise<WorkflowBypassRecord | null> {
  const sidecar = workflowBypassSidecarPath(jobFilePath);
  const parsed = await readJson<Partial<WorkflowBypassRecord> | null>(
    sidecar,
    null
  );
  if (
    !parsed ||
    !parsed.bypass_id ||
    !["ACTIVE", "CLEARED"].includes(String(parsed.status))
  ) {
    return null;
  }
  return parsed as WorkflowBypassRecord;
}

async function readWorkflowBypass(
  jobFilePath: string
): Promise<WorkflowBypassRecord | null> {
  const state = await readWorkflowBypassState(jobFilePath);
  return state?.status === "ACTIVE" ? state : null;
}

async function appendWorkflowBypassLog(
  event: Record<string, unknown>
): Promise<string> {
  const logPath = getAppDataPath("logs", "workflow-bypass.jsonl");
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  return withFileMutationLocks([logPath], async () => {
    await fs.appendFile(
      logPath,
      `${JSON.stringify(event)}\n`,
      "utf8"
    );
    return logPath;
  });
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
            ...(job.workflow_bypass
              ? {
                  workflow_bypass: true,
                  workflow_bypass_status: "ACTIVE",
                  workflow_bypass_id:
                    job.workflow_bypass_record?.bypass_id ?? null,
                }
              : {}),
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
        return toolResult("job_get", {
          id: entry.id,
          title: entry.title,
          library_id: entry.library_id,
          registry: "user",
          path: real,
          relative_path: relative,
          execution_mode: executionMode,
          content,
          ...(executionMode === "reasoning"
            ? { harness: "knowledge/jobs/REASONING_HARNESS.md" }
            : {}),
          ...(entry.workflow_bypass
            ? {
                workflow_bypass: true,
                workflow_bypass_status: "ACTIVE",
                workflow_bypass_record:
                  entry.workflow_bypass_record ?? null,
              }
            : { workflow_bypass: false }),
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CADGPT_EXECUTION_ID: lease.workId,
    CADGPT_JOB_ID: jobId,
    CADGPT_REPO_ROOT: getRepoRoot(),
    CADGPT_BUNDLED_LISP_ROOT: getBundledLispLibrariesRoot(),
    ...(drawing
      ? {
          CADGPT_DRAWING_ID: drawing.drawing_id,
          CADGPT_DRAWING_NAME: drawing.name,
          CADGPT_DRAWING_PATH: drawing.full_name || drawing.name,
          CADGPT_DRAWING_HOST: drawing.host,
          CADGPT_DRAWING_RUNTIME_IDENTITY: drawing.runtime_document_identity,
        }
      : {}),
  };

  const execute = () =>
    execFileAsync(python, [script, ...args], {
      cwd: path.dirname(script),
      env,
      windowsHide: true,
      timeout: 5 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });
  const result = drawing
    ? await withCadHostLock(drawing.host, execute)
    : await execute();

  return {
    script,
    execution_mode: "direct",
    exit_code: 0,
    stdout: result.stdout,
    stderr: result.stderr,
    drawing: drawing
      ? { drawing_id: drawing.drawing_id, name: drawing.name, full_name: drawing.full_name }
      : null,
  };
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
      description: "Copy one registered managed Job (.md reasoning or .py direct) into an explicit absolute draft path under the Job draft root. Existing drafts require hash-confirmed overwrite.",
      inputSchema: {
        registry_id: z.string().min(1),
        draft_path: z.string().min(1).describe("Absolute .md or .py path under the approved Job draft root; extension must match the registered Job"),
        overwrite_existing: z.boolean().optional().default(false),
        expected_sha256: z.string().length(64).optional(),
      },
    },
    async ({ registry_id, draft_path, overwrite_existing, expected_sha256 }) => {
      try {
        const jobs = await loadJobs();
        const entry = jobs.find((job) => job.id.toLowerCase() === registry_id.trim().toLowerCase());
        if (!entry) throw new Error(`Managed Job not found in User Registry: ${registry_id}`);
        const source = await resolveAllowedPath(resolveManagedJob(entry));
        const content = await fs.readFile(source, "utf8");
        const draft = await resolveAbsoluteMutationPath(draft_path, {
          allowedRoots: [getJobDraftRoot()],
          forCreate: true,
          label: "Job draft",
        });
        const draftMode = assertDraftVirtualPath(draft);
        const sourceMode = jobExecutionModeForPath(source);
        if (draftMode !== sourceMode) {
          throw new Error(
            `JOB_DRAFT_MODE_MISMATCH: registered Job is ${sourceMode} but draft path is ${draftMode}.`
          );
        }

        const bypassSidecar = workflowBypassSidecarPath(draft);
        return await withFileMutationLocks(
          [draft, bypassSidecar],
          async () => {
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
          if (
            entry.workflow_bypass &&
            entry.workflow_bypass_record?.status === "ACTIVE"
          ) {
            await atomicWrite(
              bypassSidecar,
              `${JSON.stringify(entry.workflow_bypass_record, null, 2)}\n`
            );
          } else {
            await fs.rm(bypassSidecar, { force: true });
          }
          const validation = await validateJobDraft(draft, content);
          return toolResult("job_checkout", {
            registry_id: entry.id,
            library_id: entry.library_id,
            execution_mode: validation.execution_mode,
            source_path: toCadgptPath(source),
            draft_path: draft,
            draft_display_path: toCadgptPath(draft),
            source_contract_valid: validation.valid,
            diagnostics: validation.diagnostics,
            workflow_bypass: Boolean(entry.workflow_bypass),
            workflow_bypass_record:
              entry.workflow_bypass_record ?? null,
            managed_source_unchanged: true,
          });
          }
        );
      } catch (error) {
        return toolError("job_checkout", error);
      }
    }
  );

  server.registerTool(
    "job_human_bypass_record",
    {
      title: "Record Human Workflow Bypass",
      description:
        "Record an explicit human-approved bypass of one Job workflow/harness gate. This never bypasses runtime security, sandbox/path authority, destructive-scope approval, drawing binding, tool authorization, or source syntax validity. The draft is flagged ACTIVE and the incident is appended to the managed workflow-bypass error log.",
      inputSchema: {
        draft_path: z.string().min(1),
        job_id: z.string().min(1).max(160),
        workflow_gate: z.string().min(1).max(120),
        reason: z.string().min(1).max(2000),
        observed_behavior: z.string().min(1).max(4000),
        expected_behavior: z.string().min(1).max(4000),
        error_evidence: z.string().min(1).max(8000),
        workaround: z.string().max(4000).optional(),
        human_approved: z.literal(true),
      },
    },
    async ({
      draft_path,
      job_id,
      workflow_gate,
      reason,
      observed_behavior,
      expected_behavior,
      error_evidence,
      workaround,
      human_approved,
    }) => {
      try {
        if (!human_approved) {
          throw new Error(
            "HUMAN_BYPASS_REQUIRES_EXPLICIT_APPROVAL"
          );
        }
        assertDraftVirtualPath(draft_path);
        const draft = await resolveAllowedPath(draft_path);
        const stat = await fs.stat(draft);
        if (!stat.isFile()) {
          throw new Error("Human bypass target must be a Job draft file.");
        }

        const bypass: WorkflowBypassRecord = {
          bypass_id: `wbp_${Date.now()}_${randomUUID().slice(0, 8)}`,
          status: "ACTIVE",
          job_id,
          workflow_gate,
          reason,
          observed_behavior,
          expected_behavior,
          error_evidence,
          ...(workaround ? { workaround } : {}),
          approved_at: new Date().toISOString(),
          approved_by: "human",
          draft_path: toCadgptPath(draft),
        };
        const sidecar = workflowBypassSidecarPath(draft);
        await withFileMutationLocks([sidecar], async () => {
          await atomicWrite(
            sidecar,
            `${JSON.stringify(bypass, null, 2)}\n`
          );
        });
        const logPath = await appendWorkflowBypassLog({
          event: "HUMAN_BYPASS_ACTIVATED",
          ...bypass,
        });

        return toolResult("job_human_bypass_record", {
          workflow_bypass: true,
          workflow_bypass_status: "ACTIVE",
          bypass,
          sidecar_path: toCadgptPath(sidecar),
          error_log_path: toCadgptPath(logPath),
          note:
            "Continue only around the explicitly recorded workflow gate. Hard runtime/safety/tool authority boundaries remain enforced.",
        });
      } catch (error) {
        return toolError("job_human_bypass_record", error);
      }
    }
  );

  server.registerTool(
    "job_human_bypass_clear",
    {
      title: "Clear Human Workflow Bypass",
      description:
        "Clear an ACTIVE Job workflow-bypass flag after the underlying workflow has been corrected and the Job has been revalidated without relying on the bypass. The clear event is appended to the managed workflow-bypass error log.",
      inputSchema: {
        draft_path: z.string().min(1),
        bypass_id: z.string().min(1),
        workflow_fix_evidence: z.string().min(1).max(6000),
        final_validation_evidence: z.string().min(1).max(6000),
        human_approved: z.literal(true),
      },
    },
    async ({
      draft_path,
      bypass_id,
      workflow_fix_evidence,
      final_validation_evidence,
      human_approved,
    }) => {
      try {
        if (!human_approved) {
          throw new Error(
            "HUMAN_BYPASS_CLEAR_REQUIRES_EXPLICIT_APPROVAL"
          );
        }
        assertDraftVirtualPath(draft_path);
        const draft = await resolveAllowedPath(draft_path);
        const active = await readWorkflowBypass(draft);
        if (!active) {
          throw new Error("NO_ACTIVE_WORKFLOW_BYPASS");
        }
        if (active.bypass_id !== bypass_id) {
          throw new Error(
            "WORKFLOW_BYPASS_ID_MISMATCH: active bypass changed."
          );
        }

        const sidecar = workflowBypassSidecarPath(draft);
        const clearedAt = new Date().toISOString();
        const cleared: WorkflowBypassRecord = {
          ...active,
          status: "CLEARED",
          cleared_at: clearedAt,
          workflow_fix_evidence,
          final_validation_evidence,
        };
        await withFileMutationLocks([sidecar], async () => {
          await atomicWrite(
            sidecar,
            `${JSON.stringify(cleared, null, 2)}\n`
          );
        });
        const logPath = await appendWorkflowBypassLog({
          event: "HUMAN_BYPASS_CLEARED",
          ...cleared,
        });

        return toolResult("job_human_bypass_clear", {
          workflow_bypass: false,
          workflow_bypass_status: "CLEARED",
          bypass_id,
          sidecar_path: toCadgptPath(sidecar),
          error_log_path: toCadgptPath(logPath),
          note:
            "Re-promote the refined Job to remove the persistent Registry bypass flag. The CLEARED tombstone remains with the draft as proof of intentional resolution.",
        });
      } catch (error) {
        return toolError("job_human_bypass_clear", error);
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
        const workflowBypassState =
          await readWorkflowBypassState(target);
        const workflowBypass =
          workflowBypassState?.status === "ACTIVE"
            ? workflowBypassState
            : null;
        return toolResult(
          "job_draft_validate",
          {
            path: toCadgptPath(target),
            sha256: sha256(content),
            ...validation,
            workflow_bypass: Boolean(workflowBypass),
            workflow_bypass_status:
              workflowBypassState?.status ?? "NONE",
            workflow_bypass_record: workflowBypassState,
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
        const draftMode = assertDraftVirtualPath(draft_path);
        if (isInternalJobId(metadata.id)) {
          throw new Error(
            `INTERNAL_JOB_ID_RESERVED: '${metadata.id}' is owned by CadGPT Internal Registry and cannot be promoted as a User Job.`
          );
        }
        await assertManagedLibraryExists(library_id);
        if (!user_accepted) throw new Error("Job promotion requires explicit user acceptance");

        const draft = await resolveAllowedPath(draft_path);
        const content = await fs.readFile(draft, "utf8");
        const validation = await validateJobDraft(draft, content);
        const workflowBypassState =
          await readWorkflowBypassState(draft);
        const workflowBypass =
          workflowBypassState?.status === "ACTIVE"
            ? workflowBypassState
            : null;
        if (!validation.valid) {
          throw new Error(`Job draft contract failed: ${validation.diagnostics.join(" ")}`);
        }

        const normalizedRelative = safeRelativeJob(relative_path);
        const targetMode = jobExecutionModeForPath(normalizedRelative);
        if (draftMode !== targetMode) {
          throw new Error(
            `JOB_PROMOTION_MODE_MISMATCH: draft is ${draftMode} but managed target is ${targetMode}.`
          );
        }
        const expectedPermanent = managedJobPath(
          library_id,
          normalizedRelative
        );
        const libraryRoot = path.resolve(getJobLibrariesRoot(), library_id);
        const canonicalExpected = await resolveAbsoluteMutationPath(
          expectedPermanent,
          {
            allowedRoots: [libraryRoot],
            forCreate: true,
            label: "managed Job library",
          }
        );
        const permanent = await resolveAbsoluteMutationPath(target_path, {
          allowedRoots: [libraryRoot],
          forCreate: true,
          label: "managed Job library",
        });
        if (path.relative(canonicalExpected, permanent) !== "") {
          throw new Error(
            `TARGET_PATH_MISMATCH: target_path must exactly match managed Job target ${expectedPermanent}`
          );
        }
        return await withFileMutationLocks(
          [permanent, getUserCapabilitiesPath()],
          async () => {
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

        const registryPath = getUserCapabilitiesPath();
        const registryBaseline = await fs.readFile(registryPath, "utf8").catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        });
        const registry = await loadRegistry();
        const previousJobEntry = registry.entries.find(
          (entry) =>
            entry.kind === "job" &&
            String(entry.id || "") === metadata.id
        );
        if (
          previousJobEntry?.workflow_bypass === true &&
          !workflowBypass
        ) {
          const previousBypass =
            previousJobEntry.workflow_bypass_record as
              | Partial<WorkflowBypassRecord>
              | undefined;
          if (
            workflowBypassState?.status !== "CLEARED" ||
            !previousBypass?.bypass_id ||
            workflowBypassState.bypass_id !==
              previousBypass.bypass_id ||
            !workflowBypassState.workflow_fix_evidence ||
            !workflowBypassState.final_validation_evidence
          ) {
            throw new Error(
              "WORKFLOW_BYPASS_CLEAR_REQUIRED: this registered Job is flagged ACTIVE. Use job_human_bypass_clear after normal revalidation before re-promotion."
            );
          }
        }
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
          execution_mode: validation.execution_mode,
          semantic_status: "curated",
          last_test_evidence: test_evidence,
          last_validation_evidence: final_validation_evidence,
          ...(workflowBypass
            ? {
                workflow_bypass: true,
                workflow_bypass_status: "ACTIVE",
                workflow_bypass_record: workflowBypass,
              }
            : {}),
        };
        const nextEntries = registry.entries.filter((entry) => String(entry.id || "") !== metadata.id);
        nextEntries.push(newEntry);
        nextEntries.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

        await fs.mkdir(path.dirname(permanent), { recursive: true });
        await atomicWrite(permanent, content);
        try {
          const registryCurrent = await fs.readFile(registryPath, "utf8").catch((error) => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          });
          if (registryCurrent !== registryBaseline) {
            throw new Error("RESOURCE_CONFLICT: User Registry changed during Job promotion");
          }
          await atomicWrite(registryPath, `${JSON.stringify({ version: registry.version, entries: nextEntries }, null, 2)}\n`);
        } catch (registryError) {
          try {
            const currentPermanent = await fs.readFile(permanent, "utf8").catch((error) => {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
              throw error;
            });
            if (currentPermanent !== content) {
              throw new Error(
                "RESOURCE_CONFLICT: managed Job source changed outside this promotion; refusing rollback overwrite"
              );
            }
            if (targetExists && previousPermanent !== null) {
              await atomicWrite(permanent, previousPermanent);
            } else {
              await fs.rm(permanent, { force: true });
            }
          } catch (rollbackError) {
            throw new Error(
              `Registry update failed and rollback could not safely restore managed Job source. Registry: ${String(registryError)}; rollback: ${String(rollbackError)}`
            );
          }
          throw registryError;
        }

        return toolResult("job_promote_draft", {
          draft_path: toCadgptPath(draft),
          managed_path: toCadgptPath(permanent),
          managed_absolute_path: permanent,
          library_id,
          registry_id: metadata.id,
          execution_mode: validation.execution_mode,
          steps: validation.steps,
          registry_updated: true,
          rollback_safe: true,
          draft_retained: true,
          test_evidence_recorded: true,
          final_validation_evidence_recorded: true,
          workflow_bypass: Boolean(workflowBypass),
          workflow_bypass_status:
            workflowBypassState?.status ?? "NONE",
            });
          }
        );
      } catch (error) {
        return toolError("job_promote_draft", error);
      }
    }
  );
}
