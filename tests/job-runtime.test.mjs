import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("active Job runtime resets scratch and narrows file writes to its runtime/result roots", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-job-runtime-")
  );
  const previous =
    process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const callbacks = new Map();
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
      return { remove() {} };
    },
  };

  const {
    checkAdmission,
    revokeSessionAdmissions,
  } = await import("../dist/cadgpt/lib/admission.js");
  const {
    acquireToolLease,
    createWorkRegistration,
    releaseWorkRegistration,
    runWithToolLease,
  } = await import(
    "../dist/cadgpt/lib/work-registration.js"
  );
  const {
    registerFilesystemTools,
  } = await import(
    "../dist/cadgpt/tools/filesystem.js"
  );
  const jobRuntime = await import(
    "../dist/cadgpt/runtime/job-runtime.js"
  );
  const drawingPersistence = await import(
    "../dist/cadgpt/runtime/drawing-persistence.js"
  );

  const sessionKey = "job-runtime-test";
  checkAdmission(sessionKey, "@cg", "mention");

  try {
    const jobA = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "fixture-lib",
      "job-a",
      "JOB.md"
    );
    const jobBRoot = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "fixture-lib",
      "job-b"
    );
    await fs.mkdir(path.dirname(jobA), {
      recursive: true,
    });
    await fs.mkdir(jobBRoot, {
      recursive: true,
    });
    await fs.writeFile(jobA, "# Job: A\n", "utf8");
    await fs.writeFile(
      path.join(jobBRoot, "JOB.md"),
      "# Job: B\n",
      "utf8"
    );

    registerFilesystemTools(fakeServer);
    const fileCreate = callbacks.get("file_create");
    assert.equal(typeof fileCreate, "function");

    const work = createWorkRegistration({
      sessionKey,
      ownerType: "job",
      ownerId: "job-a",
      executionPath: "file",
    });

    const runtime =
      await jobRuntime.prepareJobRuntimeForExecution(
        work.executionId,
        "job-a",
        jobA
      );
    assert.equal(
      path.resolve(runtime.runtime_root),
      path.resolve(
        path.join(path.dirname(jobA), "runtime")
      )
    );

    await fs.writeFile(
      path.join(runtime.runtime_root, "stale.txt"),
      "stale",
      "utf8"
    );
    const reset =
      await jobRuntime.prepareJobRuntimeForExecution(
        work.executionId,
        "job-a",
        jobA
      );
    assert.equal(
      await fs.stat(
        path.join(reset.runtime_root, "stale.txt")
      ).then(() => true, () => false),
      false
    );

    const runtimeLease = acquireToolLease({
      tool: "file_create",
      family: "filesystem",
      targetId: reset.runtime_root,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    const runtimeFile = path.join(
      reset.runtime_root,
      "raw.json"
    );
    const created = await runWithToolLease(
      runtimeLease,
      () =>
        fileCreate({
          path: runtimeFile,
          content: "{\"ok\":true}\n",
        })
    );
    assert.equal(
      created.isError,
      undefined,
      JSON.stringify(created)
    );

    const otherRuntime = path.join(
      jobBRoot,
      "runtime"
    );
    await fs.mkdir(otherRuntime, {
      recursive: true,
    });
    const deniedLease = acquireToolLease({
      tool: "file_create",
      family: "filesystem",
      targetId: otherRuntime,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    const denied = await runWithToolLease(
      deniedLease,
      () =>
        fileCreate({
          path: path.join(
            otherRuntime,
            "cross-job.json"
          ),
          content: "{}\n",
        })
    );
    assert.equal(denied.isError, true);
    assert.match(
      JSON.stringify(denied),
      /outside CadGPT execution-authorized writable AppData/
    );

    const drawingRoot = path.join(
      tempRoot,
      "drawings",
      "anchor-a"
    );
    await fs.mkdir(drawingRoot, {
      recursive: true,
    });
    drawingPersistence.authorizeDrawingMetadataRootForExecution(
      work.executionId,
      drawingRoot
    );
    const result =
      await jobRuntime.prepareJobResultLocationForExecution(
        work.executionId,
        drawingRoot
      );
    assert.equal(
      path.resolve(result.absolute_path),
      path.resolve(
        path.join(
          drawingRoot,
          "jobs",
          "job-a-result"
        )
      )
    );

    const resultLease = acquireToolLease({
      tool: "file_create",
      family: "filesystem",
      targetId: result.absolute_path,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    const finalFile = path.join(
      result.absolute_path,
      "result.json"
    );
    const finalCreated =
      await runWithToolLease(
        resultLease,
        () =>
          fileCreate({
            path: finalFile,
            content: "{\"final\":true}\n",
          })
      );
    assert.equal(
      finalCreated.isError,
      undefined,
      JSON.stringify(finalCreated)
    );

    const rootWriteLease = acquireToolLease({
      tool: "file_create",
      family: "filesystem",
      targetId: drawingRoot,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    const rootWrite =
      await runWithToolLease(
        rootWriteLease,
        () =>
          fileCreate({
            path: path.join(
              drawingRoot,
              "raw-should-not-live-here.json"
            ),
            content: "{}\n",
          })
      );
    assert.equal(rootWrite.isError, true);

    await jobRuntime.cleanupJobRuntimeForExecution(
      work.executionId
    );
    assert.equal(
      await fs.stat(finalFile).then(
        () => true,
        () => false
      ),
      true
    );

    releaseWorkRegistration(
      work.executionId,
      work.authorityToken,
      sessionKey
    );
  } finally {
    revokeSessionAdmissions(sessionKey);
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

test("empty Job result namespace is removed before empty drawing-root cleanup", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-job-result-empty-")
  );
  const previous =
    process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  try {
    const jobRuntime = await import(
      "../dist/cadgpt/runtime/job-runtime.js"
    );
    const drawingPersistence = await import(
      "../dist/cadgpt/runtime/drawing-persistence.js"
    );

    const executionId = "job-empty-result";
    const jobFile = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "fixture-lib",
      "empty-job",
      "JOB.md"
    );
    const drawingRoot = path.join(
      tempRoot,
      "drawings",
      "empty-anchor"
    );
    await fs.mkdir(path.dirname(jobFile), {
      recursive: true,
    });
    await fs.writeFile(
      jobFile,
      "# Job: Empty\n",
      "utf8"
    );
    await fs.mkdir(drawingRoot, {
      recursive: true,
    });
    drawingPersistence.registerCreatedDrawingMetadataFolderForExecution(
      executionId,
      drawingRoot
    );

    await jobRuntime.prepareJobRuntimeForExecution(
      executionId,
      "empty-job",
      jobFile
    );
    const result =
      await jobRuntime.prepareJobResultLocationForExecution(
        executionId,
        drawingRoot
      );
    assert.equal(
      await fs.stat(result.absolute_path).then(
        () => true,
        () => false
      ),
      true
    );

    await jobRuntime.cleanupJobRuntimeForExecution(
      executionId
    );
    assert.equal(
      await fs.stat(result.absolute_path).then(
        () => true,
        () => false
      ),
      false
    );
    assert.equal(
      await fs.stat(
        path.join(drawingRoot, "jobs")
      ).then(() => true, () => false),
      false
    );

    const cleaned =
      await drawingPersistence.cleanupDrawingMetadataForExecution(
        executionId
      );
    assert.equal(cleaned.deleted_empty, true);
    assert.equal(
      await fs.stat(drawingRoot).then(
        () => true,
        () => false
      ),
      false
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
