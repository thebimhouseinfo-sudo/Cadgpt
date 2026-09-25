import { z } from "zod";
import {
  McpServer,
  type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { assertSessionClaimed, revokeSessionAdmissions } from "./lib/admission.js";
import {
  activeExecutionForSession,
  acquireToolLease,
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
    { registerLibraryMutationTools },
    { registerJobAuthoringTools },
  ] = await Promise.all([
    import("./tools/filesystem.js"),
    import("./tools/lisp-harness.js"),
    import("./tools/lisp-workspace.js"),
    import("./tools/libraries.js"),
    import("./tools/jobs.js"),
  ]);

  registerFilesystemTools(server);
  registerLispHarnessTools(server);
  registerLispWorkspaceTools(server);
  registerLibraryMutationTools(server);
  registerJobAuthoringTools(server);

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
        "CadGPT entry routing — highest priority: bare CadGPT plugin/icon invocation (including a connector renamed CG) or bare @cadgpt must call cadgpt_admission and return its welcome_text verbatim when present. Do not replace it with prose such as 'activated'.",
        "Exact cadgpt/ calls cadgpt_control(surface=commands); exact cadgpt/help calls cadgpt_control(surface=help); exact cadgpt/status calls cadgpt_control(surface=status); exact cadgpt/stop calls cadgpt_control(surface=stop). Commands/help/status must not wake CAD MCP.",
        "CadGPT is explicit-launch, session-persistent.",
        "The user launches CadGPT once per ChatGPT/MCP session, either by selecting/calling the CadGPT plugin/icon (the connector may be renamed, e.g. CG) or by using literal @cadgpt.",
        "On a bare plugin/icon or bare @cadgpt launch, call cadgpt_admission once. If that launch also contains a real task, claim the session and continue directly instead of forcing the generic Welcome. After the session is claimed, do not call admission again on every turn.",
        "Never carry admission across another MCP/chat session, memory, unrelated files, paths, or AutoCAD state. Session disposal revokes the claim.",
        "Bare @cadgpt or bare CG/plugin launch makes the session READY, not WORK ACTIVE. Work becomes ACTIVE only after cadgpt_work_start.",
        "CadGPT session claim is routing state only; it is not an execution credential and has no per-turn token.",
        "Actual FILE/CAD work begins with cadgpt_work_start. The returned work_handle (execution_id + authority_token) is the only execution credential.",
        "Reuse the active work_handle for later compatible requests in the same chat. Do not call cadgpt_work_start again unless there is no active work or the owner/execution path must change.",
        "CadGPT has two execution paths: FILE and CAD. CAD MCP is activated only on actual CAD demand.",
        "Never assume AutoCAD ActiveDocument is the target; use explicit drawing contexts.",
        "All file mutations require absolute canonical target paths and allowed-root verification. Relative/CWD-authorized mutation is forbidden.",
        "cad-mcp-dev is development-only and may mutate source only under the absolute runtimes/cad-mcp root.",
      ].join("\n"),
    }
  );

  sessionKeyByServer.set(server, sessionKey);
  configureToolRegistration(server, sessionKey);

  registerCadGptControlTool(server, {
    sessionKey,
    getCadState: async () => {
      const runtime = runtimeStateSnapshot();
      if (!runtime.loaded_families.includes("cad")) return "SLEEPING";
      try {
        const { cadUpstream } = await import("./runtime/cad-upstream.js");
        const state = cadUpstream.status() as unknown as Record<string, unknown>;
        if (state.connected === true) return "CONNECTED";
        const raw = typeof state.state === "string" ? state.state : "SLEEPING";
        return raw.toUpperCase();
      } catch {
        return "ERROR";
      }
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
    onActive: () => loadDiscoveryFamily(server),
  });
  registerWorkControlTools(server, {
    sessionKey,
    prepareFamilies: (executionPath, ownerId, executionId) =>
      prepareFamilies(server, executionPath, ownerId, executionId),
  });

  return server;
}


export async function disposeMcpServerRuntime(
  server: McpServer,
  options: { preserveSessionState?: boolean } = {}
): Promise<void> {
  const sessionKey = sessionKeyByServer.get(server);
  if (!sessionKey) return;

  if (!options.preserveSessionState) {
    const executionIdReadyForCleanup = releaseSessionWork(sessionKey);
    if (executionIdReadyForCleanup) {
      await cleanupExecutionState(executionIdReadyForCleanup);
    }
    revokeSessionAdmissions(sessionKey);
  }

  loadedByServer.delete(server);
  sessionKeyByServer.delete(server);
}
