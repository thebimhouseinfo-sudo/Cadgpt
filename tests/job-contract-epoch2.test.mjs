import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("contract fingerprint invalidates checked Job scan even with identical integer epoch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-job-contract-"));
  const oldRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const compat = await import("../dist/cadgpt/lib/job-local-compat.js");
  try {
    const initial = await compat.getJobLocalCompatStatus();
    assert.equal(initial.source_epoch, 2);
    assert.equal(initial.update_required, true);
    assert.match(initial.source_fingerprint, /^[a-f0-9]{64}$/);

    await compat.markJobLocalCompatChecked({
      scanned_user_jobs: 0,
      report_summary: "test fixture has no jobs",
      pending_actions: ["grille-tag host acceptance pending"],
    });
    const checked = await compat.getJobLocalCompatStatus();
    assert.equal(checked.update_required, false);
    assert.equal(checked.update_reason, null);
    assert.equal(checked.checked_fingerprint, checked.source_fingerprint);
    assert.deepEqual(checked.pending_actions, ["grille-tag host acceptance pending"]);

    const marker = path.join(root, "state", "job-local-compat.json");
    await fs.writeFile(marker, JSON.stringify({
      checked_epoch: 2,
      checked_fingerprint: "outdated-policy-fingerprint",
      scanned_user_jobs: 0,
      pending_actions: [],
    }), "utf8");
    const drift = await compat.getJobLocalCompatStatus();
    assert.equal(drift.source_epoch, 2);
    assert.equal(drift.checked_epoch, 2);
    assert.equal(drift.update_required, true);
    assert.equal(drift.update_reason, "contract_changed");

    await fs.writeFile(marker, JSON.stringify({
      checked_epoch: 1,
      checked_fingerprint: drift.source_fingerprint,
      scanned_user_jobs: 0,
    }), "utf8");
    const upgrade = await compat.getJobLocalCompatStatus();
    assert.equal(upgrade.update_reason, "epoch_changed");
    assert.equal(upgrade.update_required, true);
  } finally {
    if (oldRoot === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = oldRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("epoch 2 guide contains raw-first Grille Tag regression and mandatory User Job update reporting", async () => {
  const guide = await fs.readFile(
    path.join(process.cwd(), "knowledge", "jobs", "LOCAL_COMPAT_UPDATE.md"),
    "utf8"
  );
  assert.match(guide, /JOB_LOCAL_COMPAT_EPOCH = 2/);
  assert.match(guide, /check actual raw -> empty:/);
  assert.match(guide, /nonempty: ask Update\/Skip/);
  assert.match(guide, /Update: ask Load Lisp\/Check raw/);
  assert.match(guide, /Skip: Check raw/);
  assert.match(guide, /ask the user how to update the Job/);
  assert.match(guide, /AFFECTED \/ BLOCKED/);
});

test("Job discovery and CadGPT launch are required to expose changed contract rather than silently run", async () => {
  const jobs = await fs.readFile(
    path.join(process.cwd(), "src", "cadgpt", "tools", "jobs.ts"), "utf8"
  );
  const server = await fs.readFile(
    path.join(process.cwd(), "src", "cadgpt", "server-factory.ts"), "utf8"
  );
  assert.match(jobs, /job_contract_compatibility/);
  assert.match(jobs, /JOB_LOCAL_COMPAT_SCAN_COUNT_MISMATCH/);
  assert.match(jobs, /CONTRACT UPDATE/);
  assert.match(server, /CUSTOM JOB CONTRACT UPDATE REQUIRED/);
  assert.match(server, /CUSTOM JOB UPDATES STILL PENDING/);
});
