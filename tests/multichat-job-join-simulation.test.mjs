import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("chat 2–5 join the same Anchor while chat 1 Job holds CAD host", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-join-running-job-"));
  const before = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const binding = await import("../dist/cadgpt/session/drawing-binding.js");
  const metadata = await import("../dist/cadgpt/runtime/drawing-persistence.js");
  const runtime = await import("../dist/cadgpt/runtime/job-runtime.js");
  const { withCadHostLock } = await import("../dist/cadgpt/runtime/cad-scheduler.js");
  const anchor = "MULTICHAT-TEST-ANCHOR";
  const first = {
    drawing_id: "first", drawing_anchor: anchor, anchor_verified_readback: true,
    anchor_schema_version: 1, execution_id: "chat-1", name: "model.dwg",
    full_name: "C:/Model/model.dwg", host: "autocad", runtime_document_identity: "host-life-1",
    document_selector: "C:/Model/model.dwg", bound_at: new Date().toISOString(),
  };
  let releaseJob;
  let enteredJob;
  const jobEntered = new Promise(resolve => { enteredJob = resolve; });
  const jobCanFinish = new Promise(resolve => { releaseJob = resolve; });
  let finished = false;
  let pendingJob;
  try {
    binding.selectPrimaryBoundDrawing(first);
    const file = path.join(root, "libraries", "jobs", "test", "active", "JOB.md");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "# Active Job\n");
    const job = await runtime.prepareJobRuntimeForExecution("chat-1", "active", file);
    const raw = path.join(job.runtime_root, "raw.json");
    await fs.writeFile(raw, '{"in_progress":true}');
    pendingJob = withCadHostLock("autocad", async () => {
      enteredJob();
      await jobCanFinish;
      finished = true;
    });
    await jobEntered;
    const source = await fs.readFile(new URL("../src/cadgpt/server-factory.ts", import.meta.url), "utf8");
    const entry = source.slice(source.indexOf("const activateCadWorkspace = async"), source.indexOf("const addinObserverId ="));
    assert.match(entry, /const bound = joinExistingHost/);
    assert.match(entry, /attachPrimaryDrawingForExecution\(work\.executionId\)/);
    const joining = ["chat-2", "chat-3", "chat-4", "chat-5"];
    // Mirror actual joinExistingHost branch: local attachment and read-only metadata only.
    for (const id of joining) {
      const attached = binding.attachPrimaryDrawingForExecution(id);
      assert.equal(attached.drawing_anchor, anchor);
      assert.equal(attached.runtime_document_identity, first.runtime_document_identity);
      metadata.attachVerifiedDrawingMetadataReadOnly(id, attached);
      assert.deepEqual(metadata.drawingMetadataWritableRootsForExecution(id), []);
      assert.equal(finished, false, "joining must not require the Job to finish");
      assert.equal(runtime.activeJobRuntimeForExecution("chat-1")?.job_id, "active");
      assert.equal(await fs.readFile(raw, "utf8"), '{"in_progress":true}');
    }
    // Closing chat 2 affects only its metadata and drawing reference.
    await metadata.cleanupDrawingMetadataForExecution("chat-2");
    binding.clearExecutionDrawingContexts("chat-2");
    assert.equal(runtime.activeJobRuntimeForExecution("chat-1")?.job_id, "active");
    assert.equal(binding.primaryBoundDrawing()?.drawing_anchor, anchor);
    assert.equal(finished, false);
    for (const id of joining.slice(1)) {
      assert.equal(metadata.drawingMetadataRootsForExecution(id).length, 1);
    }
    releaseJob();
    await pendingJob;
    assert.equal(finished, true);
    assert.equal(await fs.readFile(raw, "utf8"), '{"in_progress":true}');
    await runtime.cleanupJobRuntimeForExecution("chat-1");
  } finally {
    releaseJob?.();
    await pendingJob?.catch(() => {});
    for (const id of ["chat-2", "chat-3", "chat-4", "chat-5"]) {
      await metadata.cleanupDrawingMetadataForExecution(id);
      binding.clearExecutionDrawingContexts(id);
    }
    if (before === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = before;
    await fs.rm(root, { recursive: true, force: true });
  }
});
