import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("Job SYSTEM leases are shared across different Jobs but session-owned", async () => {
  const system = await import(
    "../dist/cadgpt/runtime/system-lease.js"
  );

  const suffix = Date.now().toString(36);
  const session = "system-session-" + suffix;
  const aId = "job-a-" + suffix;
  const bId = "job-b-" + suffix;

  const a = system.acquireJobSystemLease({
    toolId: aId,
    jobId: aId,
    jobName: "Job A",
    sessionKey: session,
    readableRoots: [],
    writableRoots: [],
  });
  const b = system.acquireJobSystemLease({
    toolId: bId,
    jobId: bId,
    jobName: "Job B",
    sessionKey: session,
    readableRoots: [],
    writableRoots: [],
  });

  try {
    assert.equal(a.tool_id, aId);
    assert.equal(b.tool_id, bId);
    assert.deepEqual(
      system
        .activeJobSystemLeasesForSession(session)
        .map((lease) => lease.tool_id)
        .sort(),
      [aId, bId].sort()
    );
    assert.throws(
      () =>
        system.getJobSystemLease(
          aId,
          "other-session-" + suffix
        ),
      /SYSTEM_LEASE_BUSY/
    );

    let current = null;
    await system.runWithJobSystemLease(
      a,
      async () => {
        current =
          system.currentJobSystemLease();
      }
    );
    assert.equal(current?.tool_id, aId);
  } finally {
    system.releaseJobSystemLease(aId, session);
    system.releaseJobSystemLease(bId, session);
  }
});

test("detached Job runtime survives foreground cleanup and keeps same Job busy", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-system-runtime-")
  );
  const previous =
    process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  try {
    const runtime = await import(
      "../dist/cadgpt/runtime/job-runtime.js"
    );

    const jobA = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "fixture",
      "job-a",
      "JOB.md"
    );
    const jobB = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "fixture",
      "job-b",
      "JOB.md"
    );
    await fs.mkdir(path.dirname(jobA), {
      recursive: true,
    });
    await fs.mkdir(path.dirname(jobB), {
      recursive: true,
    });
    await fs.writeFile(jobA, "# Job: A\n", "utf8");
    await fs.writeFile(jobB, "# Job: B\n", "utf8");

    const execution = "exec-shared";
    const preparedA =
      await runtime.prepareJobRuntimeForExecution(
        execution,
        "job-a",
        jobA
      );
    await fs.writeFile(
      path.join(preparedA.runtime_root, "raw.json"),
      "{}\n",
      "utf8"
    );

    runtime.detachJobRuntimeForSystemLease(
      execution,
      "job-a"
    );

    const foregroundCleanup =
      await runtime.cleanupJobRuntimeForExecution(
        execution
      );
    assert.equal(foregroundCleanup.active, false);
    assert.equal(
      await fs.readFile(
        path.join(
          preparedA.runtime_root,
          "raw.json"
        ),
        "utf8"
      ),
      "{}\n"
    );

    await runtime.prepareJobRuntimeForExecution(
      execution,
      "job-b",
      jobB
    );

    await assert.rejects(
      () =>
        runtime.prepareJobRuntimeForExecution(
          "exec-another",
          "job-a",
          jobA
        ),
      /JOB_RUNTIME_BUSY/
    );

    await runtime.cleanupJobRuntimeForExecution(
      execution
    );
    await runtime.cleanupJobRuntimeForSystemLease(
      "job-a"
    );

    const restarted =
      await runtime.prepareJobRuntimeForExecution(
        "exec-restart",
        "job-a",
        jobA
      );
    assert.equal(restarted.job_id, "job-a");
    await runtime.cleanupJobRuntimeForExecution(
      "exec-restart"
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

test("SYSTEM filesystem authority writes only own runtime/result and can read drawing results", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-system-files-")
  );
  const previous =
    process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const callbacks = new Map();
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
    },
  };

  try {
    const system = await import(
      "../dist/cadgpt/runtime/system-lease.js"
    );
    const {
      registerFilesystemTools,
    } = await import(
      "../dist/cadgpt/tools/filesystem.js"
    );
    registerFilesystemTools(fakeServer);

    const runtimeRoot = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "fixture",
      "job-a",
      "runtime"
    );
    const drawingRoot = path.join(
      tempRoot,
      "drawings",
      "anchor-a"
    );
    const ownResult = path.join(
      drawingRoot,
      "jobs",
      "job-a-result"
    );
    const otherResult = path.join(
      drawingRoot,
      "jobs",
      "job-b-result"
    );
    await fs.mkdir(runtimeRoot, {
      recursive: true,
    });
    await fs.mkdir(ownResult, {
      recursive: true,
    });
    await fs.mkdir(otherResult, {
      recursive: true,
    });
    await fs.writeFile(
      path.join(otherResult, "result.json"),
      "{\"other\":true}\n",
      "utf8"
    );

    const session = "file-system-session";
    const lease = system.acquireJobSystemLease({
      toolId: "job-a-file-scope",
      jobId: "job-a-file-scope",
      jobName: "Job A",
      sessionKey: session,
      readableRoots: [drawingRoot],
      writableRoots: [runtimeRoot, ownResult],
    });

    try {
      const create = callbacks.get("file_create");
      const read = callbacks.get("file_read");
      const deleteFile = callbacks.get("file_delete");

      const created =
        await system.runWithJobSystemLease(
          lease,
          () =>
            create({
              path: path.join(
                runtimeRoot,
                "work.json"
              ),
              content: "{}\n",
            })
        );
      assert.equal(
        created.isError,
        undefined,
        JSON.stringify(created)
      );

      const ownRead =
        await system.runWithJobSystemLease(
          lease,
          () =>
            read({
              path: path.join(
                runtimeRoot,
                "work.json"
              ),
            })
        );
      const ownHash =
        ownRead.structuredContent?.data?.sha256;
      assert.equal(
        typeof ownHash,
        "string"
      );

      const staleDelete =
        await system.runWithJobSystemLease(
          lease,
          () =>
            deleteFile({
              path: path.join(
                runtimeRoot,
                "work.json"
              ),
              expected_sha256:
                "0".repeat(64),
            })
        );
      assert.equal(staleDelete.isError, true);
      assert.equal(
        await fs.readFile(
          path.join(
            runtimeRoot,
            "work.json"
          ),
          "utf8"
        ),
        "{}\n"
      );

      const deleted =
        await system.runWithJobSystemLease(
          lease,
          () =>
            deleteFile({
              path: path.join(
                runtimeRoot,
                "work.json"
              ),
              expected_sha256:
                ownHash,
            })
        );
      assert.equal(
        deleted.isError,
        undefined,
        JSON.stringify(deleted)
      );
      await assert.rejects(
        fs.stat(
          path.join(
            runtimeRoot,
            "work.json"
          )
        ),
        /ENOENT/
      );

      const directoryLikeFile =
        path.join(
          runtimeRoot,
          "folder.json"
        );
      await fs.mkdir(
        directoryLikeFile,
        { recursive: true }
      );
      const directoryDelete =
        await system.runWithJobSystemLease(
          lease,
          () =>
            deleteFile({
              path: directoryLikeFile,
              expected_sha256:
                "0".repeat(64),
            })
        );
      assert.equal(
        directoryDelete.isError,
        true
      );
      assert.match(
        JSON.stringify(directoryDelete),
        /FILE_DELETE_FILE_REQUIRED/
      );

      const crossWrite =
        await system.runWithJobSystemLease(
          lease,
          () =>
            create({
              path: path.join(
                otherResult,
                "should-block.json"
              ),
              content: "{}\n",
            })
        );
      assert.equal(crossWrite.isError, true);

      const crossRead =
        await system.runWithJobSystemLease(
          lease,
          () =>
            read({
              path: path.join(
                otherResult,
                "result.json"
              ),
            })
        );
      assert.equal(
        crossRead.isError,
        undefined,
        JSON.stringify(crossRead)
      );
      assert.match(
        crossRead.structuredContent?.data?.content ?? "",
        /other/
      );

      const otherHash =
        crossRead.structuredContent?.data?.sha256;
      const crossDelete =
        await system.runWithJobSystemLease(
          lease,
          () =>
            deleteFile({
              path: path.join(
                otherResult,
                "result.json"
              ),
              expected_sha256:
                otherHash,
            })
        );
      assert.equal(
        crossDelete.isError,
        true
      );
      assert.equal(
        await fs.readFile(
          path.join(
            otherResult,
            "result.json"
          ),
          "utf8"
        ),
        "{\"other\":true}\n"
      );
    } finally {
      system.releaseJobSystemLease(
        lease.tool_id,
        session
      );
    }
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
