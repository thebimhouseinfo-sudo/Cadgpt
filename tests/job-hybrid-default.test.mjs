import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveWorkExecutionPath,
  registerWorkControlTools,
} from "../dist/cadgpt/tools/work-control.js";
import * as work from "../dist/cadgpt/lib/work-registration.js";
import { checkAdmission, revokeSessionAdmissions } from "../dist/cadgpt/lib/admission.js";
import * as binding from "../dist/cadgpt/session/drawing-binding.js";
import * as persistence from "../dist/cadgpt/runtime/drawing-persistence.js";
import { cadUpstream } from "../dist/cadgpt/runtime/cad-upstream.js";
import { cleanupExecutionState } from "../dist/cadgpt/runtime/execution-cleanup.js";

test("Job execution mode is HYBRID by default, legacy FILE/CAD are normalized; rare exceptions are explicit", () => {
  for (const path of [undefined, "file", "cad", "hybrid"]) {
    assert.equal(
      resolveWorkExecutionPath({ ownerType: "job", executionPath: path }),
      "hybrid", `job legacy request ${path}`
    );
  }
  for (const path of ["file", "cad"]) {
    assert.equal(
      resolveWorkExecutionPath({
        ownerType: "job",
        executionPath: "hybrid",
        jobNonHybridPath: path,
      }), path
    );
    assert.equal(resolveWorkExecutionPath({ ownerType: "direct-cad", executionPath: path }), path);
  }
  assert.throws(() => resolveWorkExecutionPath({ ownerType: "file" }), /EXECUTION_PATH_REQUIRED/);
  assert.throws(() => resolveWorkExecutionPath({
    ownerType: "file", executionPath: "file", jobNonHybridPath: "cad"
  }), /JOB_NONHYBRID_OVERRIDE_ONLY_FOR_JOB/);
});

test("hybrid Job A->B carries exactly one same-chat drawing ID and supports both FILE and CAD ToolLease", async () => {
  const session = "job-hybrid-default-handoff";
  checkAdmission(session, "@cg", "mention");
  const callbackMap = new Map();
  const observedPrepare = [];
  registerWorkControlTools({
    registerTool(name, _config, callback) { callbackMap.set(name, callback); }
  }, {
    sessionKey: session,
    async prepareFamilies(mode) {
      observedPrepare.push(mode);
      return { execution_path: mode };
    },
    async upgradeToHybrid() { throw new Error("Work upgrade should NOT be necessary for default Job"); },
  });
  const original = cadUpstream.callTool;
  let cadCalls = 0;
  cadUpstream.callTool = async (name) => {
    cadCalls++;
    if (name !== "acad_list_open_documents") throw Error("Unexpected CAD access: " + name);
    return [{
      name: "MAGS 09.10.26.dwg", full_name: "H:/My Drive/MAGS 09.10.26.dwg",
      runtime_document_id: "runtime-document-verified-1", host: "autocad"
    }];
  };
  let active = null;
  try {
    const old = work.createWorkRegistration({
      sessionKey: session, ownerType: "direct-cad",
      ownerId: "drawing-workspace", executionPath: "hybrid"
    });
    active = old;
    const source = await binding.bindDrawingForExecution(
      old.executionId, "H:/My Drive/MAGS 09.10.26.dwg"
    );
    const baselineCalls = cadCalls;
    const newJob = await callbackMap.get("cadgpt_work_start")({
      owner_type: "job", owner_id: "grille-tag", execution_path: "file"
    });
    assert.equal(newJob.structuredContent?.ok, true, JSON.stringify(newJob));
    const data = newJob.structuredContent.data;
    assert.equal(data.work_handle.execution_path, "hybrid");
    assert.equal(data.drawing_handoff?.drawing_id, source.drawing_id);
    assert.equal(data.drawing_handoff?.full_name, source.full_name);
    assert.equal(cadCalls, baselineCalls, "handoff itself must not wake or query CAD");
    assert.deepEqual(observedPrepare, ["hybrid"]);
    const next = work.activeWorkForSession(session);
    active = next;
    assert.equal(next.executionId, data.work_handle.execution_id);
    assert.equal(binding.getBoundDrawingsForExecution(old.executionId).length, 0,
      "old Work cleanup must remove the old binding");
    assert.equal(binding.getBoundDrawingsForExecution(next.executionId)[0].runtime_document_identity,
      "runtime-document-verified-1");

    for (const family of ["filesystem", "cad"]) {
      const lease = work.acquireToolLease({
        tool: "test_" + family, family, sessionKey: session,
        executionId: next.executionId, authorityToken: next.authorityToken,
      });
      await work.runWithToolLease(lease, async () => {});
    }

    const nextJob = await callbackMap.get("cadgpt_work_start")({
      owner_type: "job", owner_id: "create-system"
    });
    assert.equal(nextJob.structuredContent?.ok, true, JSON.stringify(nextJob));
    assert.equal(nextJob.structuredContent.data.drawing_handoff?.drawing_id, source.drawing_id);
    assert.equal(nextJob.structuredContent.data.work_handle.execution_path, "hybrid");

    const exception = await callbackMap.get("cadgpt_work_start")({
      owner_type: "job", owner_id: "mto", execution_path: "file",
      job_nonhybrid_path: "file",
    });
    assert.equal(exception.structuredContent?.data?.work_handle?.execution_path, "file");
    assert.equal(exception.structuredContent?.data?.drawing_handoff, undefined);
    const restricted = work.activeWorkForSession(session);
    active = restricted;
    assert.deepEqual(binding.getBoundDrawingsForExecution(restricted.executionId), []);
    assert.throws(() => work.acquireToolLease({
      tool: "test_cad", family: "cad", sessionKey: session,
      executionId: restricted.executionId, authorityToken: restricted.authorityToken,
    }), /EXECUTION_PATH_MISMATCH/);
  } finally {
    cadUpstream.callTool = original;
    const current = work.activeWorkForSession(session);
    if (current) {
      work.releaseWorkRegistration(current.executionId, current.authorityToken, session);
      await cleanupExecutionState(current.executionId);
    }
    revokeSessionAdmissions(session);
  }
});

test("drawing handoff does not guess across multi-drawing contexts and rejects reopened DWG lifetime", async () => {
  const original = cadUpstream.callTool;
  cadUpstream.callTool = async (name) => {
    if (name === "acad_list_open_documents") {
      return [{
        name: "MAGS 09.10.26.dwg", full_name: "H:/My Drive/MAGS 09.10.26.dwg",
        runtime_document_id: "lifetime-old", host: "autocad",
      }];
    }
    throw Error("Unexpected CAD call " + name);
  };
  try {
    const old = await binding.bindDrawingForExecution("fixture-job-drawing-source", "MAGS 09.10.26.dwg");
    const inherited = binding.handoffSingleBoundDrawingForExecution(
      "fixture-job-drawing-source", "fixture-job-drawing-target"
    );
    assert.equal(inherited.drawing_id, old.drawing_id);
    assert.equal(inherited.execution_id, "fixture-job-drawing-target");
    // Simulate close + reopen of a DWG with the same filename.
    cadUpstream.callTool = async (name) => {
      if (name === "acad_list_open_documents") {
        return [{
          name: "MAGS 09.10.26.dwg", full_name: "H:/My Drive/MAGS 09.10.26.dwg",
          runtime_document_id: "lifetime-new", host: "autocad",
        }];
      }
      throw Error("Unexpected CAD call " + name);
    };
    await assert.rejects(
      binding.activateDrawingContext(inherited), /BOUND_DRAWING_STALE/
    );
    assert.deepEqual(binding.getBoundDrawingsForExecution("fixture-job-drawing-target"), []);

    cadUpstream.callTool = async (name) => {
      if (name === "acad_list_open_documents") {
        return [
          { name: "A.dwg", full_name: "A.dwg", runtime_document_id: "docA" },
          { name: "B.dwg", full_name: "B.dwg", runtime_document_id: "docB" }
        ];
      }
      throw Error("Unexpected CAD call " + name);
    };
    await binding.bindDrawingForExecution("fixture-multiple-source", "A.dwg");
    await binding.bindDrawingForExecution("fixture-multiple-source", "B.dwg");
    assert.equal(
      binding.handoffSingleBoundDrawingForExecution("fixture-multiple-source", "fixture-multiple-target"),
      null
    );
  } finally {
    cadUpstream.callTool = original;
    for (const id of [
      "fixture-job-drawing-source", "fixture-job-drawing-target",
      "fixture-multiple-source", "fixture-multiple-target"
    ]) {
      binding.clearExecutionDrawingContexts(id);
    }
  }
});
