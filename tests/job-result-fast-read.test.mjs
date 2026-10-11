import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { registerJobResultAccessTools } from "../dist/cadgpt/tools/job-result-access.js";
import { registerJobResultPatchTools, registerJobResultBatchPatchTools } from "../dist/cadgpt/tools/job-result-patch.js";
import { installTrustedResultPatchApproval } from "../dist/cadgpt/runtime/result-patch-approval.js";
import * as work from "../dist/cadgpt/lib/work-registration.js";
import { checkAdmission, revokeSessionAdmissions } from "../dist/cadgpt/lib/admission.js";
import * as binding from "../dist/cadgpt/session/drawing-binding.js";
import { cadUpstream } from "../dist/cadgpt/runtime/cad-upstream.js";

test("stored metadata fast path uses verified Drawing Anchor without contacting CAD", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cg-v2-result-"));
  const oldRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const session = "v2-result-fast-read";
  checkAdmission(session, "@cg", "mention");
  const current = work.createWorkRegistration({
    sessionKey: session, ownerType: "file", ownerId: "v2-result", executionPath: "hybrid",
  });
  const callbacks = new Map();
  registerJobResultAccessTools({ registerTool(name, _cfg, fn) { callbacks.set(name, fn); } });
  registerJobResultPatchTools({ registerTool(name, _cfg, fn) { callbacks.set(name, fn); } });
  registerJobResultBatchPatchTools({ registerTool(name, _cfg, fn) { callbacks.set(name, fn); } });
  const original = cadUpstream.callTool;
  let cadCount = 0;
  cadUpstream.callTool = async (name) => {
    cadCount++;
    if (name === "acad_list_open_documents")
      return [{ name: "A.dwg", full_name: "/mock/A.dwg",
        runtime_document_id: "mock-1", host: "autocad" }];
    throw new Error("Unexpected CAD call: " + name);
  };
  try {
    const bound = await binding.bindDrawingForExecution(current.executionId, "/mock/A.dwg");
    bound.drawing_anchor = "anchor-verified";
    bound.anchor_verified_readback = true;
    const dir = path.join(root, "drawings", "anchor-verified", "jobs", "grille-tag-result");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "result.json"), JSON.stringify({ necksize: "300x300", grilles: [{ handle: "A1", necksize: "300x300" }, { handle: "A2", necksize: "300x300" }] }));
    const before = cadCount;
    const lease = work.acquireToolLease({
      sessionKey: session, executionId: current.executionId,
      authorityToken: current.authorityToken, tool: "file_job_result_read", family: "filesystem",
    });
    await work.runWithToolLease(lease, async () => {
      const listed = await callbacks.get("file_job_result_read")({ job_result: "grille-tag-result" });
      assert.equal(listed.structuredContent?.ok, true, JSON.stringify(listed));
      assert.deepEqual(listed.structuredContent.data.files, ["result.json"]);
      const read = await callbacks.get("file_job_result_read")({
        job_result: "grille-tag-result", relative_file: "result.json",
      });
      assert.equal(read.structuredContent?.ok, true, JSON.stringify(read));
      assert.equal(read.structuredContent.data.content.necksize, "300x300");
      assert.equal(read.structuredContent.data.source, "stored_metadata");
      const firstPatch = {
        job_result: "grille-tag-result", relative_file: "result.json",
        expected_sha256: read.structuredContent.data.sha256,
        field_path: ["necksize"], expected_previous_value: "300x300",
        new_value: "400x400",
      };
      const deniedWithoutHumanScope = await callbacks.get("file_job_result_patch")(firstPatch);
      assert.equal(deniedWithoutHumanScope.structuredContent?.ok, false);
      assert.match(JSON.stringify(deniedWithoutHumanScope), /JOB_RESULT_APPROVAL_REQUIRED/);
      installTrustedResultPatchApproval({
        execution_id: current.executionId,
        drawing_anchor: "anchor-verified",
        ...firstPatch,
        updates: [{
          field_path: firstPatch.field_path,
          expected_previous_value: firstPatch.expected_previous_value,
          new_value: firstPatch.new_value,
        }],
      });
      const patch = await callbacks.get("file_job_result_patch")({
        job_result: "grille-tag-result", relative_file: "result.json",
        expected_sha256: read.structuredContent.data.sha256,
        field_path: ["necksize"], expected_previous_value: "300x300",
        new_value: "400x400",
      });
      assert.equal(patch.structuredContent?.ok, true, JSON.stringify(patch));
      assert.equal(patch.structuredContent.data.cad_sync, "not_performed");
      const updated = JSON.parse(await fs.readFile(path.join(dir, "result.json"), "utf8"));
      assert.equal(updated.necksize, "400x400");
      // Regrant exactly the stale original request to reach the SHA CAS check.
      // Reusing the previous one-time grant would only test grant consumption.
      installTrustedResultPatchApproval({
        execution_id: current.executionId, drawing_anchor: "anchor-verified",
        ...firstPatch,
        updates: [{
          field_path: firstPatch.field_path,
          expected_previous_value: firstPatch.expected_previous_value,
          new_value: firstPatch.new_value,
        }],
      });
      const conflict = await callbacks.get("file_job_result_patch")({
        job_result: "grille-tag-result", relative_file: "result.json",
        expected_sha256: read.structuredContent.data.sha256,
        field_path: ["necksize"], expected_previous_value: "300x300",
        new_value: "500x500",
      });
      assert.equal(conflict.structuredContent?.ok, false, "stale SHA must not overwrite");
      assert.match(JSON.stringify(conflict), /RESOURCE_CONFLICT/);
      const approvedBatch = {
        job_result: "grille-tag-result", relative_file: "result.json",
        expected_sha256: patch.structuredContent.data.sha256,
        updates: [
          { field_path: ["grilles", "0", "necksize"], record_handle: "A1",
            expected_previous_value: "300x300", new_value: "400x400" },
          { field_path: ["grilles", "1", "necksize"], record_handle: "A2",
            expected_previous_value: "300x300", new_value: "400x400" },
        ],
      };
      installTrustedResultPatchApproval({
        execution_id: current.executionId, drawing_anchor: "anchor-verified",
        ...approvedBatch,
      });
      const outOfScope = await callbacks.get("file_job_result_patch_batch")({
        ...approvedBatch,
        updates: [{ field_path: ["grilles", "1", "necksize"],
          expected_previous_value: "300x300", new_value: "400x400" }],
      });
      assert.equal(outOfScope.structuredContent?.ok, false);
      assert.match(JSON.stringify(outOfScope), /JOB_RESULT_SCOPE_DENIED/);
      const batch = await callbacks.get("file_job_result_patch_batch")({
        job_result: "grille-tag-result", relative_file: "result.json",
        expected_sha256: patch.structuredContent.data.sha256,
        updates: [
          { field_path: ["grilles", "0", "necksize"], record_handle: "A1",
            expected_previous_value: "300x300", new_value: "400x400" },
          { field_path: ["grilles", "1", "necksize"], record_handle: "A2",
            expected_previous_value: "300x300", new_value: "400x400" },
        ],
      });
      assert.equal(batch.structuredContent?.ok, true, JSON.stringify(batch));
      assert.equal(batch.structuredContent.data.count, 2);
      const final = JSON.parse(await fs.readFile(path.join(dir, "result.json"), "utf8"));
      assert.deepEqual(final.grilles.map((g) => g.necksize), ["400x400", "400x400"]);
      const invalidBatch = await callbacks.get("file_job_result_patch_batch")({
        job_result: "grille-tag-result", relative_file: "result.json",
        expected_sha256: batch.structuredContent.data.sha256,
        updates: [
          { field_path: ["grilles", "0", "necksize"], record_handle: "A1",
            expected_previous_value: "400x400", new_value: "500x500" },
          { field_path: ["grilles", "1", "necksize"], record_handle: "WRONG",
            expected_previous_value: "400x400", new_value: "500x500" },
        ],
      });
      assert.equal(invalidBatch.structuredContent?.ok, false);
      const unchanged = JSON.parse(await fs.readFile(path.join(dir, "result.json"), "utf8"));
      assert.deepEqual(unchanged.grilles.map((g) => g.necksize), ["400x400", "400x400"]);


      const escaped = await callbacks.get("file_job_result_read")({
        job_result: "../grille-tag-result", relative_file: "result.json",
      });
      assert.equal(escaped.structuredContent?.ok, false);
      bound.anchor_verified_readback = false;
      const unverified = await callbacks.get("file_job_result_read")({
        job_result: "grille-tag-result", relative_file: "result.json",
      });
      assert.equal(unverified.structuredContent?.ok, false);
    });
    assert.equal(cadCount, before, "stored result must not activate CAD MCP");
  } finally {
    cadUpstream.callTool = original;
    work.releaseWorkRegistration(current.executionId, current.authorityToken, session);
    binding.clearExecutionDrawingContexts(current.executionId);
    revokeSessionAdmissions(session);
    if (oldRoot === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = oldRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
});
