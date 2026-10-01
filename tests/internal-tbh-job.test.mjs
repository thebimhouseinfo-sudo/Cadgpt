import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const tbhLoaderVirtual =
  "resources/cad/internal-lisp/tbh-toolkit/tbhloader.lsp";

test("official tbh Job is internal, direct, and discoverable", async () => {
  const { getInternalJob } = await import("../dist/cadgpt/lib/internal-jobs.js");
  const { registerJobDiscoveryTools } = await import("../dist/cadgpt/tools/jobs.js");
  const { registerCapabilityRegistryTools } = await import(
    "../dist/cadgpt/tools/registry.js"
  );

  const tbh = getInternalJob("tbh");
  assert.ok(tbh);
  assert.equal(tbh.registry, "internal");
  assert.equal(tbh.execution_mode, "direct");
  assert.equal(tbh.library_id, "tbh-toolkit");
  assert.equal(tbh.resource_root, "resources/cad/internal-lisp/tbh-toolkit");

  const callbacks = new Map();
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
      return { remove() {} };
    },
  };

  registerJobDiscoveryTools(fakeServer);
  registerCapabilityRegistryTools(fakeServer);

  const jobList = await callbacks.get("job_list")({});
  const jobs = jobList.structuredContent?.data?.jobs ?? [];
  const job = jobs.find((item) => item.id === "tbh");
  assert.equal(job?.registry, "internal");
  assert.equal(job?.execution_mode, "direct");

  const registryList = await callbacks.get("registry_list")({
    kind: "job",
    registry: "internal",
    limit: 100,
  });
  const entries = registryList.structuredContent?.data?.entries ?? [];
  const registryEntry = entries.find((item) => item.id === "tbh");
  assert.equal(registryEntry?.registry, "internal");
  assert.equal(registryEntry?.executor, "builtin:tbh-toolkit-loader");
});

test("tbhloader.lsp is the sole bundled Lisp registry exception", async () => {
  const {
    BUNDLED_LISP_REGISTRY_EXCEPTIONS,
    listBundledLispEntries,
  } = await import("../dist/cadgpt/lib/bundled-assets.js");

  assert.deepEqual(
    [...BUNDLED_LISP_REGISTRY_EXCEPTIONS],
    ["tbh-toolkit/tbhloader.lsp"]
  );

  const entries = await listBundledLispEntries();
  assert.equal(
    entries.some((entry) => entry.load_path === tbhLoaderVirtual),
    false
  );
  assert.ok(
    entries.some(
      (entry) =>
        entry.library_id === "tbh-toolkit" &&
        entry.load_path !== tbhLoaderVirtual
    )
  );
});

test("permanent tbhloader is fail-fast and resolves children from CadGPT load context", async () => {
  const source = await fs.readFile(
    path.join(
      repoRoot,
      "resources",
      "cad",
      "internal-lisp",
      "tbh-toolkit",
      "tbhloader.lsp"
    ),
    "utf8"
  );

  assert.match(source, /\*cadgpt-load-dir\*/i);
  assert.match(source, /vl-catch-all-apply\s+'load/i);
  assert.match(source, /TBH child load failed:/);
  assert.match(source, /\(error/i);
  assert.doesNotMatch(source, /tbhloader\.lsp/i);
});

test("permanent tbhloader child list exactly matches registered toolkit components", async () => {
  const { listBundledLispEntries } = await import(
    "../dist/cadgpt/lib/bundled-assets.js"
  );
  const source = await fs.readFile(
    path.join(
      repoRoot,
      "resources",
      "cad",
      "internal-lisp",
      "tbh-toolkit",
      "tbhloader.lsp"
    ),
    "utf8"
  );

  const listed = [...source.matchAll(/^  "([^"]+\.lsp)"\s*$/gim)]
    .map((match) => match[1].replaceAll("\\\\", "/"))
    .sort((a, b) => a.localeCompare(b));
  const expected = (await listBundledLispEntries())
    .filter((entry) => entry.library_id === "tbh-toolkit")
    .map((entry) => entry.relative_path)
    .sort((a, b) => a.localeCompare(b));

  assert.deepEqual(listed, expected);
});

test("connector instructions forbid bypassing a failed internal direct Job with lower-level Lisp tools", async () => {
  const source = await fs.readFile(
    path.join(repoRoot, "src", "cadgpt", "server-factory.ts"),
    "utf8"
  );
  assert.match(source, /Internal Direct Job path is authoritative/);
  assert.match(source, /do NOT bypass it/i);
  assert.match(source, /cad__cad_load_lisp_file/);
});

test("CAD verified loader publishes and clears the source directory around load", async () => {
  const source = await fs.readFile(
    path.join(repoRoot, "runtimes", "cad-mcp", "services", "lisp_service.py"),
    "utf8"
  );
  assert.match(source, /setq \*cadgpt-load-dir\*/);
  assert.match(source, /setq \*cadgpt-load-dir\* nil/);
});

test("tbh executor performs exactly one verified loader call and only toggles toolkit state", async () => {
  const { getInternalJob } = await import("../dist/cadgpt/lib/internal-jobs.js");
  const { executeInternalDirectJob } = await import(
    "../dist/cadgpt/tools/jobs.js"
  );

  const tbh = getInternalJob("tbh");
  assert.ok(tbh);

  const calls = [];
  const toggles = [];
  const result = await executeInternalDirectJob(
    tbh,
    [],
    async (loadPath, drawingId, ownedCommands) => {
      calls.push({ loadPath, drawingId, ownedCommands });
      return {
        loaded: true,
        commands: [],
        drawing_id: "drawing-fixture",
        raw: { loaded: true },
      };
    },
    (drawingId, group) => {
      toggles.push({ drawingId, group });
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].loadPath, tbhLoaderVirtual);
  assert.equal(calls[0].drawingId, undefined);
  assert.equal(calls[0].ownedCommands, undefined);
  assert.deepEqual(toggles, [
    { drawingId: "drawing-fixture", group: "tbh-toolkit" },
  ]);
  assert.equal(result.loader_calls, 1);
  assert.equal(result.loader_path, tbhLoaderVirtual);
  assert.equal(result.loaded, true);
  assert.equal(result.state, "on");
  assert.equal("commands" in result, false);
  assert.equal("command_count" in result, false);
  assert.equal("loaded_files" in result, false);
});

test("tbh executor does not toggle state when permanent loader fails", async () => {
  const { getInternalJob } = await import("../dist/cadgpt/lib/internal-jobs.js");
  const { executeInternalDirectJob } = await import(
    "../dist/cadgpt/tools/jobs.js"
  );

  const tbh = getInternalJob("tbh");
  assert.ok(tbh);
  let calls = 0;
  let toggles = 0;
  const failingChild =
    "TBH Tool Kit/Draw/Create/FlexConn.lsp";

  await assert.rejects(
    () =>
      executeInternalDirectJob(
        tbh,
        [],
        async (loadPath) => {
          calls += 1;
          assert.equal(loadPath, tbhLoaderVirtual);
          return {
            loaded: false,
            commands: [],
            drawing_id: "drawing-fixture",
            raw: {
              loaded: false,
              error: `TBH child load failed: ${failingChild}`,
            },
          };
        },
        () => {
          toggles += 1;
        }
      ),
    (error) => {
      const message = String(error);
      assert.equal(message.includes("TBH_TOOLKIT_LOAD_FAILED"), true);
      assert.equal(message.includes(failingChild), true);
      return true;
    }
  );
  assert.equal(calls, 1);
  assert.equal(toggles, 0);
});

test("TBH loaded state is isolated by execution and drawing and clears with execution state", async () => {
  const {
    clearExecutionCadProxyState,
    internalLispGroupLoaded,
    markInternalLispGroupLoadedForExecution,
  } = await import("../dist/cadgpt/tools/cad-proxy.js");

  markInternalLispGroupLoadedForExecution(
    "exec-a",
    "drawing-a",
    "tbh-toolkit"
  );

  assert.equal(
    internalLispGroupLoaded("exec-a", "drawing-a", "tbh-toolkit"),
    true
  );
  assert.equal(
    internalLispGroupLoaded("exec-a", "drawing-b", "tbh-toolkit"),
    false
  );
  assert.equal(
    internalLispGroupLoaded("exec-b", "drawing-a", "tbh-toolkit"),
    false
  );

  clearExecutionCadProxyState("exec-a");
  assert.equal(
    internalLispGroupLoaded("exec-a", "drawing-a", "tbh-toolkit"),
    false
  );
});

test("tbh internal direct Job rejects positional args", async () => {
  const { getInternalJob } = await import("../dist/cadgpt/lib/internal-jobs.js");
  const { executeInternalDirectJob } = await import(
    "../dist/cadgpt/tools/jobs.js"
  );
  const tbh = getInternalJob("tbh");
  assert.ok(tbh);
  await assert.rejects(
    () =>
      executeInternalDirectJob(
        tbh,
        ["unexpected"],
        async () => {
          throw new Error("loader should not be called");
        },
        () => {
          throw new Error("state marker should not be called");
        }
      ),
    /INTERNAL_JOB_ARGS_UNSUPPORTED/
  );
});
