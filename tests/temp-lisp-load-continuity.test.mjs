import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { checkAdmission, revokeSessionAdmissions } from "../dist/cadgpt/lib/admission.js";
import * as work from "../dist/cadgpt/lib/work-registration.js";
import { cadUpstream } from "../dist/cadgpt/runtime/cad-upstream.js";
import {
  registerCadProxyTools,
  cadProxySurfaceSnapshot,
  clearExecutionCadProxyState,
} from "../dist/cadgpt/tools/cad-proxy.js";
import { registerTempLispTools, cleanupTempLispForWork } from "../dist/cadgpt/tools/temp-lisp.js";
import {
  bindDrawingForExecution,
  clearExecutionDrawingContexts,
} from "../dist/cadgpt/session/drawing-binding.js";

test("one-off Temp Lisp: real named proxy, same Work, error → new UUID → verified load → queued → explicit cleanup", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cg-temp-cad-load-"));
  const oldAppData = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tmp;
  const session = "temp-lisp-continuity-fixture";
  const document = { name: "Fixture.dwg", full_name: "C:/Tests/Fixture.dwg", runtime_document_id: "runtime-fixture-001", host: "autocad" };
  const oldStatus = cadUpstream.status, oldCallTool = cadUpstream.callTool;
  const calls = [];
  let mockExecutionCompleted = false;
  const callbacks = new Map();
  const server = {
    registerTool(name, config, callback) {
      callbacks.set(name, { callback, config });
      return { remove() { callbacks.delete(name); } };
    },
  };

  // The backend alone is fake: outer proxy discovery, path policy, ToolLease and
  // drawing lifetime validation all execute their real production code.
  cadUpstream.status = () => ({ enabled: true, connected: true, phase: "active", tool_count: 5 });
  cadUpstream.callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === "acad_list_open_documents") return { structuredContent: { documents: [document] } };
    if (name === "acad_set_active_document") return { structuredContent: { runtime_document_id: document.runtime_document_id } };
    if (name === "cad_load_lisp_file") {
      const data = await fs.readFile(args.path, "utf8");
      if (data.includes("BAD_SOURCE")) {
        return { structuredContent: { loaded: false, error: "AutoLISP execution failed: BAD_SOURCE", log_tail: "BAD_SOURCE" } };
      }
      if (data.includes("UNKNOWN_RESULT")) {
        return { structuredContent: { note: "AutoCAD has not confirmed a load result" } };
      }
      return { structuredContent: { loaded: true, error: null, path: args.path } };
    }
    if (name === "cad_run_lisp_command") {
      return { structuredContent: { queued: true, completion_verified: false, execution_status: "QUEUED" } };
    }
    if (name === "cad_list_layers") {
      return { structuredContent: { layers: mockExecutionCompleted ? [{ name: "CGTEMP_RESULT" }] : [] } };
    }
    throw new Error("unexpected mock backend call: " + name);
  };

  let current = null;
  try {
    checkAdmission(session, "@cg", "mention");
    current = work.createWorkRegistration({ sessionKey: session, ownerType: "file", ownerId: "disposal-one-off", executionPath: "hybrid" });
    registerTempLispTools(server);
    registerCadProxyTools(server);

    const listed = cadProxySurfaceSnapshot(server).tools;
    assert.ok(listed.includes("cad__cad_load_lisp_file"), "named verified Lisp loader exposed by actual manifest");
    assert.ok(listed.includes("cad__cad_run_lisp_command"), "owned command proxy exposed by actual manifest");

    // Re-registering the real manifest simulates an in-session lazy surface refresh.
    registerCadProxyTools(server);
    assert.ok(callbacks.has("cad__cad_load_lisp_file"));

    const bind = await bindDrawingForExecution(current.executionId, document.name);
    assert.equal(bind.runtime_document_identity, document.runtime_document_id);

    const invoke = async (tool, family, args, targetId = "") => {
      const lease = work.acquireToolLease({
        sessionKey: session, tool, family, targetId,
        executionId: current.executionId, authorityToken: current.authorityToken,
      });
      return work.runWithToolLease(lease, () => callbacks.get(tool).callback(args));
    };

    const badSyntax = await invoke("file_temp_lisp_create", "filesystem", { source: "(defun c:BAD (" });
    assert.equal(badSyntax.isError, true);
    assert.match(JSON.stringify(badSyntax), /TEMP_LISP_VALIDATION_FAILED/);
    assert.match(JSON.stringify(badSyntax), /UNCLOSED_PAREN/);
    const noCommand = await invoke("file_temp_lisp_create", "filesystem", { source: "(defun helper () (princ))" });
    assert.equal(noCommand.isError, true);
    assert.match(JSON.stringify(noCommand), /TEMP_LISP_VALID_COMMAND_REQUIRED/);

    const first = await invoke("file_temp_lisp_create", "filesystem", { source: '(defun c:CGTEMP () (princ "BAD_SOURCE"))' });
    assert.equal(first.structuredContent.ok, true);
    const a = first.structuredContent.data;
    assert.equal(a.loaded, false);
    assert.ok(a.absolute_path.startsWith(path.join(tmp, "runtime", "dynamic-lisp")));

    const failed = await invoke("cad__cad_load_lisp_file", "cad", { path: a.absolute_path, drawing_id: bind.drawing_id });
    assert.equal(failed.isError, true);
    assert.match(JSON.stringify(failed), /BAD_SOURCE/);
    assert.equal(failed.structuredContent.data.error_code, "CADGPT_LISP_LOAD_FAILED");
    await fs.stat(a.absolute_path); // Actual load failure must not silently delete scratch.

    const fixed = await invoke("file_temp_lisp_create", "filesystem", { source: '(defun c:CGTEMP () (princ "FIXED"))' });
    const b = fixed.structuredContent.data;
    assert.notEqual(a.absolute_path, b.absolute_path);
    assert.equal(work.activeWorkForSession(session).executionId, current.executionId);
    const loaded = await invoke("cad__cad_load_lisp_file", "cad", { path: b.absolute_path, drawing_id: bind.drawing_id });
    assert.equal(loaded.structuredContent.loaded, true);
    assert.equal(calls.filter(x => x.name === "cad_load_lisp_file").length, 2);

    const forbiddenRun = await invoke("cad__cad_run_lisp_command", "cad", { name: "NOT_OWNED", drawing_id: bind.drawing_id });
    assert.equal(forbiddenRun.isError, true);
    assert.match(JSON.stringify(forbiddenRun), /LISP_COMMAND_NOT_OWNED/);

    const queued = await invoke("cad__cad_run_lisp_command", "cad", { name: "CGTEMP", drawing_id: bind.drawing_id });
    assert.equal(queued.structuredContent.queued, true);
    assert.equal(queued.structuredContent.completion_verified, false);
    await fs.stat(b.absolute_path); // queued != completed, no cleanup yet

    const wrongDrawing = await invoke("cad__cad_load_lisp_file", "cad", { path: b.absolute_path, drawing_id: "dwg_wrong" });
    assert.equal(wrongDrawing.isError, true);
    assert.match(JSON.stringify(wrongDrawing), /Drawing context not found/);
    assert.equal(calls.filter(x => x.name === "cad_load_lisp_file").length, 2);

    const generic = await invoke("cad_invoke_manifest_tool", "cad", {
      tool_name: "cad_load_lisp_file", arguments: { path: b.absolute_path }, drawing_id: bind.drawing_id,
    });
    assert.equal(generic.isError, true);
    assert.match(JSON.stringify(generic), /CAD_MANIFEST_TOOL_NOT_PUBLIC/);

    const outside = path.join(tmp, "not-approved.lsp");
    await fs.writeFile(outside, "(defun c:OUTSIDE () (princ))", "utf8");
    const rejected = await invoke("cad__cad_load_lisp_file", "cad", { path: outside, drawing_id: bind.drawing_id });
    assert.equal(rejected.isError, true);
    assert.match(JSON.stringify(rejected), /LISP_COMMAND_SCOPE/);
    assert.equal(calls.filter(x => x.name === "cad_load_lisp_file").length, 2);

    const beforeCompletion = await invoke("cad__cad_list_layers", "cad", { drawing_id: bind.drawing_id });
    assert.deepEqual(beforeCompletion.structuredContent.layers, [], "queued response alone does not establish the required CAD postcondition");
    // Simulate AutoCAD independently completing a noninteractive command, then
    // verify via a *real named read proxy* instead of trusting queued:true.
    mockExecutionCompleted = true;
    const afterCompletion = await invoke("cad__cad_list_layers", "cad", { drawing_id: bind.drawing_id });
    assert.deepEqual(afterCompletion.structuredContent.layers, [{ name: "CGTEMP_RESULT" }]);
    for (const entry of [a, b]) {
      const done = await invoke("file_temp_lisp_cleanup", "filesystem", {
        file_name: entry.file_name, expected_sha256: entry.sha256,
      });
      assert.equal(done.structuredContent.ok, true);
      await assert.rejects(fs.stat(entry.absolute_path), { code: "ENOENT" });
    }
    assert.equal(work.activeWorkForSession(session).executionId, current.executionId);

    // Unknown acknowledgment is neither a successful load nor permission to run.
    const pending = await invoke("file_temp_lisp_create", "filesystem", { source: '(defun c:CGUNKNOWN () (princ "UNKNOWN_RESULT"))' });
    const pendingData = pending.structuredContent.data;
    const pendingLoad = await invoke("cad__cad_load_lisp_file", "cad", { path: pendingData.absolute_path, drawing_id: bind.drawing_id });
    assert.equal(pendingLoad.isError, true);
    assert.equal(pendingLoad.structuredContent.data.error_code, "CADGPT_LISP_LOAD_UNVERIFIED");
    assert.equal(calls.filter(x => x.name === "cad_load_lisp_file").length, 3, "no blind retry");
    const pendingRun = await invoke("cad__cad_run_lisp_command", "cad", { name: "CGUNKNOWN", drawing_id: bind.drawing_id });
    assert.equal(pendingRun.isError, true);
    assert.match(JSON.stringify(pendingRun), /LISP_COMMAND_NOT_OWNED/);
    await fs.stat(pendingData.absolute_path);
    // Explicit stop releases the Work's scratch ownership. This does not
    // claim the pending AutoCAD command has been canceled.
    work.releaseSessionWork(session);
    assert.equal(await cleanupTempLispForWork(current.executionId), 1);
    await assert.rejects(fs.stat(pendingData.absolute_path), { code: "ENOENT" });
  } finally {
    cadUpstream.callTool = oldCallTool;
    cadUpstream.status = oldStatus;
    if (current) {
      clearExecutionDrawingContexts(current.executionId);
      clearExecutionCadProxyState(current.executionId);
      work.releaseSessionWork(session);
      await cleanupTempLispForWork(current.executionId);
    }
    revokeSessionAdmissions(session);
    if (oldAppData === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = oldAppData;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
