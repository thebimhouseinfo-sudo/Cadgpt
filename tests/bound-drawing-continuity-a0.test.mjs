import test from "node:test";
import assert from "node:assert/strict";

import { checkAdmission, revokeSessionAdmissions } from "../dist/cadgpt/lib/admission.js";
import * as work from "../dist/cadgpt/lib/work-registration.js";
import * as drawing from "../dist/cadgpt/session/drawing-binding.js";
import * as addin from "../dist/cadgpt/lib/addin-control.js";
import { cadUpstream } from "../dist/cadgpt/runtime/cad-upstream.js";
import { cleanupExecutionState } from "../dist/cadgpt/runtime/execution-cleanup.js";
import { registerWorkControlTools } from "../dist/cadgpt/tools/work-control.js";

const DWG = {
  name: "cadgpt-a0-disposable.dwg",
  full_name: "C:/Temp/cadgpt-a0-disposable.dwg",
  runtime_document_id: "a0-existing-document-lifetime-1",
  host: "autocad",
};

async function withFakeCad(callback) {
  const saved = cadUpstream.callTool;
  const calls = [];
  cadUpstream.callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === "acad_list_open_documents") return [{ ...DWG }];
    if (name === "acad_set_active_document") {
      assert.equal(args.runtime_document_id, DWG.runtime_document_id);
      return { runtime_document_id: DWG.runtime_document_id };
    }
    throw Error("UNEXPECTED_A0_CAD_CALL: " + name);
  };
  try { await callback(calls); } finally { cadUpstream.callTool = saved; }
}

function createCallbacks(session) {
  const callbacks = new Map();
  registerWorkControlTools({
    registerTool(name, _schema, callback) { callbacks.set(name, callback); },
  }, {
    sessionKey: session,
    async prepareFamilies(mode) { return { execution_path: mode }; },
    async upgradeToHybrid() { throw Error("A0 fixture cannot upgrade Work"); },
  });
  return callbacks;
}

function cadLease(session, current, tool = "a0_read") {
  return work.acquireToolLease({
    tool, family: "cad", sessionKey: session,
    executionId: current.executionId, authorityToken: current.authorityToken,
  });
}

test("E00-SOURCE: continuous paired chat/CAD under one Work never loses drawing identity", async () => {
  const session = "a0-e00-uninterrupted-active-chat";
  checkAdmission(session, "@cg", "mention");
  const originalNow = Date.now;
  const pair = addin.startAddinPairing();
  addin.completePendingAddinPair(session);
  let active;
  let observer;
  await withFakeCad(async calls => {
    try {
      active = work.createWorkRegistration({
        sessionKey: session, ownerType: "direct-cad",
        ownerId: "drawing-workspace", executionPath: "hybrid",
      });
      const bound = await drawing.bindDrawingForExecution(active.executionId, DWG.full_name);
      observer = addin.registerAddinSessionObserver(session, async () => {
        const current = work.activeWorkForSession(session);
        const contexts = current ? drawing.getBoundDrawingsForExecution(current.executionId) : [];
        return {
          drawing: contexts.length === 1
            ? { name: contexts[0].name, full_name: contexts[0].full_name } : null,
          bound_count: contexts.length,
          human_power: false,
        };
      });

      // Continuous status/Work/CAD requests across more than one normal idle threshold.
      for (let i = 0; i < 60; i++) {
        const current = work.activeWorkForSession(session);
        assert.equal(current?.executionId, active.executionId, "E00 Work changed without a transition");
        const status = await addin.addinBindingStatus(pair.pair_id);
        assert.equal(status.paired, true);
        assert.equal(status.session_ready, true);
        assert.equal(status.bound_count, 1);
        assert.equal(addin.isAddinManagedSession(session), true);
        const lease = cadLease(session, current);
        await work.runWithToolLease(lease, async () => {
          const result = await drawing.drawingBindingStatus();
          assert.equal(result.bound, true);
          assert.equal(result.drawing.runtime_document_identity, DWG.runtime_document_id);
          assert.equal(drawing.resolveDrawingContext().drawing_id, bound.drawing_id);
          await drawing.activateDrawingContext(drawing.resolveDrawingContext());
        });
        // Elapsed time is not sufficient evidence of session termination for a paired add-in.
        if (i === 30) {
          Date.now = () => originalNow() + work.getWorkIdleTimeoutMs() + 60000;
          work.sweepExpiredWork();
          Date.now = originalNow;
          assert.equal(work.activeExecutionForSession(session), active.executionId);
        }
      }
      assert.equal(calls.filter(c => c.name === "acad_set_active_document").length, 60);
      assert.equal(drawing.getBoundDrawingsForExecution(active.executionId).length, 1);
    } finally {
      Date.now = originalNow;
      if (active) {
        work.releaseWorkRegistration(active.executionId, active.authorityToken, session);
        drawing.clearExecutionDrawingContexts(active.executionId);
      }
      if (observer) addin.unregisterAddinSessionObserver(session, observer);
      addin.clearAddinPairingsForSession(session);
      revokeSessionAdmissions(session);
    }
  });
});

test("R01-RED: cleanup-before-handoff must not orphan B in an active chat", async () => {
  const session = "a0-r01-deterministic-cleanup-before-handoff";
  checkAdmission(session, "@cg", "mention");
  const callbacks = createCallbacks(session);
  let current;
  // Explicit forced schedule through the real work_start/createWorkRegistration
  // entrypoint. This proves or falsifies a dangerous interleaving, NOT the real
  // user's incident attribution. No sleep and no document closure are simulated.
  await withFakeCad(async () => {
    try {
      const a = work.createWorkRegistration({
        sessionKey: session, ownerType: "direct-cad",
        ownerId: "drawing-workspace", executionPath: "hybrid",
      });
      current = a;
      const original = await drawing.bindDrawingForExecution(a.executionId, DWG.full_name);
      const events = [];
      work.setWorkExpirationHandler(id => {
        events.push({ event: "expiration_cleanup", executionId: id });
        drawing.clearExecutionDrawingContexts(id);
      });
      const result = await callbacks.get("cadgpt_work_start")({
        owner_type: "job", owner_id: "create-system", execution_path: "hybrid",
      });
      current = work.activeWorkForSession(session);
      assert.equal(result.structuredContent.ok, true, JSON.stringify(result));
      assert.equal(events[0]?.executionId, a.executionId, "forced cleanup never ran");
      assert.notEqual(current?.executionId, a.executionId);
      assert.equal(
        result.structuredContent.data.drawing_handoff?.drawing_id,
        original.drawing_id,
        "R01: cleanup removed source before transfer; new Work lost active drawing"
      );
      const lease = cadLease(session, current);
      await work.runWithToolLease(lease, async () => {
        assert.equal(drawing.resolveDrawingContext().drawing_id, original.drawing_id);
      });
    } finally {
      work.setWorkExpirationHandler(async id => cleanupExecutionState(id));
      if (current) {
        work.releaseWorkRegistration(current.executionId, current.authorityToken, session);
        drawing.clearExecutionDrawingContexts(current.executionId);
      }
      revokeSessionAdmissions(session);
    }
  });
});
