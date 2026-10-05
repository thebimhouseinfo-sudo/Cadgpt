import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("Job local compatibility fast path reads only the small epoch state and leaves deep scan to jobcreate", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-job-compat-")
  );
  const previous =
    process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  try {
    const compat = await import(
      "../dist/cadgpt/lib/job-local-compat.js"
    );
    const {
      registerJobAuthoringTools,
      registerJobDiscoveryTools,
    } = await import(
      "../dist/cadgpt/tools/jobs.js"
    );

    const initial =
      await compat.getJobLocalCompatStatus();
    assert.equal(initial.source_epoch, 1);
    assert.equal(initial.checked_epoch, 0);
    assert.equal(initial.update_required, true);
    const repairGuide = await fs.readFile(
      path.resolve(
        "knowledge/jobs/LOCAL_COMPAT_UPDATE.md"
      ),
      "utf8"
    );
    assert.match(
      repairGuide,
      new RegExp(
        `JOB_LOCAL_COMPAT_EPOCH = ${initial.source_epoch}`
      )
    );

    const registryRoot = path.join(
      tempRoot,
      "registry",
      "user"
    );
    await fs.mkdir(registryRoot, {
      recursive: true,
    });
    await fs.writeFile(
      path.join(
        registryRoot,
        "capabilities.json"
      ),
      "{ definitely not valid json",
      "utf8"
    );

    await compat.markJobLocalCompatChecked({
      scanned_user_jobs: 0,
      report_summary: "no user jobs",
      pending_actions: [
        "external registration follow-up",
      ],
    });
    const fast =
      await compat.getJobLocalCompatStatus();
    assert.equal(fast.update_required, false);
    assert.deepEqual(fast.pending_actions, [
      "external registration follow-up",
    ]);

    const callbacks = new Map();
    const fakeServer = {
      registerTool(name, _config, callback) {
        callbacks.set(name, callback);
      },
    };
    registerJobDiscoveryTools(fakeServer);
    registerJobAuthoringTools(fakeServer);

    const statusTool = callbacks.get(
      "job_local_compat_status"
    );
    assert.equal(typeof statusTool, "function");
    const toolFast = await statusTool({});
    assert.equal(
      toolFast.structuredContent?.data?.scan_mode,
      "fast_path",
      JSON.stringify(toolFast)
    );

    await fs.writeFile(
      path.join(
        tempRoot,
        "state",
        "job-local-compat.json"
      ),
      JSON.stringify({
        checked_epoch: 0,
      }),
      "utf8"
    );
    const changed = await statusTool({});
    assert.equal(
      changed.structuredContent?.data?.scan_mode,
      "deep_scan_required"
    );

    const runDirect = callbacks.get(
      "job_run_direct"
    );
    const blocked = await runDirect({
      id: "custom-job",
      args: [],
    });
    assert.equal(blocked.isError, true);
    assert.match(
      JSON.stringify(blocked),
      /JOB_LOCAL_COMPAT_UPDATE_REQUIRED/
    );
    assert.doesNotMatch(
      JSON.stringify(blocked),
      /not valid json/
    );

    const managedJob = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "fixture-lib",
      "custom-job",
      "JOB.md"
    );
    await fs.mkdir(path.dirname(managedJob), {
      recursive: true,
    });
    await fs.writeFile(
      managedJob,
      [
        "# Job: Custom",
        "## Goal",
        "Scan",
        "## Preconditions",
        "Ready",
        "## Step 1",
        "available_tools: job_list",
        "success_criteria: scanned",
        "failure_handling: stop",
        "output: report",
        "## Validation",
        "Verify",
        "",
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(
        registryRoot,
        "capabilities.json"
      ),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "custom-job",
            kind: "job",
            library_id: "fixture-lib",
            relative_path:
              "custom-job/JOB.md",
            title: "Custom Job",
          },
        ],
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(
        registryRoot,
        "libraries.json"
      ),
      JSON.stringify({
        version: 1,
        libraries: [
          {
            id: "fixture-lib",
            kind: "job",
            enabled: true,
            managed_path:
              "appdata/libraries/jobs/fixture-lib",
          },
        ],
      }),
      "utf8"
    );

    const getJob = callbacks.get("job_get");
    const scanRead = await getJob({
      id: "custom-job",
    });
    assert.equal(
      scanRead.isError,
      undefined,
      JSON.stringify(scanRead)
    );
    assert.equal(
      scanRead.structuredContent?.data?.id,
      "custom-job"
    );
  } finally {
    if (previous === undefined) {
      delete process.env.CADGPT_APPDATA_ROOT;
    } else {
      process.env.CADGPT_APPDATA_ROOT = previous;
    }
    await fs.rm(tempRoot, {
      recursive: true,
      force: true,
    });
  }
});
