import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const upstream = await fs.readFile(
  new URL("../src/cadgpt/runtime/cad-upstream.ts", import.meta.url), "utf8");
const schedulerSource = await fs.readFile(
  new URL("../src/cadgpt/runtime/cad-scheduler.ts", import.meta.url), "utf8");

test("CAD latency diagnostics separate host queue, operation and upstream RPC, never log arguments", () => {
  assert.match(schedulerSource, /host_queue_wait_ms=/);
  assert.match(schedulerSource, /host_operation_ms=/);
  assert.match(schedulerSource, /waitMs >= 1500/);
  assert.match(schedulerSource, /durationMs >= 5000/);
  assert.match(upstream, /upstream_connect_ms=/);
  assert.match(upstream, /upstream_tool=\$\{name\} rpc_ms=\$\{callMs\}/);
  assert.doesNotMatch(upstream, /\[CAD LATENCY\][^\n]*(?:JSON\.stringify\(args\)|JSON\.stringify\(result\))/);
});

test("queued CAD host calls remain serialized after slow and rejected calls", async () => {
  const { withCadHostLock } = await import(
    "../dist/cadgpt/runtime/cad-scheduler.js");
  const oldWarn = console.warn;
  const oldNow = Date.now;
  let now = 1000;
  const messages = [];
  const sequence = [];
  console.warn = (value) => messages.push(String(value));
  Date.now = () => now;
  try {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const one = withCadHostLock("latency-fixture", async () => {
      sequence.push("first-start");
      await gate;
      sequence.push("first-end");
      throw new Error("simulated CAD busy");
    });
    await Promise.resolve();
    await Promise.resolve();
    now += 2100;
    const two = withCadHostLock("latency-fixture", async () => {
      sequence.push("second-start");
      now += 5100;
      return "second-success";
    });
    now += 4200;
    release();
    await assert.rejects(one, /simulated CAD busy/);
    assert.equal(await two, "second-success");
    assert.deepEqual(sequence, ["first-start", "first-end", "second-start"]);
    assert.ok(messages.some(x => x.includes("host_queue_wait_ms=")));
    assert.ok(messages.some(x => x.includes("host_operation_ms=")));
  } finally {
    console.warn = oldWarn;
    Date.now = oldNow;
  }
});
