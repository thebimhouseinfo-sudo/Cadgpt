import test from "node:test";
import assert from "node:assert/strict";

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

test("tbh executor loads the bundled toolkit deterministically through the verified loader", async () => {
  const { getInternalJob } = await import("../dist/cadgpt/lib/internal-jobs.js");
  const { listBundledLispEntries } = await import(
    "../dist/cadgpt/lib/bundled-assets.js"
  );
  const { executeInternalDirectJob } = await import(
    "../dist/cadgpt/tools/jobs.js"
  );

  const tbh = getInternalJob("tbh");
  assert.ok(tbh);

  const expected = (await listBundledLispEntries())
    .filter((entry) => entry.library_id === "tbh-toolkit")
    .map((entry) => entry.load_path)
    .sort((a, b) => a.localeCompare(b));

  assert.ok(expected.length > 0);
  assert.ok(
    expected.every((item) =>
      item.startsWith("resources/cad/internal-lisp/tbh-toolkit/")
    )
  );

  const seen = [];
  const result = await executeInternalDirectJob(tbh, [], async (loadPath) => {
    seen.push(loadPath);
    return {
      loaded: true,
      commands: [`CMD_${seen.length}`],
      drawing_id: "drawing-fixture",
      raw: { loaded: true },
    };
  });

  assert.deepEqual(seen, expected);
  assert.equal(result.loaded_count, expected.length);
  assert.equal(result.drawing_id, "drawing-fixture");
  assert.equal(result.registry, "internal");
  assert.equal(result.execution_mode, "direct");
  assert.equal(result.command_count, expected.length);
});

test("tbh executor stops at the first verified load failure", async () => {
  const { getInternalJob } = await import("../dist/cadgpt/lib/internal-jobs.js");
  const { listBundledLispEntries } = await import(
    "../dist/cadgpt/lib/bundled-assets.js"
  );
  const { executeInternalDirectJob } = await import(
    "../dist/cadgpt/tools/jobs.js"
  );

  const tbh = getInternalJob("tbh");
  assert.ok(tbh);
  const expected = (await listBundledLispEntries())
    .filter((entry) => entry.library_id === "tbh-toolkit")
    .map((entry) => entry.load_path)
    .sort((a, b) => a.localeCompare(b));

  const seen = [];
  await assert.rejects(
    () =>
      executeInternalDirectJob(tbh, [], async (loadPath) => {
        seen.push(loadPath);
        const loaded = seen.length < 3;
        return {
          loaded,
          commands: [],
          drawing_id: "drawing-fixture",
          raw: loaded
            ? { loaded: true }
            : { loaded: false, error: "fixture failure" },
        };
      }),
    (error) => {
      const message = String(error);
      assert.equal(message.includes("TBH_TOOLKIT_LOAD_FAILED"), true);
      assert.equal(message.includes(expected[2]), true);
      return true;
    }
  );
  assert.deepEqual(seen, expected.slice(0, 3));
});

test("tbh internal direct Job rejects positional args", async () => {
  const { getInternalJob } = await import("../dist/cadgpt/lib/internal-jobs.js");
  const { executeInternalDirectJob } = await import(
    "../dist/cadgpt/tools/jobs.js"
  );
  const tbh = getInternalJob("tbh");
  assert.ok(tbh);
  await assert.rejects(
    () => executeInternalDirectJob(tbh, ["unexpected"], async () => {
      throw new Error("loader should not be called");
    }),
    /INTERNAL_JOB_ARGS_UNSUPPORTED/
  );
});
