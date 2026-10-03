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

test("normal user-invoked CadGPT admission consumes a pending panel pair", async () => {
  for (const [sessionKey, userTurn] of [
    ["session-bare", "@cg"],
    ["session-task", "@cg list layers"],
  ]) {
    const fake = fakeServer();
    addin.registerAddinSessionController(
      sessionKey,
      async () => ({
        drawing: { name: "Drawing1.dwg" },
        cad_tools_ready: true,
      })
    );
    registerAdmissionTool(fake.server, {
      sessionKey,
      onActive: async () => undefined,
    });

    const pair = addin.startAddinPairing();
    await fake.callbacks.get("cadgpt_admission")({
      user_turn: userTurn,
      invocation_source: "mention",
    });

    assert.equal(
      addin.addinPairStatus(pair.pair_id).paired,
      true
    );
    revokeSessionAdmissions(sessionKey);
  }
});
