import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ensureJobCapabilityIndex, getVerifiedJobCapability,
} from "../dist/cadgpt/lib/job-capability-index.js";

test("per-Job lazy scan indexes valid AutoLISP and invalidates only changed assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cg-cap-index-"));
  const old = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const jobRoot = path.join(root, "libraries", "jobs", "test-library");
  try {
    await fs.mkdir(path.join(jobRoot, "lisp"), { recursive: true });
    await fs.mkdir(path.join(root, "registry", "user"), { recursive: true });
    await fs.writeFile(path.join(jobRoot, "JOB.md"), "# Test managed job\n");
    const lisp = path.join(jobRoot, "lisp", "tool.lsp");
    await fs.writeFile(lisp, "(defun c:TESTCMD () (princ))\n");
    await fs.writeFile(path.join(root, "registry", "user", "libraries.json"),
      JSON.stringify({ libraries: [{ id: "test-library", kind: "job",
        name: "Test", mode: "managed", managed_path: "appdata/libraries/jobs/test-library", enabled: true }] }));
    await fs.writeFile(path.join(root, "registry", "user", "capabilities.json"),
      JSON.stringify({ version: 1, entries: [{
        id: "testjob", kind: "job", library_id: "test-library",
        relative_path: "JOB.md", title: "Test",
      }] }));
    const first = await ensureJobCapabilityIndex("testjob");
    assert.equal(first.capabilities.length, 1, JSON.stringify(first));
    assert.equal(first.capabilities[0].command, "TESTCMD");
    const second = await ensureJobCapabilityIndex("testjob");
    assert.equal(second.scanned_at, first.scanned_at, "unchanged bundle should reuse index");
    const resolved = await getVerifiedJobCapability("custom:testjob:TESTCMD");
    assert.equal(await fs.realpath(resolved.absolute_path), await fs.realpath(lisp));
    await fs.writeFile(lisp, "(defun c:TESTCMD () (princ \"modified\"))\n");
    const third = await ensureJobCapabilityIndex("testjob");
    assert.notEqual(third.bundle_sha256, first.bundle_sha256);
    assert.notEqual(third.capabilities[0].source_sha256, first.capabilities[0].source_sha256);
    await fs.writeFile(path.join(jobRoot, "lisp", "duplicate.lsp"), "(defun c:TESTCMD () (princ))\n");
    const ambiguous = await ensureJobCapabilityIndex("testjob");
    assert.equal(ambiguous.capabilities.length, 0);
    assert.equal(ambiguous.unavailable.some((x) => x.reason.includes("Ambiguous")), true);
    assert.equal((await fs.readFile(path.join(jobRoot, "JOB.md"), "utf8")),
      "# Test managed job\n", "scanning never edits existing Job workflow");
  } finally {
    if (old === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = old;
    await fs.rm(root, { recursive: true, force: true });
  }
});
