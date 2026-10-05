import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "cadgpt-addin-control-")
);
process.env.CADGPT_APPDATA_ROOT = tempRoot;

const addin = await import(
  "../dist/cadgpt/lib/addin-control.js"
);
const { registerAdmissionTool } = await import(
  "../dist/cadgpt/tools/admission.js"
);
const { revokeSessionAdmissions } = await import(
  "../dist/cadgpt/lib/admission.js"
);

function fakeServer() {
  const callbacks = new Map();
  return {
    callbacks,
    server: {
      registerTool(name, _config, callback) {
        callbacks.set(name, callback);
      },
    },
  };
}

test.after(async () => {
  await fs.rm(tempRoot, {
    recursive: true,
    force: true,
  });
});

test("paired panel reads bound drawing without receiving work authority", async () => {
  const observerId =
    addin.registerAddinSessionObserver(
      "session-A",
      async () => ({
        drawing: {
          name: "B.dwg",
          full_name: "C:\\Drawings\\B.dwg",
        },
        bound_count: 1,
        human_power: false,
      })
    );

  const pair = addin.startAddinPairing();
  const completed =
    addin.completePendingAddinPair("session-A");
  assert.equal(completed, pair.pair_id);

  const status =
    await addin.addinBindingStatus(
      pair.pair_id
    );

  assert.deepEqual(status, {
    paired: true,
    session_ready: true,
    drawing: {
      name: "B.dwg",
      full_name: "C:\\Drawings\\B.dwg",
    },
    bound_count: 1,
    human_power: false,
  });

  const serialized = JSON.stringify(status);
  assert.equal(
    serialized.includes("authority_token"),
    false
  );
  assert.equal(
    serialized.includes("execution_id"),
    false
  );

  addin.unregisterAddinSessionObserver(
    "session-A",
    observerId
  );
});

test("paired panel forwards Human Power as read-only observed state", async () => {
  const observerId =
    addin.registerAddinSessionObserver(
      "session-human-power",
      async () => ({
        drawing: {
          name: "HP.dwg",
          full_name: "C:\\Drawings\\HP.dwg",
        },
        bound_count: 1,
        human_power: true,
      })
    );

  const pair = addin.startAddinPairing();
  addin.completePendingAddinPair(
    "session-human-power"
  );

  const status =
    await addin.addinBindingStatus(
      pair.pair_id
    );
  assert.equal(status.human_power, true);
  assert.equal(status.drawing?.name, "HP.dwg");

  addin.unregisterAddinSessionObserver(
    "session-human-power",
    observerId
  );
});

test("paired panel reports session not ready when observer is gone", async () => {
  const pair = addin.startAddinPairing();
  addin.completePendingAddinPair(
    "session-missing"
  );

  assert.deepEqual(
    await addin.addinBindingStatus(
      pair.pair_id
    ),
    {
      paired: true,
      session_ready: false,
      drawing: null,
      bound_count: 0,
      human_power: false,
    }
  );
});

test("normal user-invoked CadGPT admission consumes a pending panel pair", async () => {
  for (const [sessionKey, userTurn] of [
    ["session-bare", "@cg"],
    ["session-task", "@cg list layers"],
  ]) {
    const fake = fakeServer();
    const observerId =
      addin.registerAddinSessionObserver(
        sessionKey,
        async () => ({
          drawing: null,
          bound_count: 0,
          human_power: false,
        })
      );

    registerAdmissionTool(fake.server, {
      sessionKey,
      onActive: async () => undefined,
    });

    const pair = addin.startAddinPairing();
    await fake.callbacks.get(
      "cadgpt_admission"
    )({
      user_turn: userTurn,
      invocation_source: "mention",
    });

    const status =
      await addin.addinBindingStatus(
        pair.pair_id
      );
    assert.equal(status.paired, true);
    assert.equal(
      status.session_ready,
      true
    );

    revokeSessionAdmissions(sessionKey);
    addin.unregisterAddinSessionObserver(
      sessionKey,
      observerId
    );
  }
});


test("paired add-in work survives idle timeout while ordinary browser work still expires", async () => {
  const {
    checkAdmission,
    revokeSessionAdmissions: revokeAdmissions,
  } = await import(
    "../dist/cadgpt/lib/admission.js"
  );
  const {
    activeExecutionForSession,
    createWorkRegistration,
    getWorkIdleTimeoutMs,
    releaseSessionWork,
    sweepExpiredWork,
  } = await import(
    "../dist/cadgpt/lib/work-registration.js"
  );

  const addinSession =
    "session-addin-no-idle-timeout";
  const browserSession =
    "session-browser-normal-idle-timeout";

  checkAdmission(
    addinSession,
    "@cg",
    "mention"
  );
  checkAdmission(
    browserSession,
    "@cg",
    "mention"
  );

  const pair = addin.startAddinPairing();
  addin.completePendingAddinPair(
    addinSession
  );

  const addinWork =
    createWorkRegistration({
      sessionKey: addinSession,
      ownerType: "direct-cad",
      ownerId: "drawing-workspace",
      executionPath: "hybrid",
    });
  const browserWork =
    createWorkRegistration({
      sessionKey: browserSession,
      ownerType: "direct-cad",
      ownerId: "drawing-workspace",
      executionPath: "hybrid",
    });

  const realNow = Date.now;
  const wakeTime =
    realNow() +
    getWorkIdleTimeoutMs() +
    8 * 60 * 60 * 1000;

  try {
    Date.now = () => wakeTime;
    sweepExpiredWork();
  } finally {
    Date.now = realNow;
  }

  assert.equal(
    activeExecutionForSession(addinSession),
    addinWork.executionId,
    "paired add-in work must survive wall-clock idle time such as Windows sleep"
  );
  assert.equal(
    activeExecutionForSession(browserSession),
    null,
    "ordinary browser work must retain the normal idle-timeout policy"
  );

  const cleanupId =
    releaseSessionWork(addinSession);
  assert.equal(
    cleanupId,
    addinWork.executionId
  );
  assert.notEqual(
    browserWork.executionId,
    addinWork.executionId
  );

  addin.clearAddinPairingsForSession(
    addinSession
  );
  revokeAdmissions(addinSession);
  revokeAdmissions(browserSession);
});


test("detached MCP transport keeps add-in binding observer until logical session disposal", async () => {
  const {
    createMcpServer,
    disposeLogicalSessionState,
    disposeMcpServerRuntime,
  } = await import("../dist/cadgpt/server-factory.js");

  const sessionKey = "session-addin-idle-transport-gap";
  const server = createMcpServer(sessionKey);
  const pair = addin.startAddinPairing();
  addin.completePendingAddinPair(sessionKey);

  const beforeDetach = await addin.addinBindingStatus(pair.pair_id);
  assert.equal(beforeDetach.paired, true);
  assert.equal(beforeDetach.session_ready, true);

  await disposeMcpServerRuntime(server, { preserveSessionState: true });

  const duringTransportGap = await addin.addinBindingStatus(pair.pair_id);
  assert.equal(duringTransportGap.paired, true);
  assert.equal(
    duringTransportGap.session_ready,
    true,
    "transport cleanup must not make a preserved logical CAD session look disconnected"
  );

  await disposeLogicalSessionState(sessionKey);

  assert.deepEqual(await addin.addinBindingStatus(pair.pair_id), {
    paired: false,
    session_ready: false,
    drawing: null,
    bound_count: 0,
    human_power: false,
  });
});
