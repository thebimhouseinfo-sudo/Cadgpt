import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("Add-in ticker lists both chats' Jobs for one Host-bound DWG, then removes each independently", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-ticker-cross-chat-"));
  const old = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const addin = await import("../dist/cadgpt/lib/addin-control.js");
  const binding = await import("../dist/cadgpt/session/drawing-binding.js");
  const metadata = await import("../dist/cadgpt/runtime/drawing-persistence.js");
  const jobs = await import("../dist/cadgpt/runtime/job-runtime.js");
  const system = await import("../dist/cadgpt/runtime/system-lease.js");
  const drawing = {
    drawing_id: "dwg_ticker", drawing_anchor: "TICKER-verified",
    anchor_verified_readback: true, anchor_schema_version: 1,
    execution_id: "chat-A-execution", name: "Shared.dwg",
    full_name: "C:/Drawings/Shared.dwg", host: "autocad",
    runtime_document_identity: "ticker-lifetime",
    document_selector: "C:/Drawings/Shared.dwg", bound_at: new Date().toISOString(),
  };
  const observerId = addin.registerAddinSessionObserver("chat-A", async () => ({
    drawing: { name: "Shared.dwg", full_name: drawing.full_name },
    bound_count: 1, human_power: false,
  }));
  const pair = addin.startAddinPairing();
  addin.completePendingAddinPair("chat-A");
  binding.selectPrimaryBoundDrawing(drawing);

  const resultRoot = path.join(root, "drawings", drawing.drawing_anchor);
  try {
    for (const [execution, jobName] of [["chat-A-execution", "create-system"], ["chat-B-execution", "mto"]]) {
      const attached = binding.attachPrimaryDrawingForExecution(execution);
      metadata.attachVerifiedDrawingMetadataReadOnly(execution, attached);
      const source = path.join(root, "workspace", "job-draft", jobName, "JOB.md");
      await fs.mkdir(path.dirname(source), { recursive: true });
      await fs.writeFile(source, "# Test Job");
      await jobs.prepareJobRuntimeForExecution(execution, jobName, source);
      await jobs.prepareJobResultLocationForExecution(execution, resultRoot);
    }
    const list = async () => (await addin.addinBindingStatus(pair.pair_id)).background_jobs.map(j => j.job_id).sort();
    assert.deepEqual(await list(), ["create-system", "mto"]);

    await jobs.cleanupJobRuntimeForExecution("chat-A-execution");
    assert.deepEqual(await list(), ["mto"], "Chat A job finish must not hide Chat B");
    const lease = system.acquireJobSystemLease({
      toolId: "create-system", jobId: "create-system", jobName: "Create System",
      sessionKey: "chat-A", readableRoots: [resultRoot], writableRoots: [],
    });
    assert.deepEqual(await list(), ["create-system", "mto"], "detached SYSTEM job is visible");
    system.releaseJobSystemLease(lease.tool_id, "chat-A");
    await jobs.cleanupJobRuntimeForExecution("chat-B-execution");
    assert.deepEqual(await list(), []);
  } finally {
    addin.unregisterAddinSessionObserver("chat-A", observerId);
    addin.releaseAddinPairing(pair.pair_id);
    await metadata.cleanupDrawingMetadataForExecution("chat-A-execution");
    await metadata.cleanupDrawingMetadataForExecution("chat-B-execution");
    if (old === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = old;
    await fs.rm(root, {recursive:true, force:true});
  }
});
