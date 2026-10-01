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
  enableWorkCapability,
  releaseSessionWork,
  runWithToolLease,
  setWorkExpirationHandler,
  validateWorkHandle,
  isDevelopmentBuild,
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
import { registerLibraryDiscoveryTools, registerLibraryMutationTools } from "./tools/libraries.js";
import { registerJobDiscoveryTools, registerJobAuthoringTools } from "./tools/jobs.js";
import { registerSkillTools } from "./tools/skills.js";
import { registerCapabilityRegistryTools } from "./tools/registry.js";
import { registerFilesystemTools } from "./tools/filesystem.js";
import { registerLispHarnessTools } from "./tools/lisp-harness.js";
import { registerLispWorkspaceTools } from "./tools/lisp-workspace.js";
import { registerUserAssetTools } from "./tools/user-assets.js";
import { registerCadProxyTools } from "./tools/cad-proxy.js";
import { registerObservatorTools } from "./tools/observator.js";
import { registerCadMcpDevTools } from "./tools/cad-mcp-dev.js";
import {
  prepareCadLaunch,
  registerCadPrepareConfirmTool,
  clearCadPrepare,
} from "./tools/cad-launcher.js";
import { cleanupExecutionState } from "./runtime/execution-cleanup.js";

const loadedByServer = new WeakMap<McpServer, Set<string>>();
const registeredSurfaceByServer = new WeakMap<McpServer, Set<string>>();
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
              .describe("execution_id from work_handle returned by cadgpt_cad_confirm (drawing workspace) or cadgpt_work_start (file/job work)"),
            authority_token: z
              .string()
              .min(1)
              .describe("authority_token from work_handle returned by cadgpt_cad_confirm (drawing workspace) or cadgpt_work_start (file/job work)"),
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

function registeredSurface(server: McpServer): Set<string> {
  let registered = registeredSurfaceByServer.get(server);
  if (!registered) {
    registered = new Set<string>();
    registeredSurfaceByServer.set(server, registered);
  }
  return registered;
}

function registerStableProductionSurface(server: McpServer): void {
  const registered = registeredSurface(server);
  if (registered.has("production")) return;

  // Register the complete production MCP surface before ChatGPT performs
  // its first tools/list import. Authority wrappers still prevent use before
  // admission/work, and CAD upstream remains sleeping until a CAD tool call.
  registerLibraryDiscoveryTools(server);
  registerLibraryMutationTools(server);
  registerJobDiscoveryTools(server);
  registerJobAuthoringTools(server);
  registerSkillTools(server);
  registerCapabilityRegistryTools(server);
  registerFilesystemTools(server);
  registerLispHarnessTools(server);
  registerLispWorkspaceTools(server);
  registerUserAssetTools(server);
  registerCadProxyTools(server);
  registerObservatorTools(server);

  if (isDevelopmentBuild()) {
    registerCadMcpDevTools(server);
    registered.add("cad-mcp-dev");
  }

  registered.add("production");
  registered.add("discovery");
  registered.add("file");
  registered.add("cad");
}

async function loadDiscoveryFamily(server: McpServer): Promise<void> {
  const loaded = serverFamilies(server);
  if (loaded.has("discovery")) return;
  if (!registeredSurface(server).has("discovery")) {
    throw new Error("TOOL_SURFACE_NOT_READY: discovery tools were not registered at MCP initialization.");
  }
  loaded.add("discovery");
  markFamilyLoaded("discovery");
}

async function loadFileFamily(server: McpServer): Promise<void> {
  const loaded = serverFamilies(server);
  if (loaded.has("file")) return;
  if (!registeredSurface(server).has("file")) {
    throw new Error("TOOL_SURFACE_NOT_READY: file tools were not registered at MCP initialization.");
  }
  await loadDiscoveryFamily(server);
  loaded.add("file");
  markFamilyLoaded("file");
}

async function loadCadFamily(server: McpServer): Promise<void> {
  const loaded = serverFamilies(server);
  if (!registeredSurface(server).has("cad")) {
    throw new Error("TOOL_SURFACE_NOT_READY: CAD tools were not registered at MCP initialization.");
  }
  // Named CAD proxies are an immutable snapshot of the manifest at MCP
  // initialization. Do not mutate tools/list after ChatGPT imported it.
  // Newly-developed/changed manifest tools in this conversation are exercised
  // through cad_invoke_manifest_tool and become named proxies after restart.
  if (loaded.has("cad")) return;
  loaded.add("cad");
  markFamilyLoaded("cad");
}

async function loadCadMcpDevFamily(server: McpServer): Promise<void> {
  const loaded = serverFamilies(server);
  if (loaded.has("cad-mcp-dev")) return;
  if (!isDevelopmentBuild() || !registeredSurface(server).has("cad-mcp-dev")) {
    throw new Error("DEVELOPMENT_ONLY: cad-mcp-dev is unavailable in production builds.");
  }
  loaded.add("cad-mcp-dev");
  markFamilyLoaded("cad-mcp-dev");
}

async function prepareFamilies(
  server: McpServer,
  executionPath: ExecutionPath,
  ownerId: string,
  executionId: string
): Promise<Record<string, unknown>> {
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

  const snapshot: Record<string, unknown> = {
    ...runtimeStateSnapshot(),
    execution_path: executionPath,
  };
  if (executionPath === "cad" || executionPath === "hybrid") {
    const { cadProxySurfaceSnapshot } = await import("./tools/cad-proxy.js");
    const cad = cadProxySurfaceSnapshot(server);
    snapshot.cad_proxy_tool_count = cad.count;
    snapshot.cad_proxy_tools = cad.tools;
  }
  return snapshot;
}

export async function rehydrateServerForLogicalSession(
  server: McpServer,
  sessionKey: string
): Promise<void> {
  const work = activeWorkForSession(sessionKey);
  if (work) {
    await prepareFamilies(
      server,
      work.executionPath,
      work.ownerId,
      work.executionId
    );
    if (work.capabilities.includes("cad-mcp-dev")) {
      await loadCadMcpDevFamily(server);
    }
    return;
  }

  try {
    assertSessionClaimed(sessionKey);
    await loadDiscoveryFamily(server);
  } catch {
    // A fresh unrelated conversation remains on the slim control surface.
  }
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
        "The user launches CadGPT once per ChatGPT conversation, either by selecting/calling the CadGPT plugin/icon (the connector may be renamed, e.g. CG) or by using literal @cadgpt or @cg. The connector may replace its underlying MCP transport/session without requiring the user to launch again.",
        "On a bare plugin/icon or bare @cadgpt or @cg launch, call cadgpt_admission once. If that launch also contains a real task, claim the session and continue directly instead of forcing the generic Welcome. After the session is claimed, do not call admission again on every turn.",
        "Never carry admission or work authority into another ChatGPT conversation, memory, unrelated files, paths, or AutoCAD state. CadGPT binds replacement MCP transports to the connector-provided logical ChatGPT conversation identity; unrelated conversations remain isolated.",
        "Bare @cadgpt or bare CG/plugin launch makes the session READY, not WORK ACTIVE. Work becomes ACTIVE only after cadgpt_work_start or cadgpt_cad_confirm.",
        "CadGPT session claim is routing state only; it is not an execution credential and has no per-turn token.",
        "Actual work begins with cadgpt_work_start (for file/job/lisp work) or cadgpt_cad_confirm (for a user-selected drawing workspace). FILE work that later needs CAD testing must transition through cadgpt_work_upgrade with an explicit drawing selector or CREATE_TEST. The returned work_handle (execution_id + authority_token) is the only execution credential; after upgrade the old handle is stale. Lisp/Job authoring, register, import and export are FILE work until a real CAD test is requested.",
        "CRITICAL — CAD tools after workspace ready: When cadgpt_cad_confirm returns cad_tools_ready=true, ALL tools listed in cad_proxy_tools (e.g. cad__cad_list_layers, cad__cad_list_entities, etc.) are immediately callable. Pass execution_id and authority_token from work_handle as required parameters in EVERY cad__* and drawing_* tool call. The empty work_capabilities array is normal for a drawing workspace and does NOT mean tools are unavailable — it is an internal privilege flag unrelated to the MCP tool surface.",
        "Reuse the active work_handle for later compatible requests in the same chat. Do not call cadgpt_work_start again unless there is no active work or the owner/execution path must change.",
        "If the connector replaces the MCP transport/session inside the same ChatGPT conversation, continue normal work on the replacement transport. CadGPT rehydrates the required lazy tool families from logical conversation state; do not create a new work generation merely because transport identity changed.",
        "Normal same-conversation MCP transport rotation must not require a model-visible resume step. cadgpt_work_resume and continuation fields remain compatibility/recovery tools for explicit handle recovery, not prerequisites for ordinary cg/*, Job/Lisp, or CAD continuation.",
        "cg/cl and cg/cj are state-aware workflow selectors: with SESSION READY but no compatible work, start independent FILE work (lisp-authoring or job-authoring) and continue without requiring a drawing workspace; with existing FILE/HYBRID work, reuse that work and never replace a HYBRID drawing workspace merely because the task changes to Lisp/Job authoring.",
        "cg/mcp is demand-driven development fallback, not a normal workspace command. Use it only when a CAD MCP tool is missing/broken or the user explicitly requests MCP improvement. In a development build with no compatible work, start standalone cad-mcp-dev FILE work. If a FILE/HYBRID work already exists, keep the same execution and explicitly enable the cad-mcp-dev capability through cadgpt_work_start continuation; never replace an existing drawing workspace. In production builds cad-mcp-dev remains unavailable.",
        "Bare launch always renders the three-section CadGPT Welcome from tray state. If AutoCAD is offline, keep WORK IDLE and tell the user to open AutoCAD/a drawing then use cg/list.",
        "If the tray cache reports AutoCAD, list open drawings with no active-drawing marker and ask the user to choose exactly one drawing. The fake CLI is not live-updating; cg/list refreshes from the newest tray snapshot. PREPARE does not start CAD MCP, has no WorkRegistration, and cannot mutate CAD.",
        "After the user chooses one listed drawing, call cadgpt_cad_confirm with exactly one choice_key. The confirmation capability is server-side continuity state; normal user/model flow does not need to supply or manage a token. The choice may be the displayed number, drawing name, or full path. Multi-drawing selection is forbidden. This transition replaces any prior work, starts full CAD MCP, verifies the selected drawing live, binds exactly one DrawingContext, and returns Workspace Ready.",
        "A workspace choice is the user's direct drawing selection; no extra nomination or confirmation step exists. Do not treat bare 'xác nhận' as a drawing choice and never default to all drawings. Reuse the private confirmation_token internally; never ask the user to copy or manage it. Repeated admission/list calls with an unchanged drawing list must preserve the same pending selection state.",
        "Hard invariant: 1 work = 1 drawing. For later compatible requests, reuse the active work_handle. cg/list may prepare a replacement workspace; selecting a new drawing releases the prior work before registering the new one.",
        "CadGPT has FILE, CAD and HYBRID execution paths. FILE is user authoring/data-only; CAD is CAD-only; HYBRID is the controlled successor when FILE authoring must continue while performing a real CAD test. CAD MCP activates only on actual CAD demand. User-created/imported Lisp/Job lives in real per-user AppData. Repo-bundled TBH Tool Kit is Internal Registry/install content under resources/cad/internal-lisp/** and is never resolved through user AppData.",
        "Registered Job behavior is extension-driven: .py is a direct Job and must be dispatched with job_run_direct without model planning; .md is a reasoning Job. For .md Jobs follow knowledge/jobs/REASONING_HARNESS.md: execute read-only observations first, then PLAN -> REVIEW -> REVISE if needed -> EXEC -> READBACK -> NEXT per reasoning/mutation stage. Re-plan/review later stages from the new drawing state instead of assuming an upfront whole-workflow plan remains valid. Internal review does not pause for user confirmation; defer uncertain items when safe, continue the workflow, and report unresolved items at the end.",
        "Never assume AutoCAD ActiveDocument is the target; use explicit drawing contexts.",
        "All file mutations require absolute canonical target paths and allowed-root verification. Relative/CWD-authorized mutation is forbidden.",
        "cad-mcp-dev is development-only and may mutate source only under the absolute runtimes/cad-mcp root.",
      ].join("\n"),
    }
  );

  sessionKeyByServer.set(server, sessionKey);
  configureToolRegistration(server, sessionKey);
  registerStableProductionSurface(server);

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
        const toolSurface = await prepareFamilies(
          server,
          "hybrid",
          "drawing-workspace",
          work.executionId
        );
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

        const { cadProxySurfaceSnapshot } = await import("./tools/cad-proxy.js");
        const cadSurface = cadProxySurfaceSnapshot(server);

        return {
          text: lines.join("\n"),
          work_handle: {
            execution_id: work.executionId,
            authority_token: work.authorityToken,
            owner_type: work.ownerType,
            owner_id: work.ownerId,
            execution_path: work.executionPath,
            capabilities: work.capabilities,
            work_capabilities: work.capabilities,
            generation: work.generation,
          },
          tool_surface: toolSurface,
          cad_tools_ready: true,
          cad_proxy_tool_count: cadSurface.count,
          cad_proxy_tools: cadSurface.tools,
          note:
            "work_capabilities are execution privilege flags (empty for standard CAD workspace), not the MCP tool list. All cad__* proxy tools listed in cad_proxy_tools are immediately callable using the work_handle (execution_id + authority_token). tool_surface reports the exposed tool families.",
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
    upgradeToHybrid: async (previousExecutionId, authorityToken, drawingSelector) => {
      const previousWork = validateWorkHandle(
        previousExecutionId,
        authorityToken,
        sessionKey
      );
      if (previousWork.executionPath !== "file") {
        throw new Error(
          `WORK_UPGRADE_REQUIRES_FILE: current work is '${previousWork.executionPath}'. Reuse an existing HYBRID handle instead of upgrading again.`
        );
      }

      const requestedSelector = drawingSelector.trim();
      if (!requestedSelector) {
        throw new Error(
          "DRAWING_SELECTION_REQUIRED: choose an exact open drawing name/full path, or CREATE_TEST."
        );
      }

      // Preflight CAD and the requested drawing while the FILE work is still
      // authoritative. A CAD startup/selection failure therefore leaves the
      // authoring work intact instead of destroying it first.
      const { cadUpstream } = await import("./runtime/cad-upstream.js");
      await cadUpstream.activate();
      const { bindDrawingForExecution, listOpenDrawings } = await import(
        "./session/drawing-binding.js"
      );

      let targetSelector = requestedSelector;
      if (requestedSelector.toUpperCase() === "CREATE_TEST") {
        const { withCadHostLock } = await import("./runtime/cad-scheduler.js");
        await withCadHostLock("autocad", async () => {
          const created = await cadUpstream.callTool(
            "acad_create_blank_test_document",
            {}
          );
          if (
            created &&
            typeof created === "object" &&
            (created as { isError?: boolean }).isError
          ) {
            throw new Error("CAD MCP could not create a blank test drawing");
          }
        });
        const openDocs = await listOpenDrawings();
        const active = openDocs.filter(
          (item) => item.active === true || item.is_active === true
        );
        if (active.length !== 1) {
          throw new Error(
            "TEST_DRAWING_AMBIGUOUS: could not resolve the newly-created active test drawing uniquely."
          );
        }
        targetSelector = String(active[0].full_name || active[0].name || "");
        if (!targetSelector) {
          throw new Error("New test drawing has no usable identity");
        }
      } else {
        const openDocs = await listOpenDrawings();
        const needle = requestedSelector.toLowerCase();
        const matches = openDocs.filter((item) => {
          const name = String(item.name ?? "").toLowerCase();
          const fullName = String(item.full_name ?? "").toLowerCase();
          return name === needle || fullName === needle;
        });
        if (matches.length === 0) {
          throw new Error(
            `OPEN_DRAWING_NOT_FOUND: no open drawing matches '${requestedSelector}'. Use an exact name/full path or CREATE_TEST.`
          );
        }
        if (matches.length > 1) {
          throw new Error(
            `DRAWING_IDENTITY_AMBIGUOUS: more than one open drawing matches '${requestedSelector}'. Use the exact full path.`
          );
        }
        targetSelector = String(matches[0].full_name || matches[0].name || "");
      }

      const cleanupId = releaseSessionWork(sessionKey);
      if (cleanupId) await cleanupExecutionState(cleanupId);

      let work = createWorkRegistration({
        sessionKey,
        ownerType: previousWork.ownerType,
        ownerId: previousWork.ownerId,
        executionPath: "hybrid",
      });

      if (previousWork.capabilities.includes("cad-mcp-dev")) {
        work = enableWorkCapability(
          work.executionId,
          work.authorityToken,
          sessionKey,
          "cad-mcp-dev"
        );
      }

      try {
        const toolSurface = await prepareFamilies(
          server,
          "hybrid",
          work.ownerId,
          work.executionId
        );

        const bound = await bindDrawingForExecution(
          work.executionId,
          targetSelector
        );
        const { cadProxySurfaceSnapshot } = await import("./tools/cad-proxy.js");
        const cadSurface = cadProxySurfaceSnapshot(server);

        return {
          work_handle: {
            execution_id: work.executionId,
            authority_token: work.authorityToken,
            owner_type: work.ownerType,
            owner_id: work.ownerId,
            job_id: work.jobId,
            execution_path: work.executionPath,
            capabilities: work.capabilities,
            work_capabilities: work.capabilities,
            driver_epoch: work.driverEpoch,
            generation: work.generation,
          },
          drawing: bound as unknown as Record<string, unknown>,
          tool_surface: toolSurface as Record<string, unknown>,
          cad_tools_ready: true,
          cad_proxy_tool_count: cadSurface.count,
          cad_proxy_tools: cadSurface.tools,
        };
      } catch (error) {
        const cleanupId = releaseSessionWork(sessionKey);
        if (cleanupId) await cleanupExecutionState(cleanupId);
        throw error;
      }
    },
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
  registeredSurfaceByServer.delete(server);
  sessionKeyByServer.delete(server);
}
