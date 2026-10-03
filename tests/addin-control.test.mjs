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

test("local add-in pair connects a drawing without exposing work authority", async () => {
  const controllerId =
    addin.registerAddinSessionController(
      "session-A",
      async (selector) => ({
        drawing: {
          name: "B.dwg",
          full_name: selector,
        },
        cad_tools_ready: true,
        work_handle: {
          execution_id: "SECRET_EXECUTION",
          authority_token: "SECRET_AUTHORITY",
        },
      })
    );

  const pair = addin.startAddinPairing();
  assert.ok(pair.pair_id);
  assert.equal(
    addin.addinPairStatus(pair.pair_id).paired,
    false
  );

  const completed =
    addin.completePendingAddinPair("session-A");
  assert.equal(completed, pair.pair_id);

  const status =
    addin.addinPairStatus(pair.pair_id);
  assert.deepEqual(status, {
    paired: true,
    controller_ready: true,
  });

  const result =
    await addin.connectAddinPairToDrawing(
      pair.pair_id,
      "C:\\Drawings\\B.dwg"
    );

  assert.deepEqual(result, {
    ok: true,
    drawing: {
      name: "B.dwg",
      full_name: "C:\\Drawings\\B.dwg",
    },
    cad_tools_ready: true,
  });
  const serialized = JSON.stringify(result);
  assert.equal(
    serialized.includes("SECRET_EXECUTION"),
    false
  );
  assert.equal(
    serialized.includes("SECRET_AUTHORITY"),
    false
  );

  addin.unregisterAddinSessionController(
    "session-A",
    controllerId
  );
});

test("bare @cg admission pairs the panel, while a task turn does not consume a pending pair", async () => {
  const bareSession = "session-bare";
  const bare = fakeServer();
  addin.registerAddinSessionController(
    bareSession,
    async () => ({
      drawing: { name: "Drawing1.dwg" },
      cad_tools_ready: true,
    })
  );
  registerAdmissionTool(bare.server, {
    sessionKey: bareSession,
    onActive: async () => undefined,
  });

  const pair = addin.startAddinPairing();
  await bare.callbacks.get("cadgpt_admission")({
    user_turn: "@cg",
    invocation_source: "mention",
  });
  assert.equal(
    addin.addinPairStatus(pair.pair_id).paired,
    true
  );

  const taskSession = "session-task";
  const task = fakeServer();
  registerAdmissionTool(task.server, {
    sessionKey: taskSession,
    onActive: async () => undefined,
  });
  const taskPair = addin.startAddinPairing();
  await task.callbacks.get("cadgpt_admission")({
    user_turn: "@cg list layers",
    invocation_source: "mention",
  });
  assert.equal(
    addin.addinPairStatus(taskPair.pair_id).paired,
    false
  );

  revokeSessionAdmissions(bareSession);
  revokeSessionAdmissions(taskSession);
});
