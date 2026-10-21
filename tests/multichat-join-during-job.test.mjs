import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("four new chat bindings do not wait for a running CAD Job or change its runtime", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-five-chats-"));
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  let releaseCad;
  try {
    const { withCadHostLock } = await import("../dist/cadgpt/runtime/cad-scheduler.js");
    const binding = await import("../dist/cadgpt/session/drawing-binding.js");
    const runtime = await import("../dist/cadgpt/runtime/job-runtime.js");
    const work = await import("../dist/cadgpt/lib/work-registration.js");
    const original = {
      drawing_id: "dwg_owner",
      drawing_anchor: "stable-anchor",
      anchor_verified_readback: true,
      anchor_schema_version: 1,
      execution_id: "job-chat-1",
      name: "before.dwg",
      full_name: "C:/before.dwg",
      host: "autocad",
      runtime_document_identity: "host-document-1",
      document_selector: "C:/before.dwg",
      bound_at: new Date().toISOString(),
    };
    binding.selectPrimaryBoundDrawing(original);
    const jobFile = path.join(root, "libraries", "jobs", "fixture", "active-job", "JOB.md");
    await fs.mkdir(path.dirname(jobFile), { recursive: true });
    await fs.writeFile(jobFile, "# Active job\n");
    const running = await runtime.prepareJobRuntimeForExecution("job-chat-1", "active-job", jobFile);
    await fs.writeFile(path.join(running.runtime_root, "pending.json"), '{"working":true}');
    let occupied;
    const occupiedSignal = new Promise(resolve => { occupied = resolve; });
    const cadTool = withCadHostLock("autocad", async () => {
      occupied();
      await new Promise(resolve => { releaseCad = resolve; });
    });
    await occupiedSignal;
    try {
      // The CAD host queue remains occupied until AFTER all four joins finish.
      // Any accidental host-lock use during join would deadlock this test.
      const sessions = ["chat-2", "chat-3", "chat-4", "chat-5"];
      const registrations = sessions.map(sessionKey => work.createWorkRegistration({
        sessionKey, ownerType: "direct-cad", ownerId: "drawing-workspace", executionPath: "hybrid",
      }));
      const joined = await Promise.all(registrations.map(async item =>
        binding.attachPrimaryDrawingForExecution(item.executionId)
      ));
      for (const item of joined) {
        assert.equal(item.drawing_anchor, "stable-anchor");
        assert.equal(item.runtime_document_identity, "host-document-1");
        assert.equal(item.anchor_verified_readback, true);
      }
      assert.equal(new Set(registrations.map(item => item.executionId)).size, 4);
      assert.equal(binding.primaryBoundDrawing().execution_id, "job-chat-1");
      assert.equal(runtime.activeJobRuntimeForExecution("job-chat-1"), running);
      assert.equal(await fs.readFile(path.join(running.runtime_root, "pending.json"), "utf8"), '{"working":true}');
      for (const item of registrations) {
        binding.clearExecutionDrawingContexts(item.executionId);
        work.releaseSessionWork(item.sessionKey);
      }
      assert.equal(runtime.activeJobRuntimeForExecution("job-chat-1"), running);
    } finally {
      releaseCad();
      await cadTool;
    }
    await runtime.cleanupJobRuntimeForExecution("job-chat-1");
  } finally {
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
