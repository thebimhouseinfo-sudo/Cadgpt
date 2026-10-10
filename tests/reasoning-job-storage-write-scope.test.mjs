import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("Reasoning Job can READ authorized other folders but WRITE only its own runtime and Drawing Anchor result", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-reasoning-write-"));
  const prior = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const { checkAdmission, revokeSessionAdmissions } = await import("../dist/cadgpt/lib/admission.js");
  const w = await import("../dist/cadgpt/lib/work-registration.js");
  const runtime = await import("../dist/cadgpt/runtime/job-runtime.js");
  const drawing = await import("../dist/cadgpt/runtime/drawing-persistence.js");
  const { registerFilesystemTools } = await import("../dist/cadgpt/tools/filesystem.js");
  const { cleanupExecutionState } = await import("../dist/cadgpt/runtime/execution-cleanup.js");
  const handlers = new Map();
  registerFilesystemTools({ registerTool(name, _cfg, handler) { handlers.set(name, handler); } });
  const session = "reasoning-storage-" + path.basename(root);
  let work;
  checkAdmission(session, "@cg", "mention");
  try {
    const jobDir = path.join(root, "libraries", "jobs", "fixture", "grille-tag");
    const siblingDir = path.join(root, "libraries", "jobs", "fixture", "mto");
    const generalDir = path.join(root, "workspace", "general");
    const globalDir = path.join(root, "data", "common");
    const jobFile = path.join(jobDir, "JOB.md");
    const siblingInput = path.join(siblingDir, "runtime", "prior.json");
    const referenceFile = path.join(globalDir, "evidence.json");
    const drawingRoot = path.join(root, "drawings", "test-anchor");
    const otherResult = path.join(drawingRoot, "jobs", "mto-result");
    const otherPath = path.join(drawingRoot, "systems", "system.json");
    for (const folder of [jobDir, path.dirname(siblingInput), generalDir, globalDir, otherResult, path.dirname(otherPath)]) {
      await fs.mkdir(folder, { recursive: true });
    }
    await fs.writeFile(jobFile, "# Grille Tag\n## Steps\n", "utf8");
    await fs.writeFile(siblingInput, "{\"readonly\":true}", "utf8");
    await fs.writeFile(referenceFile, "{\"reference\":true}", "utf8");
    await fs.writeFile(otherPath, "{\"other\":true}", "utf8");

    work = w.createWorkRegistration({ sessionKey: session, ownerType: "job", ownerId: "grille-tag", executionPath: "hybrid" });
    const run = (tool, args={}) => {
      const lease = w.acquireToolLease({ tool, family: "filesystem", sessionKey: session,
        executionId: work.executionId, authorityToken: work.authorityToken });
      return w.runWithToolLease(lease, () => handlers.get(tool)(args));
    };
    const prepared = await runtime.prepareJobRuntimeForExecution(work.executionId, "grille-tag", jobFile);
    assert.equal(runtime.reasoningJobStorageScopeWasEntered(work.executionId), true);
    const raw = path.join(prepared.runtime_root, "raw-data.json");

    const outsideBeforeResult = await run("file_create", { path: path.join(drawingRoot, "rogue.json"), content: "{}" });
    assert.equal(outsideBeforeResult.isError, true, "drawing root must not be writable just because drawing exists");

    drawing.authorizeDrawingMetadataRootForExecution(work.executionId, drawingRoot);
    const result = await runtime.prepareJobResultLocationForExecution(work.executionId, drawingRoot);
    assert.equal(result.absolute_path, path.join(drawingRoot, "jobs", "grille-tag-result"));

    for (const target of [raw, path.join(result.absolute_path, "grilles.json")]) {
      const accepted = await run("file_create", { path: target, content: "{\"value\":1}" });
      assert.equal(accepted.isError, undefined, JSON.stringify(accepted));
      assert.equal(await fs.readFile(target, "utf8"), "{\"value\":1}");
    }
    for (const target of [
      path.join(generalDir, "outside.json"),
      path.join(globalDir, "outside.json"),
      path.join(siblingDir, "runtime", "outside.json"),
      path.join(drawingRoot, "rogue.json"),
      path.join(otherResult, "rogue.json"),
      path.join(jobDir, "lisp", "rogue.lsp"),
      path.join(root, "workspace", "job-draft", "outside.json"),
    ]) {
      const rejected = await run("file_create", { path: target, content: "{}" });
      assert.equal(rejected.isError, true, "WRITE must fail outside own runtime/result: " + target);
      await assert.rejects(fs.stat(target), /ENOENT/);
    }

    for (const file of [siblingInput, referenceFile, otherPath]) {
      const readable = await run("file_read", { path: file });
      assert.equal(readable.isError, undefined, "READ authorized source should still work: " + file + " " + JSON.stringify(readable));
    }

    const roots = await run("file_roots");
    assert.equal(roots.structuredContent?.data?.absolute_writable_roots?.length, 2);
    assert.deepEqual(new Set(roots.structuredContent.data.absolute_writable_roots),
      new Set([prepared.runtime_root, result.absolute_path]));

    await runtime.cleanupJobRuntimeForExecution(work.executionId);
    const after = await run("file_roots");
    assert.deepEqual(after.structuredContent.data.absolute_writable_roots, [],
      "Job finish must not restore broad workspace/data/drawing root write authority");
    assert.equal((await run("file_create", { path: path.join(generalDir, "after-finish.json"), content: "{}" })).isError, true);
    assert.equal((await run("file_read", { path: referenceFile })).isError, undefined);
    await cleanupExecutionState(work.executionId);
    assert.equal(runtime.reasoningJobStorageScopeWasEntered(work.executionId), false);
  } finally {
    if (work && w.activeExecutionForSession(session)) w.releaseWorkRegistration(work.executionId, work.authorityToken, session);
    revokeSessionAdmissions(session);
    if (prior === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = prior;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Direct Job uses its existing fixed runtime semantics, without Reasoning Job write marker", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-direct-boundary-"));
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const runtime = await import("../dist/cadgpt/runtime/job-runtime.js");
  try {
    const job = path.join(root, "libraries", "jobs", "fixture", "direct", "direct.py");
    await fs.mkdir(path.dirname(job), { recursive: true });
    await fs.writeFile(job, "print('fixed')\n", "utf8");
    const first = await runtime.prepareJobRuntimeForExecution("direct-fixture", "fixed", job, { resetRuntime: true });
    assert.equal(first.runtime_reset, true);
    assert.equal(runtime.reasoningJobStorageScopeWasEntered("direct-fixture"), false);
    await fs.writeFile(path.join(first.runtime_root, "stale.json"), "old", "utf8");
    await runtime.cleanupJobRuntimeForExecution("direct-fixture");
    const second = await runtime.prepareJobRuntimeForExecution("direct-fixture", "fixed", job, { resetRuntime: true });
    await assert.rejects(fs.stat(path.join(second.runtime_root, "stale.json")), /ENOENT/);
    assert.equal(runtime.reasoningJobStorageScopeWasEntered("direct-fixture"), false);
    await runtime.cleanupJobRuntimeForExecution("direct-fixture");
  } finally {
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
