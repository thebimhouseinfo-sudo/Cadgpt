import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("cg/stop barrier blocks silent new work until an explicit workflow clears it", async () => {
  const {
    clearSessionWorkStopBarrier,
    createWorkRegistration,
    markSessionWorkStopped,
    releaseSessionWork,
  } = await import("../dist/cadgpt/lib/work-registration.js");
  const { checkAdmission, revokeSessionAdmissions } = await import(
    "../dist/cadgpt/lib/admission.js"
  );

  const sessionKey = "stage2-stop-barrier";
  checkAdmission(sessionKey, "@cg", "mention");
  try {
    const first = createWorkRegistration({
      sessionKey,
      ownerType: "file",
      ownerId: "lisp-authoring",
      executionPath: "file",
    });
    assert.ok(first.executionId);
    releaseSessionWork(sessionKey);

    markSessionWorkStopped(sessionKey);
    assert.throws(
      () =>
        createWorkRegistration({
          sessionKey,
          ownerType: "file",
          ownerId: "lisp-authoring",
          executionPath: "file",
        }),
      /WORK_STOPPED_RESTART_REQUIRED/
    );

    clearSessionWorkStopBarrier(sessionKey);
    const restarted = createWorkRegistration({
      sessionKey,
      ownerType: "file",
      ownerId: "lisp-authoring",
      executionPath: "file",
    });
    assert.ok(restarted.executionId);
    releaseSessionWork(sessionKey);
  } finally {
    clearSessionWorkStopBarrier(sessionKey);
    revokeSessionAdmissions(sessionKey);
  }
});

test("explicit drawing selection reports offline CAD without a synthetic rebind gate", async (t) => {
  const {
    acquireToolLease,
    createWorkRegistration,
    releaseSessionWork,
    runWithToolLease,
  } = await import("../dist/cadgpt/lib/work-registration.js");
  const { checkAdmission, revokeSessionAdmissions } = await import(
    "../dist/cadgpt/lib/admission.js"
  );
  const { registerCadProxyTools } = await import(
    "../dist/cadgpt/tools/cad-proxy.js"
  );

  const { cadUpstream } = await import("../dist/cadgpt/runtime/cad-upstream.js");
  // Unit/setup tests must never launch the installed Windows CAD subprocess.
  // Exercise a deterministic offline boundary, even when .venv-cad exists.
  const offline = "STAGE2_FIXTURE_CAD_OFFLINE";
  t.mock.method(cadUpstream, "status", () => ({ enabled: false, connected: false }));
  const activation = t.mock.method(cadUpstream, "activate", async () => {
    throw new Error(offline);
  });

  const sessionKey = "stage2-no-implicit-rebind";
  checkAdmission(sessionKey, "@cg", "mention");

  const callbacks = new Map();
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
      return { remove() {} };
    },
  };

  try {
    registerCadProxyTools(fakeServer);
    const drawingBind = callbacks.get("drawing_bind");
    assert.ok(drawingBind);

    const work = createWorkRegistration({
      sessionKey,
      ownerType: "direct-cad",
      ownerId: "drawing-workspace",
      executionPath: "hybrid",
    });
    const lease = acquireToolLease({
      tool: "drawing_bind",
      family: "cad",
      targetId: "Drawing3.dwg",
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });

    const result = await runWithToolLease(lease, () =>
      drawingBind({ document: "Drawing3.dwg" })
    );
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /STAGE2_FIXTURE_CAD_OFFLINE/);
    assert.equal(activation.mock.callCount(), 1);
    // Explicit document selection is allowed to recover a stale Host
    // binding after AutoCAD relaunch. Offline CAD may still fail normally.
    assert.doesNotMatch(JSON.stringify(result), /DRAWING_REBIND_REQUIRES_SELECTION/);
  } finally {
    releaseSessionWork(sessionKey);
    revokeSessionAdmissions(sessionKey);
  }
});

test("workspace activation serializes CAD MCP activation and document binding", async () => {
  const source = await fs.readFile(
    new URL("../src/cadgpt/server-factory.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /withCadHostLock\("autocad",[\s\S]*?cadUpstream\.activate\(\)[\s\S]*?bindDrawingForExecution\(work\.executionId, selector, \{ allowExplicitRebind: true \}\)/
  );
});


test("persistent MCP instructions require a fresh CAD read for every live-state question", async () => {
  const { FRESH_CAD_STATE_POLICY } = await import(
    "../dist/cadgpt/server-factory.js"
  );
  assert.match(FRESH_CAD_STATE_POLICY, /same user turn/i);
  assert.match(FRESH_CAD_STATE_POLICY, /Never reuse or restate a prior CAD result/i);
  assert.match(FRESH_CAD_STATE_POLICY, /layer count/i);
  assert.match(FRESH_CAD_STATE_POLICY, /fail closed/i);
});
