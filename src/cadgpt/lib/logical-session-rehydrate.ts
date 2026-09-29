import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isSessionClaimed } from "./admission.js";
import { activeWorkForSession } from "./work-registration.js";
import { markFamilyLoaded } from "./runtime-state.js";

async function registerDiscovery(server: McpServer): Promise<void> {
  const [
    { registerLibraryDiscoveryTools },
    { registerJobDiscoveryTools },
    { registerSkillTools },
    { registerCapabilityRegistryTools },
  ] = await Promise.all([
    import("../tools/libraries.js"),
    import("../tools/jobs.js"),
    import("../tools/skills.js"),
    import("../tools/registry.js"),
  ]);
  registerLibraryDiscoveryTools(server);
  registerJobDiscoveryTools(server);
  registerSkillTools(server);
  registerCapabilityRegistryTools(server);
  markFamilyLoaded("discovery");
}

async function registerFile(server: McpServer): Promise<void> {
  await registerDiscovery(server);
  const [
    { registerFilesystemTools },
    { registerLispHarnessTools },
    { registerLispWorkspaceTools },
    { registerJobAuthoringTools },
    { registerUserAssetTools },
  ] = await Promise.all([
    import("../tools/filesystem.js"),
    import("../tools/lisp-harness.js"),
    import("../tools/lisp-workspace.js"),
    import("../tools/jobs.js"),
    import("../tools/user-assets.js"),
  ]);
  registerFilesystemTools(server);
  registerLispHarnessTools(server);
  registerLispWorkspaceTools(server);
  registerJobAuthoringTools(server);
  registerUserAssetTools(server);
  markFamilyLoaded("file");
}

async function registerCad(server: McpServer): Promise<void> {
  const [{ registerCadProxyTools }, { registerObservatorTools }] =
    await Promise.all([
      import("../tools/cad-proxy.js"),
      import("../tools/observator.js"),
    ]);
  registerCadProxyTools(server);
  registerObservatorTools(server);
  markFamilyLoaded("cad");
}

export async function rehydrateLogicalSessionServer(
  server: McpServer,
  logicalSessionKey: string
): Promise<void> {
  const work = activeWorkForSession(logicalSessionKey);
  if (work) {
    if (work.executionPath === "file" || work.executionPath === "hybrid") {
      await registerFile(server);
    } else if (isSessionClaimed(logicalSessionKey)) {
      await registerDiscovery(server);
    }
    if (work.executionPath === "cad" || work.executionPath === "hybrid") {
      await registerCad(server);
    }
    return;
  }
  if (isSessionClaimed(logicalSessionKey)) {
    await registerDiscovery(server);
  }
}
