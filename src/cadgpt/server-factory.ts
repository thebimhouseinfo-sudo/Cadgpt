import { z } from "zod";
import {
  McpServer,
  type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { assertSessionClaimed, revokeSessionAdmissions } from "./lib/admission.js";
import {
  activeExecutionForSession,
  activeWorkForSession,
  acquireToolLease,
  createWorkRegistration,
  releaseSessionWork,
  runWithToolLease,
  setWorkExpirationHandler,
  type ExecutionPath,
} from "./lib/work-registration.js";
import {
  toolAuthority,
  toolFamily,
  toolTargetId,
} from "./lib/tool-policy.js";
import { markFamilyLoaded, runtimeStateSnapshot } from "./lib/runtime-state.js";
import { registerAdmissionTool } from "./tools/admission.js";
import { registerCadGptControlTool } from "./tools/control.js";
import { registerWorkControlTools } from "./tools/work-control.js";
import {
  prepareCadLaunch,
  registerCadPrepareConfirmTool,
  clearCadPrepare,
} from "./tools/cad-launcher.js";
import { cleanupExecutionState } from "./runtime/execution-cleanup.js";

const loadedByServer = new WeakMap<McpServer, Set<string>>();
const sessionKeyByServer = new WeakMap<McpServer, string>();

setWorkExpirationHandler(async (executionId) => {
  await cleanupExecutionState(executionId);
});

function serverFamilies(server: McpServer): Set<string> {
  let loaded = loadedByServer.get(server);
  if (!loaded) {
    loaded = new Set<string>();
    loadedByServer.set(server, loaded);
  }
  return loaded;
}

function configureToolRegistration(server: McpServer, sessionKey: string): void {
  const original = server.registerTool.bind(server);

  server.registerTool = ((name: string, config: any, callback: any) => {
    const authority = toolAuthority(name);
    const baseInputSchema = (config.inputSchema || {}) as Record<string, unknown>;

    const authoritySchema =
      authority === "work"
        ? {
            execution_id: z
              .string()
              .min(1)
              .describe("execution_id returned by cadgpt_work_start"),
            authority_token: z
              .string()
              .min(1)
              .describe("opaque authority_token returned by cadgpt_work_start"),
          }
        : {};

    const nextConfig = {
      ...config,
      inputSchema: { ...baseInputSchema, ...authoritySchema },
      description:
        authority === "session"
          ? `${config.description || ""} Requires this MCP/chat session to have launched CadGPT.`.trim()
          : authority === "work"
            ? `${config.description || ""} Requires the current CadGPT work_handle.`.trim()
            : config.description,
    };

    if (authority === "control") {
      return original(name, nextConfig, callback);
    }

    const wrapped = async (args: Record<string, unknown> = {}, ...rest: unknown[]) => {
      if (authority === "session") {
        assertSessionClaimed(sessionKey);
        return callback(args, ...rest);
      }

      const executionId =
        typeof args.execution_id === "string" ? args.execution_id : undefined;
      const authorityToken =
        typeof args.authority_token === "string" ? args.authority_token : undefined;
      const family = toolFamily(name);
      const lease = acquireToolLease({
        tool: name,
        family,
        targetId: toolTargetId(args, family),
        executionId,
        authorityToken,
        sessionKey,
      });
      const toolArgs = { ...args };
      delete toolArgs.execution_id;
      delete toolArgs.authority_token;
      return runWithToolLease(lease, () => callback(toolArgs, ...rest));
    };

    return original(name, nextConfig, wrapped);
  }) as typeof server.registerTool;
}

async function loadDiscoveryFamily(server: McpServer): Promise<void> {
  const loaded = serverFamilies(server);
  if (loaded.has("discovery")) return;

  const [
    { registerLibraryDiscoveryTools },
    { registerJobDiscoveryTools },
    { registerSkillTools },
    { registerCapabilityRegistryTools },
  ] = await Promise.all([
    import("./tools/libraries.js"),
    import("./tools/jobs.js"),
    import("./tools/skills.js"),
    import("./tools/registry.js"),
  ]);

  registerLibraryDiscoveryTools(server);
  registerJobDiscoveryTools(server);
  registerSkillTools(server);
  registerCapabilityRegistryTools(server);

  loaded.add("discovery");
  markFamilyLoaded("discovery");
}

async function loadFileFamily(server: McpServer): Promise<void> {
  const loaded = serverFamilies(server);
  if (loaded.has("file")) return;

  await loadDiscoveryFamily(server);
  const [
    { registerFilesystemTools },
    { registerLispHarnessTools },
    { registerLispWorkspaceTools },
    { registerJobAuthoringTools },
    { registerUserAssetTools },
  ] = await Promise.all([
    import("./tools/filesystem.js"),
    import("./tools/lisp-harness.js"),
    import("./tools/lisp-workspace.js"),
    import("./tools/jobs.js"),
    import("./tools/user-assets.js"),
  ]);

  registerFilesystemTools(server);
  registerLispHarnessTools(server);
  registerLispWorkspaceTools(server);
  registerJobAuthoringTools(server);
  registerUserAssetTools(server);

  loaded.add("file");
  markFamilyLoaded("file");
}

async function loadCadFamily(server: McpServer): Promise<void> {
  const loaded = serverFamilies(server);
  if (loaded.has("cad")) {
    const { syncCadBusinessProxies } = await import("./tools/cad-proxy.js");
    syncCadBusinessProxies(server);
    return;
  }

  const [{ registerCadProxyTools }, { registerObservatorTools }] = await Promise.all([
    import("./tools/cad-proxy.js"),
    import("./tools/observator.js"),
  ]);
  registerCadProxyTools(server);
  registerObservatorTools(server);

  loaded.add("cad");
  markFamilyLoaded("cad");
}

async function loadCadMcpDevFamily(server: McpServer): Promise<void> {
  const loaded = serverFamilies(server);
  if (loaded.has("cad-mcp-dev")) return;
  const { registerCadMcpDevTools } = await import("./tools/cad-mcp-dev.js");
  registerCadMcpDevTools(server);
  loaded.add("cad-mcp-dev");
  markFamilyLoaded("cad-mcp-dev");
}

async function prepareFamilies(
  server: McpServer,
  executionPath: ExecutionPath,
  ownerId: string,
  executionId: string
): Promise<void> {
  if (executionPath === "file" || executionPath === "hybrid") await loadFileFamily(server);
  if (executionPath === "cad" || executionPath === "hybrid") {
    const [{ assertCadCandidateAccess }, { assertCadDevSourceAccess }] =
      await Promise.all([
        import("./runtime/cad-candidate.js"),
        import("./runtime/cad-dev-source-transaction.js"),
      ]);
    assertCadDevSourceAccess(executionId);
    assertCadCandidateAccess(executionId);
    await loadCadFamily(server);
  }
  if (ownerId === "cad-mcp-dev") await loadCadMcpDevFamily(server);
}

export function createMcpServer(sessionKey: string): McpServer {
  const server = new McpServer(
    { name: "cadgpt", version: "0.2.0" },
    {
      capabilities: { logging: {}, tools: { listChanged: true } },
      instructions: [
        "CadGPT entry routing — highest priority: bare CadGPT plugin/icon invocation (including a connector renamed CG) or bare @cadgpt or @cg must call cadgpt_admission and return its welcome_text verbatim when present. Do not replace it with prose such as 'activated'.",
        "Exact cg/ calls cadgpt_control(surface=commands); cg/list -> surface=list; cg/cl -> surface=cl; cg/cj -> surface=cj; cg/job -> surface=job; cg/rl -> register Lisp folder; cg/rj -> register Job folder; cg/il -> import Lisp; cg/el -> export Lisp; cg/ij -> import Job; cg/ej -> export Job; cg/mcp -> surface=mcp; cg/help -> surface=help; cg/stop -> surface=stop. cg/list reads tray cache only and never wakes full CAD MCP.",
        "CadGPT is explicit-launch, session-persistent.",
        "The user launches CadGPT once per ChatGPT/MCP session, either by selecting/calling the CadGPT plugin/icon (the connector may be renamed, e.g. CG) or by using literal @cadgpt or @cg.",
        "On a bare plugin/icon or bare @cadgpt or @cg launch, call cadgpt_admission once. If that launch also contains a real task, claim the session and continue directly instead of forcing the generic Welcome. After the session is claimed, do not call admission again on every turn.",
        "Never carry admission across another MCP/chat session, memory, unrelated files, paths, or AutoCAD state. Session disposal revokes the claim.",
        "Bare @cadgpt or bare CG/plugin launch makes the session READY, not WORK ACTIVE. Work becomes ACTIVE only after cadgpt_work_start.",
        "CadGPT session claim is routing state only; it is not an execution credential and has no per-turn token.",
        "Actual FILE/CAD work begins with cadgpt_work_start. The returned work_handle (execution_id + authority_token) is the only execution credential. Lisp/Job authoring, register, import and export are FILE work and do not require a drawing workspace.",
        "Reuse the active work_handle for later compatible requests in the same chat. Do not call cadgpt_work_start again unless there is no active work or the owner/execution path must change.",
        "Bare launch always renders the three-section CadGPT Welcome from tray state. If AutoCAD is offline, keep WORK IDLE and tell the user to open AutoCAD/a drawing then use cg/list.",
        "If the tray cache reports AutoCAD, list open drawings with no active-drawing marker and ask the user to choose exactly one drawing. The fake CLI is not live-updating; cg/list refreshes from the newest tray snapshot. PREPARE does not start CAD MCP, has no WorkRegistration, and cannot mutate CAD.",
        "After the user chooses one drawing number, call cadgpt_cad_confirm with the private confirmation_token and exactly one choice_key. Multi-drawing selection is forbidden. This transition replaces any prior work, starts full CAD MCP, verifies the selected drawing live, binds exactly one DrawingContext, and returns Workspace Ready.",
        "A workspace choice must identify exactly one listed drawing number (for example '1'). Do not treat bare 'xác nhận' as a drawing choice and never default to all drawings. Reuse the private confirmation_token internally; never ask the user to copy it.",
        "Hard invariant: 1 work = 1 drawing. For later compatible requests, reuse the active work_handle. cg/list may prepare a replacement workspace; selecting a new drawing releases the prior work before registering the new one.",
        "CadGPT has two execution paths: FILE and CAD. CAD MCP is activated only on actual CAD demand. User-managed Lisp/Job data lives in the real per-user AppData; repo-shipped Lisp/Job resources are system/read-only and are never copied into user AppData automatically.",
        "Registered Job behavior is extension-driven: .py is a direct Job and must be dispatched with job_run_direct without model planning; .md is a reasoning Job. For .md Jobs follow knowledge/jobs/REASONING_HARNESS.md: execute read-only observations first, then PLAN -> REVIEW -> REVISE if needed -> EXEC -> READBACK -> NEXT per reasoning/mutation stage. Re-plan/review later stages from the new drawing state instead of assuming an upfront whole-workflow plan remains valid. Internal review does not pause for user confirmation; defer uncertain items when safe, continue the workflow, and report unresolved items at the end.",
        "Never assume AutoCAD ActiveDocument is the target; use explicit drawing contexts.",
        "All file mutations require absolute canonical target paths and allowed-root verification. Relative/CWD-authorized mutation is forbidden.",
        "cad-mcp-dev is development-only and may mutate source only under the absolute runtimes/cad-mcp root.",
      ].join("\n"),
    }
  );

  sessionKeyByServer.set(server, sessionKey);
  configureToolRegistration(server, sessionKey);

  registerCadPrepareConfirmTool(server, {
    sessionKey,
    activateWorkspace: async (drawing) => {
      const previousExecution = activeExecutionForSession(sessionKey);
      if (previousExecution) {
        const cleanupId = releaseSessionWork(sessionKey);
        if (cleanupId) await cleanupExecutionState(cleanupId);
      }

      const work = createWorkRegistration({
        sessionKey,
        ownerType: "direct-cad",
        ownerId: "drawing-workspace",
        executionPath: "hybrid",
      });

      try {
        await prepareFamilies(server, "hybrid", "drawing-workspace", work.executionId);
        const { cadUpstream } = await import("./runtime/cad-upstream.js");
        await cadUpstream.activate();

        const { bindDrawingForExecution } = await import(
          "./session/drawing-binding.js"
        );
        const selector = drawing.full_name || drawing.name;
        const bound = await bindDrawingForExecution(work.executionId, selector);

        const { listRegisteredJobs } = await import("./tools/jobs.js");
        const jobs = await listRegisteredJobs();
        const jobLines = jobs.length
          ? jobs.map((job, index) => `  ${index + 1}. ${job.title} [${job.id}]`)
          : ["  — chưa có Job nào được đăng ký —"];

        const drawingLabel = bound.full_name || bound.name;
        const lines = [
          "```text",
          "CadGPT / CG — Workspace Ready",
          "────────────────────────────────",
          "",
          "Chúng ta bắt đầu làm việc trên bản vẽ:",
          drawingLabel,
          "",
          "────────────────────────────────",
          "",
          "Hãy nói với tôi yêu cầu của bạn",
          "hoặc chạy một Job bên dưới:",
          "",
          ...jobLines,
          "",
          "cg/job      xem toàn bộ Job đã đăng ký",
          "cg/         xem toàn bộ command",
          "────────────────────────────────",
          "```",
        ];

        return {
          text: lines.join("\n"),
          work_handle: {
            execution_id: work.executionId,
            authority_token: work.authorityToken,
            owner_type: work.ownerType,
            owner_id: work.ownerId,
            execution_path: work.executionPath,
            generation: work.generation,
          },
          drawing: bound,
        };
      } catch (error) {
        const cleanupId = releaseSessionWork(sessionKey);
        if (cleanupId) await cleanupExecutionState(cleanupId);
        throw error;
      }
    },
  });

  registerCadGptControlTool(server, {
    sessionKey,
    getCadState: async () => {
      try {
        const { cadUpstream } = await import("./runtime/cad-upstream.js");
        const state = cadUpstream.status();
        return state.phase.toUpperCase();
      } catch {
        return "ERROR";
      }
    },
    launchCadWorkspace: async () => {
      const launch = await prepareCadLaunch(sessionKey);
      return launch.welcome_text;
    },
    listJobs: async () => {
      const { listRegisteredJobs } = await import("./tools/jobs.js");
      const jobs = await listRegisteredJobs();
      const lines = [
        "```text",
        "CG / Registered Jobs",
        "────────────────────────────────",
        ...(jobs.length
          ? jobs.map((job, index) => `  ${index + 1}. ${job.title} [${job.id}]`)
          : ["  — chưa có Job nào được đăng ký —"]),
        "────────────────────────────────",
        "```",
      ];
      return lines.join("\n");
    },
    stopCurrentWork: async () => {
      const activeExecution = activeExecutionForSession(sessionKey);
      if (!activeExecution) {
        return { stopped: false, pending: false };
      }

      const cleanupExecutionId = releaseSessionWork(sessionKey);
      if (!cleanupExecutionId) {
        return { stopped: false, pending: true };
      }

      await cleanupExecutionState(cleanupExecutionId);
      return { stopped: true, pending: false };
    },
  });
  registerAdmissionTool(server, {
    sessionKey,
    onActive: async ({ bareLaunch }) => {
      await loadDiscoveryFamily(server);
      if (!bareLaunch) return;
      const launch = await prepareCadLaunch(sessionKey);
      return {
        launch_mode: launch.mode,
        welcome_text: launch.welcome_text,
        autocad_detected: launch.autocad_detected,
        ...(launch.confirmation_token
          ? { confirmation_token: launch.confirmation_token }
          : {}),
        ...(launch.drawings ? { drawings: launch.drawings } : {}),
      };
    },
  });
  registerWorkControlTools(server, {
    sessionKey,
    prepareFamilies: (executionPath, ownerId, executionId) =>
      prepareFamilies(server, executionPath, ownerId, executionId),
  });

  return server;
}


export async function disposeLogicalSessionState(
  sessionKey: string
): Promise<void> {
  const executionIdReadyForCleanup = releaseSessionWork(sessionKey);
  if (executionIdReadyForCleanup) {
    await cleanupExecutionState(executionIdReadyForCleanup);
  }
  revokeSessionAdmissions(sessionKey);
  clearCadPrepare(sessionKey);
}

export async function disposeMcpServerRuntime(
  server: McpServer,
  options: { preserveSessionState?: boolean } = {}
): Promise<void> {
  const sessionKey = sessionKeyByServer.get(server);
  if (!sessionKey) return;

  if (!options.preserveSessionState) {
    await disposeLogicalSessionState(sessionKey);
  }

  loadedByServer.delete(server);
  sessionKeyByServer.delete(server);
}
