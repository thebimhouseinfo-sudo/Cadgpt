import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  McpServer,
  type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { validateAdmissionToken } from "./lib/admission.js";
import {
  acquireToolLease,
  runWithToolLease,
  type ExecutionPath,
} from "./lib/work-registration.js";
import {
  toolAuthority,
  toolFamily,
  toolTargetId,
} from "./lib/tool-policy.js";
import { markFamilyLoaded } from "./lib/runtime-state.js";
import { registerAdmissionTool } from "./tools/admission.js";
import { registerWorkControlTools } from "./tools/work-control.js";

const loadedByServer = new WeakMap<McpServer, Set<string>>();

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
      authority === "admission"
        ? {
            admission_token: z
              .string()
              .min(1)
              .describe("ACTIVE token returned by cadgpt_admission for this exact ChatGPT session"),
          }
        : authority === "work"
          ? {
              admission_token: z
                .string()
                .min(1)
                .describe("ACTIVE token returned by cadgpt_admission"),
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
        authority === "admission"
          ? `${config.description || ""} Requires ACTIVE cadgpt_admission.`.trim()
          : authority === "work"
            ? `${config.description || ""} Requires ACTIVE admission + current CadGPT work_handle.`.trim()
            : config.description,
    };

    if (authority === "control") {
      return original(name, nextConfig, callback);
    }

    const wrapped = async (args: Record<string, unknown> = {}, ...rest: unknown[]) => {
      const admissionToken =
        typeof args.admission_token === "string" ? args.admission_token : undefined;

      if (authority === "admission") {
        validateAdmissionToken(admissionToken, sessionKey);
        const toolArgs = { ...args };
        delete toolArgs.admission_token;
        return callback(toolArgs, ...rest);
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
        admissionToken,
        sessionKey,
      });
      const toolArgs = { ...args };
      delete toolArgs.admission_token;
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

  const [{ registerLibraryTools }, { registerJobTools }, { registerSkillTools }, { registerCapabilityRegistryTools }] =
    await Promise.all([
      import("./tools/libraries.js"),
      import("./tools/jobs.js"),
      import("./tools/skills.js"),
      import("./tools/registry.js"),
    ]);

  registerLibraryTools(server);
  registerJobTools(server);
  registerSkillTools(server);
  registerCapabilityRegistryTools(server);

  loaded.add("discovery");
  markFamilyLoaded("discovery");
}

async function loadFileFamily(server: McpServer): Promise<void> {
  const loaded = serverFamilies(server);
  if (loaded.has("file")) return;

  await loadDiscoveryFamily(server);
  const [{ registerFilesystemTools }, { registerLispHarnessTools }, { registerLispWorkspaceTools }] =
    await Promise.all([
      import("./tools/filesystem.js"),
      import("./tools/lisp-harness.js"),
      import("./tools/lisp-workspace.js"),
    ]);

  registerFilesystemTools(server);
  registerLispHarnessTools(server);
  registerLispWorkspaceTools(server);

  loaded.add("file");
  markFamilyLoaded("file");
}

async function loadCadFamily(server: McpServer): Promise<void> {
  const loaded = serverFamilies(server);
  if (loaded.has("cad")) return;

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
  ownerId: string
): Promise<void> {
  if (executionPath === "file" || executionPath === "hybrid") await loadFileFamily(server);
  if (executionPath === "cad" || executionPath === "hybrid") await loadCadFamily(server);
  if (ownerId === "cad-mcp-dev") await loadCadMcpDevFamily(server);
}

export function createMcpServer(): McpServer {
  const sessionKey = randomUUID();
  const server = new McpServer(
    { name: "cadgpt", version: "0.2.0" },
    {
      capabilities: { logging: {}, tools: { listChanged: true } },
      instructions: [
        "CadGPT is explicit-invocation only.",
        "Before using CadGPT for any ordinary request, call cadgpt_admission with the exact current user turn.",
        "If cadgpt_admission returns INACTIVE, STOP CadGPT immediately. Never ask the user to activate it and never infer activation from CAD context, files, paths, memory, prior turns, or AutoCAD state.",
        "Only literal @cadgpt in the current user turn admits CadGPT.",
        "ACTIVE admission returns admission_token. Carry it to discovery and cadgpt_work_start.",
        "Actual FILE/CAD work requires the work_handle from cadgpt_work_start; carry admission_token + execution_id + authority_token to every execution tool call.",
        "CadGPT has two execution paths: FILE and CAD. CAD MCP is activated only on actual CAD demand.",
        "Never assume AutoCAD ActiveDocument is the target; use explicit drawing contexts.",
        "All file mutations require absolute canonical target paths and allowed-root verification. Relative/CWD-authorized mutation is forbidden.",
        "cad-mcp-dev is development-only and may mutate source only under the absolute runtimes/cad-mcp root.",
      ].join("\n"),
    }
  );

  configureToolRegistration(server, sessionKey);

  registerAdmissionTool(server, {
    sessionKey,
    onActive: () => loadDiscoveryFamily(server),
  });
  registerWorkControlTools(server, {
    sessionKey,
    prepareFamilies: (executionPath, ownerId) =>
      prepareFamilies(server, executionPath, ownerId),
  });

  return server;
}
