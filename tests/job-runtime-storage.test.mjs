import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("Reasoning Job runtime isolates raw data and publishes only explicit final results", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-job-runtime-")
  );
  const previousRoot = process.env.CADGPT_APPDATA_ROOT;
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
  const { registerFilesystemTools } = await import(
    "../dist/cadgpt/tools/filesystem.js"
  );
  const { registerJobRuntimeTools } = await import(
    "../dist/cadgpt/tools/job-runtime.js"
  );
  const persistence = await import(
    "../dist/cadgpt/runtime/drawing-persistence.js"
  );
  const {
    resolveLispSourceForCommandDiscovery,
  } = await import("../dist/cadgpt/tools/cad-proxy.js");

  const sessionKey = "job-runtime-storage-test";
  checkAdmission(sessionKey, "@cg", "mention");

  let work;
  try {
    const registryRoot = path.join(tempRoot, "registry", "user");
    await fs.mkdir(registryRoot, { recursive: true });
    await fs.writeFile(
      path.join(registryRoot, "capabilities.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "job-a",
            kind: "job",
            library_id: "jobs",
            relative_path: "job-a/JOB.md",
            title: "Job A",
          },
          {
            id: "job-b",
            kind: "job",
            library_id: "jobs",
            relative_path: "job-b/JOB.md",
            title: "Job B",
          },
          {
            id: "direct-no-data",
            kind: "job",
            library_id: "jobs",
            relative_path: "direct-no-data/direct-no-data.py",
            title: "Direct",
          },
        ],
      }),
      "utf8"
    );

    registerFilesystemTools(fakeServer);
    registerJobRuntimeTools(fakeServer);

    const begin = callbacks.get("job_working_location");
    const end = callbacks.get("job_runtime_end");
    const publish = callbacks.get("job_publish_result");
    const fileCreate = callbacks.get("file_create");
    assert.ok(begin && end && publish && fileCreate);

    work = createWorkRegistration({
      sessionKey,
      ownerType: "direct-cad",
      ownerId: "drawing-workspace",
      executionPath: "hybrid",
    });

    const invoke = async (tool, family, args, targetId = family) => {
      const lease = acquireToolLease({
        tool,
        family,
        targetId,
        executionId: work.executionId,
        authorityToken: work.authorityToken,
        sessionKey,
      });
      return runWithToolLease(lease, () =>
        callbacks.get(tool)(args)
      );
    };

    const staleRoot = path.join(
      tempRoot,
      "workspace",
      "job-run",
      "stale-job",
      "orphaned"
    );
    await fs.mkdir(staleRoot, { recursive: true });
    await fs.writeFile(
      path.join(staleRoot, ".cadgpt-job-workspace.json"),
      JSON.stringify({
        version: 1,
        execution_id: "exec:dead",
        job_id: "stale-job",
        process_id: 99999999,
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(staleRoot, "raw.json"),
      "{}\n",
      "utf8"
    );

    const startedA = await invoke(
      "job_working_location",
      "job-authoring",
      { job_id: "job-a" },
      "job-a"
    );
    assert.equal(startedA.isError, undefined, JSON.stringify(startedA));
    assert.equal(
      await fs.stat(staleRoot).then(() => true, () => false),
      false,
      "starting any new Job run must prune orphaned raw workspace history"
    );
    const rootA = startedA.structuredContent.data.absolute_path;

    const runtimeLisp = path.join(
      rootA,
      "dynamic-lisp",
      "runtime.lsp"
    );
    await fs.mkdir(path.dirname(runtimeLisp), { recursive: true });
    await fs.writeFile(runtimeLisp, "(princ)\n", "utf8");
    const lispLease = acquireToolLease({
      tool: "job_dynamic_lisp_prepare",
      family: "job-authoring",
      targetId: runtimeLisp,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    const resolvedRuntimeLisp = await runWithToolLease(
      lispLease,
      () =>
        resolveLispSourceForCommandDiscovery(
          runtimeLisp
        )
    );
    assert.equal(
      resolvedRuntimeLisp,
      await fs.realpath(runtimeLisp)
    );

    const foreignRuntimeLisp = path.join(
      tempRoot,
      "workspace",
      "job-run",
      "job-b",
      "foreign-execution",
      "dynamic-lisp",
      "foreign.lsp"
    );
    await fs.mkdir(path.dirname(foreignRuntimeLisp), {
      recursive: true,
    });
    await fs.writeFile(
      foreignRuntimeLisp,
      "(princ)\n",
      "utf8"
    );
    const foreignLispLease = acquireToolLease({
      tool: "job_dynamic_lisp_prepare",
      family: "job-authoring",
      targetId: foreignRuntimeLisp,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    await assert.rejects(
      () =>
        runWithToolLease(
          foreignLispLease,
          () =>
            resolveLispSourceForCommandDiscovery(
              foreignRuntimeLisp
            )
        ),
      /JOB_RUNTIME_LISP_SCOPE/
    );

    const rawA = path.join(rootA, "raw.json");
    const createdA = await invoke(
      "file_create",
      "filesystem",
      { path: rawA, content: "{\"raw\":true}\n" },
      rawA
    );
    assert.equal(createdA.isError, undefined, JSON.stringify(createdA));

    const otherJobTarget = path.join(
      tempRoot,
      "workspace",
      "job-run",
      "job-b",
      "foreign.json"
    );
    const crossWrite = await invoke(
      "file_create",
      "filesystem",
      { path: otherJobTarget, content: "{}\n" },
      otherJobTarget
    );
    assert.equal(crossWrite.isError, true, JSON.stringify(crossWrite));
    assert.match(
      JSON.stringify(crossWrite),
      /outside CadGPT execution-authorized writable AppData/
    );

    const drawingRoot = path.join(
      tempRoot,
      "drawings",
      "anchor-a"
    );
    await fs.mkdir(drawingRoot, { recursive: true });
    persistence.authorizeDrawingMetadataRootForExecution(
      work.executionId,
      drawingRoot
    );

    const leakedRaw = path.join(drawingRoot, "raw-leak.json");
    const drawingWrite = await invoke(
      "file_create",
      "filesystem",
      { path: leakedRaw, content: "{}\n" },
      leakedRaw
    );
    assert.equal(drawingWrite.isError, true, JSON.stringify(drawingWrite));

    const finalSource = path.join(rootA, "final.json");
    await fs.writeFile(finalSource, "{\"ok\":true}\n", "utf8");
    const published = await invoke(
      "job_publish_result",
      "job-authoring",
      {
        source_path: finalSource,
        relative_path: "result.json",
      },
      finalSource
    );
    assert.equal(published.isError, undefined, JSON.stringify(published));
    assert.equal(
      await fs.readFile(
        path.join(drawingRoot, "job-a", "result.json"),
        "utf8"
      ),
      "{\"ok\":true}\n"
    );
    assert.equal(
      await fs.stat(leakedRaw).then(() => true, () => false),
      false
    );

    const startedB = await invoke(
      "job_working_location",
      "job-authoring",
      { job_id: "job-b" },
      "job-b"
    );
    assert.equal(startedB.isError, undefined, JSON.stringify(startedB));
    assert.equal(
      await fs.stat(rootA).then(() => true, () => false),
      false,
      "starting the next Job runtime on this execution must delete prior raw state"
    );

    const rootB = startedB.structuredContent.data.absolute_path;
    const directDenied = await invoke(
      "job_working_location",
      "job-authoring",
      { job_id: "direct-no-data" },
      "direct-no-data"
    );
    assert.equal(directDenied.isError, true, JSON.stringify(directDenied));
    assert.match(JSON.stringify(directDenied), /DIRECT_JOB_NO_DATA/);

    const ended = await invoke(
      "job_runtime_end",
      "job-authoring",
      { job_id: "job-b" },
      "job-b"
    );
    assert.equal(ended.isError, undefined, JSON.stringify(ended));
    assert.equal(
      await fs.stat(rootB).then(() => true, () => false),
      false
    );

    const draftPath = path.join(
      tempRoot,
      "workspace",
      "job-draft",
      "jobs",
      "draft-reasoning",
      "JOB.md"
    );
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(
      draftPath,
      "# Job: Draft Reasoning\n",
      "utf8"
    );
    const draftStarted = await invoke(
      "job_working_location",
      "job-authoring",
      {
        job_id: "draft-reasoning",
        draft_path: draftPath,
      },
      "draft-reasoning"
    );
    assert.equal(
      draftStarted.isError,
      undefined,
      JSON.stringify(draftStarted)
    );
    const draftRoot =
      draftStarted.structuredContent.data.absolute_path;

    const unknownNoDraft = await invoke(
      "job_working_location",
      "job-authoring",
      { job_id: "unknown-reasoning" },
      "unknown-reasoning"
    );
    assert.equal(
      unknownNoDraft.isError,
      true,
      JSON.stringify(unknownNoDraft)
    );
    assert.match(
      JSON.stringify(unknownNoDraft),
      /JOB_DRAFT_PATH_REQUIRED/
    );

    const directDraftPath = path.join(
      tempRoot,
      "workspace",
      "job-draft",
      "jobs",
      "draft-direct",
      "draft-direct.py"
    );
    await fs.mkdir(path.dirname(directDraftPath), {
      recursive: true,
    });
    await fs.writeFile(
      directDraftPath,
      "print('direct')\n",
      "utf8"
    );
    const directDraftDenied = await invoke(
      "job_working_location",
      "job-authoring",
      {
        job_id: "draft-direct",
        draft_path: directDraftPath,
      },
      "draft-direct"
    );
    assert.equal(
      directDraftDenied.isError,
      true,
      JSON.stringify(directDraftDenied)
    );
    assert.match(
      JSON.stringify(directDraftDenied),
      /JOB_DRAFT_REASONING_REQUIRED/
    );

    const draftEnded = await invoke(
      "job_runtime_end",
      "job-authoring",
      { job_id: "draft-reasoning" },
      "draft-reasoning"
    );
    assert.equal(
      draftEnded.isError,
      undefined,
      JSON.stringify(draftEnded)
    );
    assert.equal(
      await fs.stat(draftRoot).then(() => true, () => false),
      false
    );

    releaseWorkRegistration(
      work.executionId,
      work.authorityToken,
      sessionKey
    );
    work = null;
  } finally {
    if (work) {
      try {
        releaseWorkRegistration(
          work.executionId,
          work.authorityToken,
          sessionKey
        );
      } catch {}
    }
    revokeSessionAdmissions(sessionKey);
    if (previousRoot === undefined) {
      delete process.env.CADGPT_APPDATA_ROOT;
    } else {
      process.env.CADGPT_APPDATA_ROOT = previousRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("Job workspace authority transfers across FILE to HYBRID successor without deleting current-run data", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-job-transfer-")
  );
  const previousRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const {
    checkAdmission,
    revokeSessionAdmissions,
  } = await import("../dist/cadgpt/lib/admission.js");
  const {
    createSuccessorWorkRegistration,
    createWorkRegistration,
    commitSuccessorWorkRegistration,
    releaseWorkRegistration,
  } = await import(
    "../dist/cadgpt/lib/work-registration.js"
  );
  const workspace = await import(
    "../dist/cadgpt/runtime/job-workspace.js"
  );

  const sessionKey = "job-runtime-transfer-test";
  checkAdmission(sessionKey, "@cg", "mention");

  let successor;
  try {
    const first = createWorkRegistration({
      sessionKey,
      ownerType: "job",
      ownerId: "job-a",
      executionPath: "file",
    });
    const state = await workspace.beginJobWorkspaceForExecution(
      first.executionId,
      "job-a"
    );
    const raw = path.join(state.root, "raw.json");
    await fs.writeFile(raw, "{}\n", "utf8");

    const staged = createSuccessorWorkRegistration({
      previousExecutionId: first.executionId,
      authorityToken: first.authorityToken,
      sessionKey,
      executionPath: "hybrid",
    });
    successor = commitSuccessorWorkRegistration({
      previousExecutionId: first.executionId,
      previousAuthorityToken: first.authorityToken,
      successorExecutionId: staged.executionId,
      successorAuthorityToken: staged.authorityToken,
      sessionKey,
    });
    const transferred = await workspace.transferJobWorkspaceForExecution(
      first.executionId,
      successor.executionId
    );
    assert.equal(transferred, true);

    const oldCleanup = await workspace.cleanupJobWorkspaceForExecution(
      first.executionId
    );
    assert.equal(oldCleanup.deleted, false);
    assert.equal(await fs.readFile(raw, "utf8"), "{}\n");

    const successorState = workspace.jobWorkspaceForExecution(
      successor.executionId
    );
    assert.equal(successorState?.root, state.root);

    const finalCleanup = await workspace.cleanupJobWorkspaceForExecution(
      successor.executionId
    );
    assert.equal(finalCleanup.deleted, true);
    assert.equal(
      await fs.stat(state.root).then(() => true, () => false),
      false
    );

    releaseWorkRegistration(
      successor.executionId,
      successor.authorityToken,
      sessionKey
    );
    successor = null;
  } finally {
    if (successor) {
      try {
        releaseWorkRegistration(
          successor.executionId,
          successor.authorityToken,
          sessionKey
        );
      } catch {}
    }
    revokeSessionAdmissions(sessionKey);
    if (previousRoot === undefined) {
      delete process.env.CADGPT_APPDATA_ROOT;
    } else {
      process.env.CADGPT_APPDATA_ROOT = previousRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
