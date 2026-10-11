import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

test("promoted Job execution never inherits an unconditional PLAN/REVIEW/READBACK loop", async () => {
  const reasoning = await fs.readFile(path.join(root, "knowledge/jobs/REASONING_HARNESS.md"), "utf8");
  const strict = await fs.readFile(path.join(root, "knowledge/cad/WORKFLOW_EXECUTION_HARNESS.md"), "utf8");
  const routing = await fs.readFile(path.join(root, "knowledge/cad/ORCHESTRATOR_HARNESS.md"), "utf8");
  const server = await fs.readFile(path.join(root, "src/cadgpt/server-factory.ts"), "utf8");
  assert.doesNotMatch(reasoning, /After every filesystem\/CAD mutation, re-read/);
  assert.doesNotMatch(reasoning, /Repeat PLAN\/REVIEW as many times as the workflow needs/);
  assert.match(reasoning, /selected Job step specifically requires it/);
  assert.match(reasoning, /no generic PLAN→REVIEW→READBACK loop/i);
  assert.match(reasoning, /load Lisp, then wait/i);
  assert.match(reasoning, /Job Builder \/ authoring/);
  assert.match(strict, /only checks explicitly required/i);
  assert.match(routing, /no managed JOB\.md/i);
  assert.match(server, /loadStrictCustomJobHarness/);
  assert.match(server, /loadOrchestratorHarness/);
  // Source contract check only: actual model tool-call traces need a host run.
});
