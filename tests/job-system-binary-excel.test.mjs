import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const data = (result) => result.structuredContent?.data;
const errorText = (result) => JSON.stringify(result);
const python = process.platform === "win32" ? "python" : "python3";

test("SYSTEM binary workbook file I/O is scoped, hash-checked and byte-preserving", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cg-system-xlsx-"));
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const callbacks = new Map();
  try {
    const system = await import("../dist/cadgpt/runtime/system-lease.js");
    const { registerFilesystemTools } = await import("../dist/cadgpt/tools/filesystem.js");
    registerFilesystemTools({ registerTool(name, _cfg, fn) { callbacks.set(name, fn); } });
    const job = path.join(root, "libraries", "jobs", "mto", "mto");
    const template = path.join(job, "tools", "templates", "Grille Schedule.xlsx");
    const runtime = path.join(job, "runtime");
    const ownResult = path.join(root, "drawings", "a", "jobs", "mto-result");
    const otherResult = path.join(root, "drawings", "a", "jobs", "fan-result");
    await fs.mkdir(path.dirname(template), { recursive: true });
    await fs.mkdir(runtime, { recursive: true });
    await fs.mkdir(ownResult, { recursive: true });
    await fs.mkdir(otherResult, { recursive: true });
    const bytes = Buffer.from("504b03040000ff009900c0", "hex");
    await fs.writeFile(template, bytes);
    const lease = system.acquireJobSystemLease({
      toolId: "mto", jobId: "mto", jobName: "MTO", sessionKey: "binary-test",
      readableRoots: [job], writableRoots: [runtime, ownResult], jobRoot: job,
    });
    const call = (name, args) => system.runWithJobSystemLease(lease, () => callbacks.get(name)(args));
    try {
      assert.equal(typeof callbacks.get("file_binary_read"), "function");
      assert.equal(typeof callbacks.get("file_binary_copy"), "function");
      assert.equal(typeof callbacks.get("file_binary_write"), "function");
      const inspected = await call("file_binary_read", { path: template });
      assert.equal(inspected.isError, undefined, errorText(inspected));
      assert.equal(data(inspected).sha256, hash(bytes));
      assert.equal(Buffer.from(data(inspected).content_base64, "base64").equals(bytes), true);

      const output = path.join(ownResult, path.basename(template));
      const copied = await call("file_binary_copy", { source_path: template, target_path: output });
      assert.equal(copied.isError, undefined, errorText(copied));
      assert.deepEqual(await fs.readFile(output), bytes);
      assert.equal((await call("file_binary_copy", { source_path: template, target_path: output })).isError, true);
      const conflict = await call("file_binary_write", {
        path: output, content_base64: Buffer.from("modified").toString("base64"),
        expected_sha256: "0".repeat(64),
      });
      assert.equal(conflict.isError, true);
      assert.deepEqual(await fs.readFile(output), bytes);

      const revised = Buffer.concat([bytes, Buffer.from([1, 2, 3])]);
      const changed = await call("file_binary_write", {
        path: output, content_base64: revised.toString("base64"),
        expected_sha256: hash(bytes),
      });
      assert.equal(changed.isError, undefined, errorText(changed));
      assert.deepEqual(await fs.readFile(output), revised);
      assert.equal((await call("file_binary_write", {
        path: path.join(otherResult, "unauthorized.xlsx"),
        content_base64: bytes.toString("base64"),
      })).isError, true);
      assert.equal((await call("file_binary_copy", {
        source_path: template, target_path: path.join(otherResult, "unauthorized.xlsx"),
      })).isError, true);
      assert.equal((await call("file_binary_read", { path: path.join(root, "secret.xlsx") })).isError, true);
      assert.equal((await call("file_binary_write", {
        path: path.join(runtime, "not-excel.json"), content_base64: bytes.toString("base64"),
      })).isError, true);
    } finally {
      system.releaseJobSystemLease("mto", "binary-test");
    }
  } finally {
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SYSTEM helper executes only a hash-pinned Job-owned Python tool", async (t) => {
  if (spawnSync(python, ["--version"]).status !== 0) {
    t.skip("Python interpreter unavailable on CI runner");
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cg-system-helper-"));
  const previousRoot = process.env.CADGPT_APPDATA_ROOT;
  const previousPython = process.env.CAD_MCP_PYTHON;
  process.env.CADGPT_APPDATA_ROOT = root;
  process.env.CAD_MCP_PYTHON = python;
  const callbacks = new Map();
  try {
    const system = await import("../dist/cadgpt/runtime/system-lease.js");
    const { registerJobSystemHelperTools } = await import("../dist/cadgpt/tools/job-system-helper.js");
    registerJobSystemHelperTools({ registerTool(name, _cfg, fn) { callbacks.set(name, fn); } });
    const job = path.join(root, "libraries", "jobs", "mto", "mto");
    const runtime = path.join(job, "runtime");
    const result = path.join(root, "drawings", "a", "jobs", "mto-result");
    const helper = path.join(job, "tools", "excel", "process.py");
    const outside = path.join(root, "secret.py");
    await fs.mkdir(path.dirname(helper), { recursive: true });
    await fs.mkdir(runtime, { recursive: true });
    await fs.mkdir(result, { recursive: true });
    const script = "import json, sys\nfrom pathlib import Path\nobj=json.loads(Path(sys.argv[1]).read_text())\nprint(json.dumps({'value':obj['value']}))\n";
    await fs.writeFile(helper, script);
    await fs.writeFile(outside, "print('wrong')\n");
    const input = path.join(runtime, "input.json");
    await fs.writeFile(input, JSON.stringify({ value: 17 }));
    const lease = system.acquireJobSystemLease({
      toolId: "mto", jobId: "mto", jobName: "MTO", sessionKey: "helper-test",
      readableRoots: [job], writableRoots: [runtime, result], jobRoot: job,
    });
    const call = (args) => system.runWithJobSystemLease(lease, () => callbacks.get("job_system_run_helper")(args));
    try {
      const ok = await call({ script_path: helper, expected_sha256: hash(script), input_json_path: input });
      assert.equal(ok.isError, undefined, errorText(ok));
      assert.deepEqual(JSON.parse(data(ok).stdout), { value: 17 });
      await fs.writeFile(input, JSON.stringify({ value: "Cửa gió" }));
      const unicode = await call({ script_path: helper, expected_sha256: hash(script), input_json_path: input });
      assert.equal(unicode.isError, undefined, errorText(unicode));
      assert.deepEqual(JSON.parse(data(unicode).stdout), { value: "Cửa gió" });
      assert.equal((await call({
        script_path: helper, expected_sha256: "0".repeat(64), input_json_path: input,
      })).isError, true);
      assert.equal((await call({
        script_path: outside, expected_sha256: hash("print('wrong')\n"), input_json_path: input,
      })).isError, true);
      assert.equal((await call({
        script_path: helper, expected_sha256: hash(script), input_json_path: outside,
      })).isError, true);
    } finally {
      system.releaseJobSystemLease("mto", "helper-test");
    }
  } finally {
    if (previousRoot === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previousRoot;
    if (previousPython === undefined) delete process.env.CAD_MCP_PYTHON;
    else process.env.CAD_MCP_PYTHON = previousPython;
    await fs.rm(root, { recursive: true, force: true });
  }
});
