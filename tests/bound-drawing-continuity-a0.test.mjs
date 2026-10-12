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

test("R01-GREEN: cleanup-before-handoff cannot orphan B in an active chat", async () => {
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
      assert.deepEqual(events, [], "A expiration callback must not run before handoff/commit");
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

test("R02: failed successor prepare retains Work A and the original drawing", async () => {
  const session = "a0-r02-failed-prepare-rollback";
  checkAdmission(session, "@cg", "mention");
  const callbacks = new Map();
  let preparedExecutionId = null;
  registerWorkControlTools({
    registerTool(name, _schema, callback) { callbacks.set(name, callback); },
  }, {
    sessionKey: session,
    async prepareFamilies(_mode, _owner, executionId) {
      preparedExecutionId = executionId;
      throw Error("A0_FORCED_PREPARE_FAILURE");
    },
    async upgradeToHybrid() { throw Error("Unexpected upgrade"); },
  });
  let a;
  await withFakeCad(async () => {
    try {
      a = work.createWorkRegistration({
        sessionKey: session, ownerType: "direct-cad",
        ownerId: "drawing-workspace", executionPath: "hybrid",
      });
      const old = await drawing.bindDrawingForExecution(a.executionId, DWG.full_name);
      const res = await callbacks.get("cadgpt_work_start")({
        owner_type: "job", owner_id: "mto", execution_path: "hybrid",
      });
      assert.equal(res.structuredContent?.ok, false);
      assert.match(JSON.stringify(res), /A0_FORCED_PREPARE_FAILURE/);
      assert.notEqual(preparedExecutionId, a.executionId);
      assert.equal(work.activeExecutionForSession(session), a.executionId);
      assert.equal(drawing.getBoundDrawingsForExecution(a.executionId)[0]?.drawing_id, old.drawing_id);
      assert.equal(drawing.getBoundDrawingsForExecution(preparedExecutionId).length, 0);
      const lease = cadLease(session, a);
      await work.runWithToolLease(lease, async () => {
        assert.equal(drawing.resolveDrawingContext().drawing_id, old.drawing_id);
      });
    } finally {
      if (a) {
        work.releaseWorkRegistration(a.executionId, a.authorityToken, session);
        drawing.clearExecutionDrawingContexts(a.executionId);
      }
      revokeSessionAdmissions(session);
    }
  });
});

test("R17: staged successor credentials cannot acquire a ToolLease", async () => {
  const session = "a0-r17-stage-not-executable";
  checkAdmission(session, "@cg", "mention");
  let a, b;
  try {
    a = work.createWorkRegistration({
      sessionKey: session, ownerType: "direct-cad",
      ownerId: "drawing-workspace", executionPath: "hybrid",
    });
    b = work.createWorkRegistration({
      sessionKey: session, ownerType: "job", ownerId: "next-job",
      executionPath: "hybrid", staged: true,
    });
    assert.equal(work.activeExecutionForSession(session), a.executionId);
    assert.throws(() => cadLease(session, b), /NO_ACTIVE_WORK/);
    assert.throws(() => work.acquireToolLease({
      tool: "a0_file", family: "filesystem", sessionKey: session,
      executionId: b.executionId, authorityToken: b.authorityToken,
    }), /NO_ACTIVE_WORK/);
    assert.equal(work.cancelStagedWorkRegistration({
      sessionKey: session, stagedExecutionId: b.executionId,
      stagedAuthorityToken: b.authorityToken,
    }), true);
    assert.equal(work.activeExecutionForSession(session), a.executionId);
  } finally {
    if (a) work.releaseWorkRegistration(a.executionId, a.authorityToken, session);
    revokeSessionAdmissions(session);
  }
});

test("E01-SOURCE: paired session carries the same DWG across Job A, Job B, Temp, and Work reuse", async () => {
  const session = "a0-e01-same-addin-drawing-across-jobs";
  checkAdmission(session, "@cg", "mention");
  const pair = addin.startAddinPairing();
  addin.completePendingAddinPair(session);
  const callbacks = createCallbacks(session);
  const created = [];
  let observer;
  await withFakeCad(async () => {
    try {
      const original = work.createWorkRegistration({
        sessionKey: session, ownerType: "direct-cad",
        ownerId: "drawing-workspace", executionPath: "hybrid",
      });
      created.push(original.executionId);
      const bound = await drawing.bindDrawingForExecution(original.executionId, DWG.full_name);
      observer = addin.registerAddinSessionObserver(session, async () => {
        const current = work.activeWorkForSession(session);
        const contexts = current ? drawing.getBoundDrawingsForExecution(current.executionId) : [];
        return {
          drawing: contexts.length === 1
            ? { name: contexts[0].name, full_name: contexts[0].full_name }
            : null,
          bound_count: contexts.length, human_power: false,
        };
      });

      async function verify(stage) {
        const current = work.activeWorkForSession(session);
        assert.ok(current, stage + " lost Work");
        assert.equal(addin.isAddinManagedSession(session), true);
        assert.equal((await addin.addinBindingStatus(pair.pair_id)).bound_count, 1);
        const inherited = drawing.getBoundDrawingsForExecution(current.executionId);
        assert.equal(inherited.length, 1, stage + " lost backend binding");
        assert.equal(inherited[0].drawing_id, bound.drawing_id);
        assert.equal(inherited[0].runtime_document_identity, DWG.runtime_document_id);
        const lease = cadLease(session, current, "e01_read");
        await work.runWithToolLease(lease, async () => {
          const b = drawing.resolveDrawingContext();
          await drawing.activateDrawingContext(b);
          assert.equal((await drawing.drawingBindingStatus()).bound, true);
        });
      }

      await verify("initial bind");
      for (const [owner_type, owner_id] of [
        ["job", "grille-tag"],
        ["job", "create-system"],
        ["skill", "temp-lisp"],
      ]) {
        const started = await callbacks.get("cadgpt_work_start")({ owner_type, owner_id });
        assert.equal(started.structuredContent?.ok, true, JSON.stringify(started));
        assert.equal(started.structuredContent?.data?.drawing_handoff?.drawing_id, bound.drawing_id);
        const current = work.activeWorkForSession(session);
        created.push(current.executionId);
        await verify(owner_id);
      }
      const beforeReuse = work.activeWorkForSession(session);
      const reused = await callbacks.get("cadgpt_work_start")({
        owner_type: "skill", owner_id: "temp-lisp",
      });
      assert.equal(reused.structuredContent?.data?.reused, true);
      assert.equal(work.activeExecutionForSession(session), beforeReuse.executionId);
      await verify("chat reuse after Temp");
    } finally {
      const current = work.activeWorkForSession(session);
      if (current) work.releaseWorkRegistration(current.executionId, current.authorityToken, session);
      for (const id of created) drawing.clearExecutionDrawingContexts(id);
      if (observer) addin.unregisterAddinSessionObserver(session, observer);
      addin.clearAddinPairingsForSession(session);
      revokeSessionAdmissions(session);
    }
  });
});

test("R09-GREEN: incomplete DWG observation cannot permanently erase an active binding", async () => {
  const session = "a0-r09-transient-document-list-absence";
  checkAdmission(session, "@cg", "mention");
  const saved = cadUpstream.callTool;
  let docs = [{ ...DWG }];
  cadUpstream.callTool = async name => {
    if (name === "acad_list_open_documents") return docs.map(d => ({ ...d }));
    if (name === "acad_set_active_document") return { runtime_document_id: DWG.runtime_document_id };
    throw Error("Unexpected CAD call: " + name);
  };
  let active;
  try {
    active = work.createWorkRegistration({
      sessionKey: session, ownerType: "direct-cad",
      ownerId: "drawing-workspace", executionPath: "hybrid",
    });
    const bound = await drawing.bindDrawingForExecution(active.executionId, DWG.full_name);
    const lease = cadLease(session, active, "r09_status");
    await work.runWithToolLease(lease, async () => {
      assert.equal((await drawing.drawingBindingStatus()).bound, true);
      docs = []; // successful but incomplete snapshot, not a confirmed close.
      assert.equal((await drawing.drawingBindingStatus()).bound, false);
      assert.equal(
        drawing.getBoundDrawingsForExecution(active.executionId).length, 1,
        "R09: one negative document listing must not erase verified binding identity"
      );
      await assert.rejects(
        drawing.activateDrawingContext(bound), /BOUND_DRAWING_UNAVAILABLE/
      );
      assert.equal(drawing.getBoundDrawingsForExecution(active.executionId).length, 1);
      docs = [{ ...DWG }];
      assert.equal((await drawing.drawingBindingStatus()).bound, true);
      assert.equal(drawing.resolveDrawingContext().drawing_id, bound.drawing_id);
      await drawing.activateDrawingContext(bound);

      // Positive evidence of the exact same selector with a different document
      // lifetime must still fail closed and require an explicit rebind.
      docs = [{ ...DWG, runtime_document_id: "reopened-different-lifetime" }];
      await assert.rejects(
        drawing.activateDrawingContext(bound), /BOUND_DRAWING_STALE/
      );
      assert.deepEqual(drawing.getBoundDrawingsForExecution(active.executionId), []);
    });
  } finally {
    if (active) {
      work.releaseWorkRegistration(active.executionId, active.authorityToken, session);
      drawing.clearExecutionDrawingContexts(active.executionId);
    }
    cadUpstream.callTool = saved;
    revokeSessionAdmissions(session);
  }
});

test("R12: competing same-session Work starts cannot steal the committed drawing", async () => {
  const session = "a0-r12-competing-transitions";
  checkAdmission(session, "@cg", "mention");
  const callbacks = new Map();
  const waiting = [];
  registerWorkControlTools({
    registerTool(name, _schema, callback) { callbacks.set(name, callback); },
  }, {
    sessionKey: session,
    prepareFamilies() {
      return new Promise(resolve => waiting.push(resolve));
    },
    async upgradeToHybrid() { throw Error("Unexpected upgrade"); },
  });
  let a;
  const ids = [];
  await withFakeCad(async () => {
    try {
      a = work.createWorkRegistration({
        sessionKey: session, ownerType: "direct-cad",
        ownerId: "drawing-workspace", executionPath: "hybrid",
      });
      ids.push(a.executionId);
      const bound = await drawing.bindDrawingForExecution(a.executionId, DWG.full_name);
      const first = callbacks.get("cadgpt_work_start")({
        owner_type: "job", owner_id: "job-first",
      });
      const second = callbacks.get("cadgpt_work_start")({
        owner_type: "job", owner_id: "job-second",
      });
      for (let attempt = 0; attempt < 100 && waiting.length < 2; attempt++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(waiting.length, 2, "both successors must be staged before commit");
      waiting[1]({ execution_path: "hybrid" });
      const won = await second;
      assert.equal(won.structuredContent?.ok, true, JSON.stringify(won));
      assert.equal(won.structuredContent?.data?.drawing_handoff?.drawing_id, bound.drawing_id);
      const winner = work.activeWorkForSession(session);
      ids.push(winner.executionId);
      assert.equal(winner.ownerId, "job-second");

      waiting[0]({ execution_path: "hybrid" });
      const lost = await first;
      assert.equal(lost.structuredContent?.ok, false, JSON.stringify(lost));
      assert.match(JSON.stringify(lost), /WORK_STAGE_STALE/);
      assert.equal(work.activeExecutionForSession(session), winner.executionId);
      const lease = cadLease(session, winner, "r12_after_race");
      await work.runWithToolLease(lease, async () => {
        assert.equal(drawing.resolveDrawingContext().drawing_id, bound.drawing_id);
        await drawing.activateDrawingContext(drawing.resolveDrawingContext());
      });
    } finally {
      const current = work.activeWorkForSession(session);
      if (current) work.releaseWorkRegistration(current.executionId, current.authorityToken, session);
      for (const id of ids) drawing.clearExecutionDrawingContexts(id);
      revokeSessionAdmissions(session);
    }
  });
});
