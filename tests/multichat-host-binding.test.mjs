import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("different chats share one verified Host drawing but not file-write authority", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-cross-chat-"));
  const saved = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const binding = await import("../dist/cadgpt/session/drawing-binding.js");
  const metadata = await import("../dist/cadgpt/runtime/drawing-persistence.js");
  const jobs = await import("../dist/cadgpt/runtime/job-runtime.js");
  const anchor = "MAGS-verified-anchor";
  const a = {
    drawing_id: "dwg_a",
    drawing_anchor: anchor,
    anchor_verified_readback: true,
    anchor_schema_version: 1,
    execution_id: "exec-chat-A",
    name: "MAGS.dwg",
    full_name: "C:/Project/MAGS.dwg",
    host: "autocad",
    runtime_document_identity: "runtime-life-1",
    document_selector: "C:/Project/MAGS.dwg",
    bound_at: new Date().toISOString(),
  };

  try {
    const drawingRoot = path.join(root, "drawings", anchor);
    const sourceResult = path.join(drawingRoot, "jobs", "create-system-result", "system.json");
    await fs.mkdir(path.dirname(sourceResult), { recursive: true });
    await fs.writeFile(sourceResult, '{"FCU-1":"S1"}');

    binding.selectPrimaryBoundDrawing(a);
    const b = binding.attachPrimaryDrawingForExecution("exec-chat-B");
    assert.equal(b?.runtime_document_identity, a.runtime_document_identity);
    assert.equal(b?.drawing_anchor, anchor);
    assert.equal(binding.primaryBoundDrawing()?.execution_id, a.execution_id);
    const readRoot = metadata.attachVerifiedDrawingMetadataReadOnly("exec-chat-B", b);
    assert.equal(readRoot, drawingRoot);
    assert.deepEqual(metadata.drawingMetadataRootsForExecution("exec-chat-B"), [drawingRoot]);
    assert.deepEqual(metadata.drawingMetadataWritableRootsForExecution("exec-chat-B"), []);
    assert.equal(await fs.readFile(sourceResult, "utf8"), '{"FCU-1":"S1"}');

    assert.throws(
      () => metadata.attachVerifiedDrawingMetadataReadOnly("exec-chat-C", {
        ...b, drawing_anchor: "wrong-anchor",
      }),
      /DRAWING_METADATA_HOST_MISMATCH/
    );
    assert.throws(
      () => metadata.attachVerifiedDrawingMetadataReadOnly("exec-chat-C", {
        ...b, anchor_verified_readback: false,
      }),
      /DRAWING_METADATA_BINDING_UNVERIFIED/
    );
    assert.deepEqual(metadata.drawingMetadataRootsForExecution("exec-chat-C"), []);

    const draft = path.join(root, "workspace", "job-draft", "mto", "JOB.md");
    await fs.mkdir(path.dirname(draft), { recursive: true });
    await fs.writeFile(draft, "# MTO\\n## Validation\\n");
    const run = await jobs.prepareJobRuntimeForExecution("exec-chat-B", "mto", draft);
    const result = await jobs.prepareJobResultLocationForExecution("exec-chat-B", readRoot);
    assert.equal(result.path.includes("mto-result"), true);
    assert.equal(jobs.jobRuntimeWritableRootsForExecution("exec-chat-B").includes(result.absolute_path), true);
    assert.equal(jobs.jobRuntimeWritableRootsForExecution("exec-chat-B").includes(path.dirname(sourceResult)), false);
    await fs.writeFile(path.join(result.absolute_path, "takeoff.json"), '{"rows":1}');

    // Finishing A must not transfer/revoke B's read permission or result files.
    metadata.registerCreatedDrawingMetadataFolderForExecution("exec-chat-A", drawingRoot);
    const cleanupA = await metadata.cleanupDrawingMetadataForExecution("exec-chat-A");
    assert.equal(cleanupA.shared_in_use, true, "creator cleanup must preserve a root still shared by B");
    assert.deepEqual(metadata.drawingMetadataRootsForExecution("exec-chat-B"), [drawingRoot]);
    assert.equal(await fs.readFile(sourceResult, "utf8"), '{"FCU-1":"S1"}');
    await jobs.cleanupJobRuntimeForExecution(run.execution_id);
    assert.equal(await fs.readFile(path.join(result.absolute_path, "takeoff.json"), "utf8"), '{"rows":1}');
    await metadata.cleanupDrawingMetadataForExecution("exec-chat-B");
  } finally {
    binding.clearExecutionDrawingContexts("exec-chat-B");
    if (saved === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
});
