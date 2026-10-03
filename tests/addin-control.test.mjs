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
