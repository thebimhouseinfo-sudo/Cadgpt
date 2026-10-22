import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "cg-public-authoring-"));
process.env.CADGPT_APPDATA_ROOT = root;
const { createMcpServer, disposeMcpServerRuntime } = await import("../dist/cadgpt/server-factory.js");
const retired = ["job_draft_new", "job_checkout", "job_draft_validate", "job_promote_draft", "job_run_direct_draft", "lisp_checkout", "lisp_draft_validate", "lisp_promote_draft", "file_temp_lisp_create", "file_temp_lisp_cleanup"];
const sha = content => createHash("sha256").update(content).digest("hex");
async function session(name, callback) {
  const server = createMcpServer(name);
  const client = new Client({ name: "public-authoring-regression", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    const admitted = await client.callTool({ name: "cadgpt_admission", arguments: { user_turn: "@cg create a requested source package", invocation_source: "mention" } });
    assert.notEqual(admitted.isError, true, JSON.stringify(admitted));
    const work = await client.callTool({ name: "cadgpt_work_start", arguments: { owner_type: "skill", owner_id: "job-authoring", execution_path: "file" } });
    assert.notEqual(work.isError, true, JSON.stringify(work));
    const handle = work.structuredContent.data.work_handle;
    const call = async (name, args = {}) => client.callTool({ name, arguments: { ...handle, ...args } });
    await callback(client, call);
  } finally { await client.close(); await disposeMcpServerRuntime(server); }
}
test.after(async () => { await fs.rm(root, { recursive: true, force: true }); });

test("normal MCP discovery and Registry expose V5 authoring without legacy draft or shared Temp writers", async () => {
  await session("public-surface", async (client, call) => {
    const listed = await client.listTools();
    const names = listed.tools.map(t => t.name);
    for (const name of retired) assert.equal(names.includes(name), false, name);
    for (const name of ["temp_job_source_read", "v5_source_create", "v5_source_update", "v5_source_publish", "lisp_validate", "job_runtime_prepare", "job_run_direct"]) assert(names.includes(name), name);
    const registry = await call("registry_list", { kind: "tool", registry: "internal", limit: 1000 });
    assert.notEqual(registry.isError, true, JSON.stringify(registry));
    const registryNames = registry.structuredContent.data.entries.map(e => e.name);
    for (const name of retired) assert.equal(registryNames.includes(name), false, name);
    assert(registryNames.includes("temp_job_source_read"));
    const denied = await call("file_temp_lisp_create", { source: "(princ)" });
    assert.equal(denied.isError, true);
  });
});

test("public V5 Job authoring creates, reads, hash-edits and publishes without draft stages", async () => {
  await session("public-job-author", async (_client, call) => {
    const args = { kind: "reusable-job", library_id: "public-job", folder: "report", relative_file: "JOB.md" };
    const text = "# Report Job\n\n## Steps\n1. Report only.\n";
    const made = await call("v5_source_create", { ...args, content: text });
    assert.notEqual(made.isError, true, JSON.stringify(made));
    const file = made.structuredContent.data.path;
    const generic = await call("file_edit", { path: file, expected_sha256: sha(text), old_text: "Report only", new_text: "Wrong generic write" });
    assert.equal(generic.isError, true);
    const updated = await call("v5_source_update", { ...args, content: text + "\nDetails\n", expected_sha256: sha(text) });
    assert.notEqual(updated.isError, true, JSON.stringify(updated));
    const read = await call("file_read", { path: file });
    assert.notEqual(read.isError, true, JSON.stringify(read));
    const published = await call("v5_source_publish", { kind: "job", library_id: "public-job", library_name: "Public Job" });
    assert.notEqual(published.isError, true, JSON.stringify(published));
    const registry = await call("registry_list", { kind: "job", registry: "user", library_id: "public-job" });
    assert.equal(registry.structuredContent.data.entries.length, 1);
    assert.equal(await fs.readFile(file, "utf8"), text + "\nDetails\n");
  });
});

test("scaffold and validation operate on source content without a draft-library prerequisite", async () => {
  await session("public-lisp-author", async (_client, call) => {
    const scaffold = await call("lisp_scaffold", { file_name: "hello.lsp", module: "Demo", command: "HELLO", description: "Report hello", target_library_id: "public-lisp", mutating: false, uses_com: false });
    assert.notEqual(scaffold.isError, true, JSON.stringify(scaffold));
    const data = scaffold.structuredContent.data;
    assert.equal(data.suggested_draft_path, undefined);
    assert.equal(data.source_target.kind, "reusable-lisp");
    assert.equal(data.source_target.library_id, "public-lisp");
    const validation = await call("lisp_validate", { source: data.content, expected_commands: ["HELLO"], profile: "cadgpt" });
    assert.notEqual(validation.isError, true, JSON.stringify(validation));
    assert.equal(validation.structuredContent.data.valid, true);
    const created = await call("v5_source_create", { ...data.source_target, content: data.content });
    assert.notEqual(created.isError, true, JSON.stringify(created));
    assert.equal(await fs.readFile(created.structuredContent.data.path, "utf8"), data.content);
  });
});

test("public Temp APIs complete a source correction without permanent authoring or Registry publication", async () => {
  await session("public-temp-author", async (_client, call) => {
    const temp = await call("temp_job_create");
    assert.notEqual(temp.isError, true, JSON.stringify(temp));
    const id = temp.structuredContent.data.id;
    const made = await call("temp_job_source_create", { id, relative_path: "lisp/once.lsp", content: "(princ)\n" });
    assert.notEqual(made.isError, true, JSON.stringify(made));
    const read = await call("temp_job_source_read", { id, relative_path: "lisp/once.lsp" });
    assert.notEqual(read.isError, true, JSON.stringify(read));
    const updated = await call("temp_job_source_update", { id, relative_path: "lisp/once.lsp", content: "(princ 2)\n", expected_sha256: read.structuredContent.data.sha256 });
    assert.notEqual(updated.isError, true, JSON.stringify(updated));
    const done = await call("temp_job_done", { id });
    assert.notEqual(done.isError, true, JSON.stringify(done));
    const registry = await call("registry_list", { registry: "user", query: id, limit: 1000 });
    assert.equal(registry.structuredContent.data.entries.length, 0);
  });
});
