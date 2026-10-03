import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-connect-drawing-"));
process.env.CADGPT_APPDATA_ROOT = tempRoot;

const { checkAdmission, revokeSessionAdmissions } = await import(
  "../dist/cadgpt/lib/admission.js"
);
const { toolAuthority } = await import(
  "../dist/cadgpt/lib/tool-policy.js"
);
const { registerCadConnectDrawingTool } = await import(
  "../dist/cadgpt/tools/cad-launcher.js"
);

const statePath = path.join(tempRoot, "state", "tray-ready.json");

async function writeTray(drawings) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    JSON.stringify({
      autocad_running: true,
      autocad_attached: true,
      autocad_drawing_count: drawings.length,
      autocad_drawings: drawings,
      autocad_probe_at: new Date().toISOString(),
    }),
    "utf8"
  );
}

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
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("cadgpt_connect_drawing is session-authorized", () => {
  assert.equal(toolAuthority("cadgpt_connect_drawing"), "session");
});

test("connect drawing resolves exact full path and activates that drawing", async () => {
  await writeTray([
    { name: "A.dwg", full_name: "C:\\Drawings\\A.dwg" },
    { name: "B.dwg", full_name: "C:\\Drawings\\B.dwg" },
  ]);

  const sessionKey = "connect-drawing-session";
  checkAdmission(sessionKey, "@cg", "mention");
  const { callbacks, server } = fakeServer();
  const activated = [];

  registerCadConnectDrawingTool(server, {
    sessionKey,
    activateWorkspace: async (drawing) => {
      activated.push(drawing);
      return {
        text: "connected",
        work_handle: {
          execution_id: "exec-b",
          authority_token: "token-b",
        },
        drawing,
        cad_tools_ready: true,
        cad_proxy_tool_count: 1,
        cad_proxy_tools: ["cad__cad_list_layers"],
      };
    },
  });

  const result = await callbacks.get("cadgpt_connect_drawing")({
    drawing_selector: "C:\\Drawings\\B.dwg",
  });

  assert.equal(activated.length, 1);
  assert.equal(activated[0].name, "B.dwg");
  assert.equal(result.structuredContent?.drawing?.full_name, "C:\\Drawings\\B.dwg");
  assert.equal(result.structuredContent?.cad_tools_ready, true);

  revokeSessionAdmissions(sessionKey);
});

test("connect drawing fails closed for missing or ambiguous identities", async () => {
  await writeTray([
    { name: "Same.dwg", full_name: "C:\\One\\Same.dwg" },
    { name: "Same.dwg", full_name: "C:\\Two\\Same.dwg" },
  ]);

  const sessionKey = "connect-drawing-ambiguous";
  checkAdmission(sessionKey, "@cg", "mention");
  const { callbacks, server } = fakeServer();
  let activationCount = 0;

  registerCadConnectDrawingTool(server, {
    sessionKey,
    activateWorkspace: async (drawing) => {
      activationCount += 1;
      return {
        text: "connected",
        work_handle: {
          execution_id: "exec",
          authority_token: "token",
        },
        drawing,
      };
    },
  });

  await assert.rejects(
    callbacks.get("cadgpt_connect_drawing")({
      drawing_selector: "Same.dwg",
    }),
    /CAD_WORKSPACE_AMBIGUOUS_SELECTION/
  );

  await assert.rejects(
    callbacks.get("cadgpt_connect_drawing")({
      drawing_selector: "Missing.dwg",
    }),
    /CAD_WORKSPACE_INVALID_SELECTION/
  );

  assert.equal(activationCount, 0);
  revokeSessionAdmissions(sessionKey);
});
