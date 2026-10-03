import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-addin-control-"));
process.env.CADGPT_APPDATA_ROOT = tempRoot;

const {
  addinPanelPairStatus,
  beginAddinPanelPair,
  captureAddinAdmission,
  connectAddinPanelDrawing,
  registerAddinSessionControl,
  resetAddinControlForTests,
  unregisterAddinSessionControl,
  writeAddinControlDescriptor,
} = await import("../dist/cadgpt/runtime/addin-control.js");

test.after(async () => {
  resetAddinControlForTests();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("panel pairs only after the bounded admission capture", () => {
  resetAddinControlForTests();
  beginAddinPanelPair("panel-12345678");
  assert.equal(
    addinPanelPairStatus("panel-12345678").paired,
    false
  );

  registerAddinSessionControl("session-A", {
    connectDrawing: async () => ({ ok: true }),
  });
  captureAddinAdmission("session-A");

  assert.equal(
    addinPanelPairStatus("panel-12345678").paired,
    true
  );
});

test("local panel control targets only its paired session callback", async () => {
  resetAddinControlForTests();
  const calls = [];

  registerAddinSessionControl("session-A", {
    connectDrawing: async (selector) => {
      calls.push(["A", selector]);
      return { drawing_name: "A.dwg" };
    },
  });
  registerAddinSessionControl("session-B", {
    connectDrawing: async (selector) => {
      calls.push(["B", selector]);
      return { drawing_name: "B.dwg" };
    },
  });

  beginAddinPanelPair("panel-abcdefgh");
  captureAddinAdmission("session-B");

  const result = await connectAddinPanelDrawing(
    "panel-abcdefgh",
    "C:\\Jobs\\B.dwg"
  );

  assert.deepEqual(calls, [["B", "C:\\Jobs\\B.dwg"]]);
  assert.equal(result.drawing_name, "B.dwg");
});

test("unpaired or disposed session fails closed", async () => {
  resetAddinControlForTests();

  await assert.rejects(
    connectAddinPanelDrawing("panel-abcdefgh", "A.dwg"),
    /ADDIN_PANEL_NOT_PAIRED/
  );

  registerAddinSessionControl("session-A", {
    connectDrawing: async () => ({ drawing_name: "A.dwg" }),
  });
  beginAddinPanelPair("panel-abcdefgh");
  captureAddinAdmission("session-A");
  unregisterAddinSessionControl("session-A");

  await assert.rejects(
    connectAddinPanelDrawing("panel-abcdefgh", "A.dwg"),
    /ADDIN_PANEL_NOT_PAIRED|ADDIN_SESSION_UNAVAILABLE/
  );
});

test("control descriptor is localhost-only metadata", async () => {
  const filePath = await writeAddinControlDescriptor(3100);
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));

  assert.equal(raw.schema_version, 1);
  assert.equal(raw.host, "127.0.0.1");
  assert.equal(raw.port, 3100);
  assert.equal(typeof raw.token, "string");
  assert.ok(raw.token.length >= 32);
});
