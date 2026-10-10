import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const previous = process.env.CADGPT_APPDATA_ROOT;
const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-job-steps-"));
process.env.CADGPT_APPDATA_ROOT = root;
const runtime = await import("../dist/cadgpt/runtime/job-runtime.js");

async function job(name) {
  const file = path.join(root, "libraries", "jobs", "test", name, "JOB.md");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "# " + name + "\n\n## Steps\n1. Inspect raw\n2. Run stage\n", "utf8");
  return file;
}
const checkboxes = [
  "# Job Steps",
  "Job ID: grille-tag",
  "Workflow SHA: a1b2c3",
  "- [✓] Inspect raw files",
  "- [✗] Load Lisp",
  "- [ ] Check raw data",
  "- [v] Legacy pass format",
  "- [x] Legacy fail format",
  "",
].join("\n");

test("Job Steps reset ✓/✗ on FINISH without modifying raw, result, or checklist steps", async () => {
  const f = await job("grille-tag");
  const ctx = await runtime.prepareJobRuntimeForExecution("run-finish-steps", "grille-tag", f);
  const steps = runtime.jobStepsPath(ctx);
  await fs.writeFile(steps, checkboxes, "utf8");
  const raw = path.join(ctx.runtime_root, "collector-raw.json");
  await fs.writeFile(raw, '{"keep":true}', "utf8");
  const result = path.join(root, "drawings", "anchor", "jobs", "grille-tag-result", "grilles.json");
  await fs.mkdir(path.dirname(result), { recursive: true });
  await fs.writeFile(result, '{"preserved":true}', "utf8");

  const cleanup = await runtime.cleanupJobRuntimeForExecution("run-finish-steps");
  assert.equal(cleanup.job_steps_reset, true);
  assert.equal(cleanup.job_steps_path, steps);
  const txt = await fs.readFile(steps, "utf8");
  assert.match(txt, /- \[ \] Inspect raw files/);
  assert.match(txt, /- \[ \] Load Lisp/);
  assert.match(txt, /- \[ \] Check raw data/);
  assert.doesNotMatch(txt, /- \[(?:✓|✗|v|x)\]/);
  assert.equal(await fs.readFile(raw, "utf8"), '{"keep":true}');
  assert.equal(await fs.readFile(result, "utf8"), '{"preserved":true}');
});

test("same-running Job reprepare retains progress, new invocation resets stale marks", async () => {
  const f = await job("create-system");
  const id = "run-repeated-prepare";
  let ctx = await runtime.prepareJobRuntimeForExecution(id, "create-system", f);
  const steps = runtime.jobStepsPath(ctx);
  await fs.writeFile(steps, "- [✓] Collect CAD objects\n- [ ] Inspect raw\n", "utf8");
  ctx = await runtime.prepareJobRuntimeForExecution(id, "create-system", f);
  assert.match(await fs.readFile(steps, "utf8"), /\[✓\] Collect CAD/);
  assert.equal(ctx.recovery_pending, false, "Job Steps alone must not be mistaken for raw data");
  await runtime.cleanupJobRuntimeForExecution(id);
  // A new run on the same Job always begins with cleared progress even if prior
  // driver had already terminated and left this runtime directory intact.
  ctx = await runtime.prepareJobRuntimeForExecution("next-execution", "create-system", f);
  assert.match(await fs.readFile(steps, "utf8"), /\[ \] Collect CAD/);
  assert.equal(ctx.recovery_pending, false);
  await runtime.cleanupJobRuntimeForExecution("next-execution");
});

test("switching Job A -> B resets A and preserves A's pending raw data", async () => {
  const jobA = await job("job-a");
  const jobB = await job("job-b");
  const id = "run-a-then-b";
  const a = await runtime.prepareJobRuntimeForExecution(id, "job-a", jobA);
  const raw = path.join(a.runtime_root, "raw.json");
  const stepsA = runtime.jobStepsPath(a);
  await fs.writeFile(raw, "raw pending", "utf8");
  await fs.writeFile(stepsA, "- [✓] Inspect raw\n- [✗] Create result\n", "utf8");
  const b = await runtime.prepareJobRuntimeForExecution(id, "job-b", jobB);
  assert.notEqual(a.job_root, b.job_root);
  assert.match(await fs.readFile(stepsA, "utf8"), /- \[ \] Inspect raw/);
  assert.match(await fs.readFile(stepsA, "utf8"), /- \[ \] Create result/);
  assert.equal(await fs.readFile(raw, "utf8"), "raw pending");
  await runtime.cleanupJobRuntimeForExecution(id);
});

test("SYSTEM cleanup and explicit failure/stop leave checklist reset but preserve raw", async () => {
  const f = await job("system-job");
  const id = "run-system-steps";
  const ctx = await runtime.prepareJobRuntimeForExecution(id, "system-job", f);
  const steps = runtime.jobStepsPath(ctx);
  const raw = path.join(ctx.runtime_root, "raw-pending.csv");
  await fs.writeFile(steps, "- [✗] Failed external processor\n", "utf8");
  await fs.writeFile(raw, "pending,data\n", "utf8");
  runtime.detachJobRuntimeForSystemLease(id, "system-job");
  const cleanup = await runtime.cleanupJobRuntimeForSystemLease("system-job");
  assert.equal(cleanup.job_steps_reset, true);
  assert.match(await fs.readFile(steps, "utf8"), /- \[ \] Failed external processor/);
  assert.equal(await fs.readFile(raw, "utf8"), "pending,data\n");
});

test("no Job Steps file means no fake checklist created at finish", async () => {
  const f = await job("empty-steps");
  const ctx = await runtime.prepareJobRuntimeForExecution("empty-steps-run", "empty-steps", f);
  const steps = runtime.jobStepsPath(ctx);
  await runtime.cleanupJobRuntimeForExecution("empty-steps-run");
  await assert.rejects(fs.stat(steps), /ENOENT/);
});

test.after(async () => {
  if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
  else process.env.CADGPT_APPDATA_ROOT = previous;
  await fs.rm(root, { recursive: true, force: true });
});
