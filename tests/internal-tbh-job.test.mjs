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

test("CAD verified loader publishes and clears the source directory around load", async () => {
  const source = await fs.readFile(
    path.join(repoRoot, "runtimes", "cad-mcp", "services", "lisp_service.py"),
    "utf8"
  );
  assert.match(source, /setq \*cadgpt-load-dir\*/);
  assert.match(source, /setq \*cadgpt-load-dir\* nil/);
});

test("tbh executor performs exactly one verified load of permanent loader while owning child commands", async () => {
  const { getInternalJob } = await import("../dist/cadgpt/lib/internal-jobs.js");
  const { listBundledLispEntries } = await import(
    "../dist/cadgpt/lib/bundled-assets.js"
  );
  const { executeInternalDirectJob } = await import(
    "../dist/cadgpt/tools/jobs.js"
  );

  const tbh = getInternalJob("tbh");
  assert.ok(tbh);

  const entries = (await listBundledLispEntries())
    .filter((entry) => entry.library_id === "tbh-toolkit")
    .sort((a, b) => a.load_path.localeCompare(b.load_path));
  const expectedFiles = entries.map((entry) => entry.load_path);
  const expectedCommands = [
    ...new Set(entries.flatMap((entry) => entry.commands)),
  ].sort();

  const calls = [];
  const result = await executeInternalDirectJob(
    tbh,
    [],
    async (loadPath, drawingId, ownedCommands) => {
      calls.push({ loadPath, drawingId, ownedCommands });
      return {
        loaded: true,
        commands: ownedCommands ?? [],
        drawing_id: "drawing-fixture",
        raw: { loaded: true },
      };
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].loadPath, tbhLoaderVirtual);
  assert.equal(calls[0].drawingId, undefined);
  assert.deepEqual(calls[0].ownedCommands, expectedCommands);
  assert.equal(result.loader_calls, 1);
  assert.equal(result.loader_path, tbhLoaderVirtual);
  assert.equal(result.loaded_count, expectedFiles.length);
  assert.deepEqual(result.loaded_files, expectedFiles);
  assert.equal(result.command_count, expectedCommands.length);
  assert.deepEqual(result.commands, expectedCommands);
});

test("tbh executor reports one failed permanent-loader call and does not retry child files through CAD MCP", async () => {
  const { getInternalJob } = await import("../dist/cadgpt/lib/internal-jobs.js");
  const { executeInternalDirectJob } = await import(
    "../dist/cadgpt/tools/jobs.js"
  );

  const tbh = getInternalJob("tbh");
  assert.ok(tbh);
  let calls = 0;
  const failingChild =
    "TBH Tool Kit/Draw/Create/FlexConn.lsp";

  await assert.rejects(
    () =>
      executeInternalDirectJob(tbh, [], async (loadPath) => {
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
      }),
    (error) => {
      const message = String(error);
      assert.equal(message.includes("TBH_TOOLKIT_LOAD_FAILED"), true);
      assert.equal(message.includes(failingChild), true);
      return true;
    }
  );
  assert.equal(calls, 1);
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
        }
      ),
    /INTERNAL_JOB_ARGS_UNSUPPORTED/
  );
});
