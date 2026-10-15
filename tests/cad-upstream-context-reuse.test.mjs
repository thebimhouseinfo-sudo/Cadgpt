import test from "node:test";
import assert from "node:assert/strict";
import { shouldResetCadUpstreamForContext as reset, cadUpstream } from "../dist/cadgpt/runtime/cad-upstream.js";

const baseline = {
  connected: true,
  requestedExecutionId: "new-job",
  requestedHumanPower: false,
  connectedExecutionId: "old-job",
  connectedHumanPower: false,
};

test("ordinary Job A -> Job B does not restart the Python CAD MCP", () => {
  assert.equal(reset(baseline), false);
  assert.equal(reset({ ...baseline, connectedExecutionId: "new-job" }), false);
  assert.equal(reset({ ...baseline, connectedExecutionId: null }), false);
});

test("Human Power transitions always isolate the upstream process", () => {
  assert.equal(reset({ ...baseline, requestedHumanPower: true }), true);
  assert.equal(reset({ ...baseline, connectedHumanPower: true }), true);
  assert.equal(reset({
    ...baseline, requestedHumanPower: true,
    connectedHumanPower: true, connectedExecutionId: "old-job"
  }), true);
  assert.equal(reset({
    ...baseline, requestedHumanPower: true,
    connectedHumanPower: true, connectedExecutionId: "new-job"
  }), false);
});

test("no connected process or missing current execution never triggers a redundant reset", () => {
  assert.equal(reset({ ...baseline, connected: false }), false);
  assert.equal(reset({ ...baseline, requestedExecutionId: null }), false);
});

test("normal session reuse does not skip the required Human Power reset", () => {
  const normal = reset(baseline);
  assert.equal(normal, false);
  const changedToHuman = reset({
    ...baseline, requestedExecutionId: "new-job",
    requestedHumanPower: true, connectedExecutionId: "old-job",
    connectedHumanPower: false
  });
  assert.equal(changedToHuman, true);
});

test("a real CAD tool exception does not discard the healthy upstream or binding", async () => {
  const old = {
    connect: cadUpstream.connect,
    client: cadUpstream.client,
    transport: cadUpstream.transport,
    phase: cadUpstream.phase,
    tools: cadUpstream.tools,
  };
  let transportClosed = false;
  const client = {
    async callTool() { throw new Error("real Lisp syntax failure"); },
  };
  try {
    cadUpstream.phase = "active";
    cadUpstream.connect = async () => {};
    cadUpstream.client = client;
    cadUpstream.transport = { async close() { transportClosed = true; } };
    cadUpstream.tools = [{ name: "cad_load_lisp_file" }];
    await assert.rejects(
      cadUpstream.callTool("cad_load_lisp_file", { path: "bad.lsp" }),
      /real Lisp syntax failure/
    );
    assert.equal(cadUpstream.client, client);
    assert.equal(cadUpstream.status().connected, true);
    assert.equal(transportClosed, false);
  } finally {
    cadUpstream.connect = old.connect;
    cadUpstream.client = old.client;
    cadUpstream.transport = old.transport;
    cadUpstream.phase = old.phase;
    cadUpstream.tools = old.tools;
  }
});
