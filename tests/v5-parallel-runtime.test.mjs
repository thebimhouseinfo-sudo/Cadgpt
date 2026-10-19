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
test("V5 allows one active execution of each Job; different Jobs remain independent", async () => {
  const dir = path.join(getJobLibrariesRoot(), "v5-shared", "myjob");
  const otherDir = path.join(getJobLibrariesRoot(), "v5-shared", "other");
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(otherDir, { recursive: true });
  const file = path.join(dir, "JOB.md");
  const otherFile = path.join(otherDir, "JOB.md");
  await fs.writeFile(file, "# A job\n");
  await fs.writeFile(otherFile, "# Another job\n");
  const a = await prepareJobRuntimeForExecution("v5-work-a", "v5:v5-shared/myjob", file);
  try {
    await assert.rejects(
      prepareJobRuntimeForExecution("v5-work-b", "v5:v5-shared/myjob", file),
      /JOB_RUNTIME_BUSY/
    );
    const other = await prepareJobRuntimeForExecution("v5-other", "v5:v5-shared/other", otherFile);
    assert.notEqual(a.runtime_root, other.runtime_root);
    await cleanupJobRuntimeForExecution("v5-other");
  } finally {
    await cleanupJobRuntimeForExecution("v5-work-a");
  }
  const restarted = await prepareJobRuntimeForExecution("v5-work-b", "v5:v5-shared/myjob", file);
  assert.equal(restarted.runtime_root, a.runtime_root);
  assert.equal(jobStepsPath(restarted), jobStepsPath(a));
  await cleanupJobRuntimeForExecution("v5-work-b");
});

test("V5 registered Job resets legacy checklist in place", async () => {
  const dir = path.join(getJobLibrariesRoot(), "v5-shared", "template-job");
  const runtime = path.join(dir, "runtime");
  await fs.mkdir(runtime, { recursive: true });
  const file = path.join(dir, "JOB.md");
  await fs.writeFile(file, "# Templated Job\n");
  const legacy = path.join(runtime, "JOB_STEPS.md");
  await fs.writeFile(legacy, "- [✓] Previously done\n- [✗] Previously failed\n");
  const a = await prepareJobRuntimeForExecution("templated-execution", "registered-template-job", file);
  try {
    const seeded = await fs.readFile(jobStepsPath(a), "utf8");
    assert.match(seeded, /- \[ \] Previously done/);
    assert.match(seeded, /- \[ \] Previously failed/);
    assert.match(await fs.readFile(legacy, "utf8"), /- \[✓\] Previously done/);
  } finally {
    await cleanupJobRuntimeForExecution("templated-execution");
  }
});
