import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-v5-runtime-"));
const old = process.env.CADGPT_APPDATA_ROOT;
process.env.CADGPT_APPDATA_ROOT = tmp;
const { getJobLibrariesRoot } = await import("../dist/cadgpt/lib/appdata.js");
const {
  prepareJobRuntimeForExecution,
  cleanupJobRuntimeForExecution,
  jobStepsPath,
} = await import("../dist/cadgpt/runtime/job-runtime.js");
test.after(async () => {
  if (old === undefined) delete process.env.CADGPT_APPDATA_ROOT;
  else process.env.CADGPT_APPDATA_ROOT = old;
  await fs.rm(tmp, { recursive: true, force: true });
});
test("V5 Builder runs share definition but never shared scratch or Job Steps", async () => {
  const dir = path.join(getJobLibrariesRoot(), "v5-shared", "myjob");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "JOB.md");
  await fs.writeFile(file, "# A job\n");
  const a = await prepareJobRuntimeForExecution("v5-work-a", "v5:v5-shared/myjob", file);
  const b = await prepareJobRuntimeForExecution("v5-work-b", "v5:v5-shared/myjob", file);
  try {
    assert.notEqual(a.runtime_root, b.runtime_root);
    assert.notEqual(jobStepsPath(a), jobStepsPath(b));
    await fs.writeFile(path.join(a.runtime_root, "a.json"), "{}");
    assert.deepEqual((await fs.readdir(b.runtime_root)), []);
  } finally {
    await cleanupJobRuntimeForExecution("v5-work-a");
    await cleanupJobRuntimeForExecution("v5-work-b");
  }
});

test("V5 registered Reasoning Jobs can run concurrently with independent scratch", async () => {
  const dir = path.join(getJobLibrariesRoot(), "v5-shared", "registered");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "JOB.md");
  await fs.writeFile(file, "# Registered Reasoning Job\n");
  const a = await prepareJobRuntimeForExecution("registered-a", "registered-job-id", file, { isolatedRun: true });
  const b = await prepareJobRuntimeForExecution("registered-b", "registered-job-id", file, { isolatedRun: true });
  try {
    assert.notEqual(a.runtime_root, b.runtime_root);
    assert.ok(a.runtime_root.includes(path.join("runtime", "runs")));
    assert.notEqual(jobStepsPath(a), jobStepsPath(b));
  } finally {
    await cleanupJobRuntimeForExecution("registered-a");
    await cleanupJobRuntimeForExecution("registered-b");
  }
});

test("V5 registered Job imports legacy checklist as independent unmarked template", async () => {
  const dir = path.join(getJobLibrariesRoot(), "v5-shared", "template-job");
  const runtime = path.join(dir, "runtime");
  await fs.mkdir(runtime, { recursive: true });
  const file = path.join(dir, "JOB.md");
  await fs.writeFile(file, "# Templated Job\n");
  const legacy = path.join(runtime, "JOB_STEPS.md");
  await fs.writeFile(legacy, "- [✓] Previously done\n- [✗] Previously failed\n");
  const a = await prepareJobRuntimeForExecution("templated-execution", "registered-template-job", file, { isolatedRun: true });
  try {
    const seeded = await fs.readFile(jobStepsPath(a), "utf8");
    assert.match(seeded, /- \[ \] Previously done/);
    assert.match(seeded, /- \[ \] Previously failed/);
    assert.match(await fs.readFile(legacy, "utf8"), /- \[✓\] Previously done/);
  } finally {
    await cleanupJobRuntimeForExecution("templated-execution");
  }
});
