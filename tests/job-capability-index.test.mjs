import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ensureJobCapabilityIndex, getVerifiedJobCapability,
} from "../dist/cadgpt/lib/job-capability-index.js";
import { registerCapabilityRegistryTools } from "../dist/cadgpt/tools/registry.js";
import { registerJobAuthoringTools } from "../dist/cadgpt/tools/jobs.js";

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
    const privateHelpers = await ensureJobCapabilityIndex("testjob");
    assert.equal(privateHelpers.capabilities.length, 0,
      "syntax-valid C: commands are NOT automatically standalone tools");
    const exportContract = {
      version: 1, exports: [{
        command: "TESTCMD", source: "lisp/tool.lsp", standalone: true,
        input: { args: [] }, output: "cad_tool_result",
        effect: "cad-write", dependencies: [],
      }],
    };
    await fs.mkdir(path.join(jobRoot, "tools"), { recursive: true });
    await fs.writeFile(path.join(jobRoot, "tools", "capabilities.json"),
      JSON.stringify(exportContract));
    const first = await ensureJobCapabilityIndex("testjob");
    assert.equal(first.capabilities.length, 1, JSON.stringify(first));
    assert.equal(first.capabilities[0].command, "TESTCMD");
    assert.equal(first.capabilities[0].callable, true);
    assert.equal(first.capabilities[0].prepare_tool, "job_capability_prepare");
    assert.equal(first.capabilities[0].run_tool, "cad__cad_run_lisp_command");
    const callbacks = new Map();
    const stub = { registerTool(name, _schema, cb) { callbacks.set(name, cb); } };
    registerCapabilityRegistryTools(stub);
    registerJobAuthoringTools(stub);
    assert.equal(callbacks.has("job_capability_prepare"), true);
    const registry = await callbacks.get("registry_list")({
      kind: "tool", registry: "user", limit: 100,
    });
    assert.equal(registry.structuredContent?.ok, true, JSON.stringify(registry));
    assert.equal(registry.structuredContent.data.entries.some((x) =>
      x.id === "custom:testjob:TESTCMD" && x.callable === true), true);

    const second = await ensureJobCapabilityIndex("testjob");
    assert.equal(second.scanned_at, first.scanned_at, "unchanged bundle should reuse index");
    const resolved = await getVerifiedJobCapability("custom:testjob:TESTCMD");
    assert.equal(await fs.realpath(resolved.absolute_path), await fs.realpath(lisp));
    await fs.writeFile(lisp, "(defun c:TESTCMD () (princ \"modified\"))\n");
    const staleDiscovery = await callbacks.get("registry_list")({
      kind: "tool", registry: "user", limit: 100,
    });
    assert.equal(staleDiscovery.structuredContent?.ok, true);
    assert.equal(staleDiscovery.structuredContent.data.entries.some((x) =>
      x.id === "custom:testjob:TESTCMD"), false,
      "changed source must not be advertised callable from the old cache");

    const third = await ensureJobCapabilityIndex("testjob");
    assert.notEqual(third.bundle_sha256, first.bundle_sha256);
    assert.notEqual(third.capabilities[0].source_sha256, first.capabilities[0].source_sha256);
    await fs.writeFile(path.join(jobRoot, "lisp", "duplicate.lsp"), "(defun c:TESTCMD () (princ))\n");
    exportContract.exports.push({
      command: "TESTCMD", source: "lisp/duplicate.lsp", standalone: true,
      input: { args: [] }, output: "cad_tool_result",
      effect: "cad-write", dependencies: [],
    });
    await fs.writeFile(path.join(jobRoot, "tools", "capabilities.json"),
      JSON.stringify(exportContract));

    const ambiguous = await ensureJobCapabilityIndex("testjob");
    assert.equal(ambiguous.capabilities.length, 0);
    assert.equal(ambiguous.unavailable.some((x) => x.reason.includes("Ambiguous")), true);
    await fs.writeFile(path.join(root, "registry", "user", "capabilities.json"),
      JSON.stringify({ version: 1, entries: [] }));
    const retired = await callbacks.get("registry_list")({
      kind: "tool", registry: "user", limit: 100,
    });
    assert.equal(retired.structuredContent?.ok, true, JSON.stringify(retired));
    assert.equal(retired.structuredContent.data.entries.some((x) =>
      x.id === "custom:testjob:TESTCMD"), false,
      "unregistered Jobs must not leave advertised callable tools");

    assert.equal((await fs.readFile(path.join(jobRoot, "JOB.md"), "utf8")),
      "# Test managed job\n", "scanning never edits existing Job workflow");
  } finally {
    if (old === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = old;
    await fs.rm(root, { recursive: true, force: true });
  }
});
