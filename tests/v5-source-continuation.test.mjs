import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "cg-source-continuation-"));
process.env.CADGPT_APPDATA_ROOT = root;
const admission = await import("../dist/cadgpt/lib/admission.js");
const workApi = await import("../dist/cadgpt/lib/work-registration.js");
const grants = await import("../dist/cadgpt/runtime/job-update-grant.js");
const { cleanupExecutionState } = await import("../dist/cadgpt/runtime/execution-cleanup.js");
const { registerV5BuilderSourceTools } = await import("../dist/cadgpt/tools/v5-builder-source.js");
const { publishManagedLibrary } = await import("../dist/cadgpt/tools/user-assets.js");
const { registerUserAssetTools } = await import("../dist/cadgpt/tools/user-assets.js");
const handlers = new Map();
registerV5BuilderSourceTools({ registerTool(name, _config, callback) { handlers.set(name, callback); } });
registerUserAssetTools({ registerTool(name, _config, callback) { handlers.set(name, callback); } });
const sessions = new Set();
const sha = text => createHash("sha256").update(text).digest("hex");
const source = "# Newly authored Job\n\n## Steps\n1. Report.\n";
function start(session) {
  sessions.add(session);
  admission.checkAdmission(session, "@cg", "mention");
  return workApi.createWorkRegistration({ sessionKey: session, ownerType: "skill", ownerId: "job-authoring", executionPath: "file" });
}
function call(session, work, name, payload) {
  const lease = workApi.acquireToolLease({ sessionKey: session, executionId: work.executionId, authorityToken: work.authorityToken, tool: name, family: "filesystem" });
  return workApi.runWithToolLease(lease, () => handlers.get(name)(payload));
}
test.after(async () => {
  for (const session of sessions) { workApi.releaseSessionWork(session); admission.revokeSessionAdmissions(session); }
  await fs.rm(root, { recursive: true, force: true });
});

test("new Job authoring continues in the same session after full Work cleanup", async () => {
  const session = "continue-new-source";
  let work = start(session);
  const args = { kind: "reusable-job", library_id: "continuation", folder: "new-job", relative_file: "JOB.md" };
  const made = await call(session, work, "v5_source_create", { ...args, content: source });
  assert.notEqual(made.isError, true, JSON.stringify(made));
  workApi.releaseSessionWork(session);
  await cleanupExecutionState(work.executionId);
  work = start(session);
  const updated = await call(session, work, "v5_source_update", { ...args, content: source + "continued\n", expected_sha256: sha(source) });
  assert.notEqual(updated.isError, true, JSON.stringify(updated));
  const child = await call(session, work, "v5_source_create", { ...args, relative_file: "lisp/helper.lsp", content: "(princ)\n" });
  assert.notEqual(child.isError, true, JSON.stringify(child));
  const stranger = start("other-source-session");
  const denied = await call("other-source-session", stranger, "v5_source_update", { ...args, content: "foreign", expected_sha256: sha(source + "continued\n") });
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /UPDATE_EXPLICIT_COMMAND_REQUIRED/);
  assert.equal(await fs.readFile(made.structuredContent.data.path, "utf8"), source + "continued\n");
});

test("existing Lisp requires exact source update authorization just like an existing Job", async () => {
  const session = "existing-lisp-update";
  const work = start(session);
  const folder = path.join(root, "libraries", "lisp", "existing", "engine");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "engine.lsp"), "(princ)\n");
  const args = { kind: "reusable-lisp", library_id: "existing", folder: "engine", relative_file: "engine.lsp", content: "(princ 1)\n", expected_sha256: sha("(princ)\n") };
  const denied = await call(session, work, "v5_source_update", args);
  assert.equal(denied.isError, true);
  assert.equal(grants.observeExplicitJobUpdateCommand(session, "cg/update"), true);
  grants.activateJobUpdateGrant(session, folder);
  const allowed = await call(session, work, "v5_source_update", args);
  assert.notEqual(allowed.isError, true, JSON.stringify(allowed));
  assert.equal(await fs.readFile(path.join(folder, "engine.lsp"), "utf8"), args.content);
});

test("publication through the shared library route ends new-source authoring permission", async () => {
  const session = "published-source-update";
  const work = start(session);
  const args = { kind: "reusable-job", library_id: "publication", folder: "published", relative_file: "JOB.md" };
  const made = await call(session, work, "v5_source_create", { ...args, content: source });
  assert.notEqual(made.isError, true, JSON.stringify(made));
  await publishManagedLibrary("job", "publication", "Published Job");
  const denied = await call(session, work, "v5_source_update", { ...args, content: "changed", expected_sha256: sha(source) });
  assert.equal(denied.isError, true);
  assert.equal(await fs.readFile(made.structuredContent.data.path, "utf8"), source);
});

test("only the exact canonical Human command creates an update request", () => {
  for (const text of ["cg/jobupdate", "please cg/update", "`cg/update`", "hãy sửa Job"]) {
    assert.equal(grants.observeExplicitJobUpdateCommand("command-source", text), false, text);
  }
  assert.equal(grants.observeExplicitJobUpdateCommand("command-source", "cg/update"), true);
});

test("external registration of the same authored source also ends its authoring exemption", async () => {
  const session = "external-published-source";
  const work = start(session);
  const args = { kind: "reusable-job", library_id: "external-published", folder: "job", relative_file: "JOB.md" };
  const made = await call(session, work, "v5_source_create", { ...args, content: source });
  assert.notEqual(made.isError, true, JSON.stringify(made));
  const published = await handlers.get("asset_register_external")({ kind: "job", library_id: "external-alias", name: "Registered source", folder_path: path.dirname(made.structuredContent.data.path) });
  assert.notEqual(published.isError, true, JSON.stringify(published));
  const denied = await call(session, work, "v5_source_update", { ...args, content: "changed", expected_sha256: sha(source) });
  assert.equal(denied.isError, true);
  assert.equal(await fs.readFile(made.structuredContent.data.path, "utf8"), source);
});

test("publishing one indexed package does not freeze another unfinished package in the library", async () => {
  const session = "unpublished-package";
  let work = start(session);
  const job = { kind: "reusable-job", library_id: "mixed", folder: "complete", relative_file: "JOB.md" };
  assert.notEqual((await call(session, work, "v5_source_create", { ...job, content: source })).isError, true);
  workApi.releaseSessionWork(session);
  work = start(session);
  const unfinished = { ...job, folder: "unfinished", relative_file: "notes.txt" };
  const made = await call(session, work, "v5_source_create", { ...unfinished, content: "notes" });
  assert.notEqual(made.isError, true, JSON.stringify(made));
  await publishManagedLibrary("job", "mixed", "Mixed library");
  const updated = await call(session, work, "v5_source_update", { ...unfinished, content: "more notes", expected_sha256: sha("notes") });
  assert.notEqual(updated.isError, true, JSON.stringify(updated));
});

test("MCP cg/update infers an unambiguous Lisp target and unlocks only that source", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createMcpServer, disposeMcpServerRuntime } = await import("../dist/cadgpt/server-factory.js");
  const session = "mcp-lisp-update";
  const work = start(session);
  const folder = path.join(root, "libraries", "lisp", "mcp-lib", "engine");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "engine.lsp"), "(princ)\n");
  const server = createMcpServer(session);
  const client = new Client({ name: "update-regression", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const observed = await client.callTool({ name: "cadgpt_admission", arguments: { user_turn: "cg/update", invocation_source: "plugin" } });
    assert.notEqual(observed.isError, true, JSON.stringify(observed));
    const selected = await client.callTool({ name: "cadgpt_control", arguments: { surface: "update", job_library_id: "mcp-lib", job_folder: "engine" } });
    assert.notEqual(selected.isError, true, JSON.stringify(selected));
    assert.match(selected.structuredContent.text, /authorized/i);
    const edited = await client.callTool({ name: "v5_source_update", arguments: { execution_id: work.executionId, authority_token: work.authorityToken, kind: "reusable-lisp", library_id: "mcp-lib", folder: "engine", relative_file: "engine.lsp", content: "(princ 2)\n", expected_sha256: sha("(princ)\n") } });
    assert.notEqual(edited.isError, true, JSON.stringify(edited));
    assert.equal(await fs.readFile(path.join(folder, "engine.lsp"), "utf8"), "(princ 2)\n");
    await client.callTool({ name: "cadgpt_admission", arguments: { user_turn: "cg/update", invocation_source: "plugin" } });
    const reused = await client.callTool({ name: "cadgpt_control", arguments: { surface: "update" } });
    assert.match(reused.structuredContent.text, /authorized/i);
    assert(reused.structuredContent.text.includes(folder));
    const oldRoute = await client.callTool({ name: "cadgpt_control", arguments: { surface: "jobupdate" } });
    assert.equal(oldRoute.isError, true);
    assert.equal(workApi.activeWorkForSession(session)?.executionId, work.executionId);
  } finally {
    await client.close();
    await disposeMcpServerRuntime(server);
  }
});

test("a queued source edit rechecks authoring permission after publication revocation", async () => {
  const session = "queued-edit";
  const work = start(session);
  const args = { kind: "reusable-job", library_id: "queued", folder: "job", relative_file: "JOB.md" };
  const made = await call(session, work, "v5_source_create", { ...args, content: source });
  assert.notEqual(made.isError, true, JSON.stringify(made));
  let pending;
  const libraryRoot = path.join(root, "libraries", "jobs", "queued");
  await grants.withSourcePublication(async () => {
    pending = call(session, work, "v5_source_update", { ...args, content: "queued write", expected_sha256: sha(source) });
    grants.finishSourceAuthoringInLibrary(libraryRoot, ["job/JOB.md"]);
  });
  const denied = await pending;
  assert.equal(denied.isError, true);
  assert.equal(await fs.readFile(made.structuredContent.data.path, "utf8"), source);
});

test("independent source edits overlap while publication orders queued edits behind its commit", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const bothStarted = new Promise(resolve => { started = resolve; });
  const events = [];
  let count = 0;
  const edit = name => grants.withSourceMutation(async () => {
    events.push(name + ":start");
    if (++count === 2) started();
    await gate;
    events.push(name + ":done");
  });
  const first = edit("first");
  const second = edit("second");
  await bothStarted;
  const publication = grants.withSourcePublication(async () => { events.push("published"); });
  const queued = grants.withSourceMutation(async () => { events.push("queued"); });
  release();
  await Promise.all([first, second, publication, queued]);
  assert(events.indexOf("first:start") < events.indexOf("second:done"));
  assert(events.indexOf("second:start") < events.indexOf("first:done"));
  assert(events.indexOf("published") > events.indexOf("first:done"));
  assert(events.indexOf("published") > events.indexOf("second:done"));
  assert(events.indexOf("queued") > events.indexOf("published"));
});

test("registration of an ancestor directory cannot preserve a published source exemption", async () => {
  const session = "ancestor-published-source";
  const work = start(session);
  const args = { kind: "reusable-job", library_id: "ancestor-source", folder: "job", relative_file: "JOB.md" };
  const made = await call(session, work, "v5_source_create", { ...args, content: source });
  assert.notEqual(made.isError, true, JSON.stringify(made));
  const [published] = await Promise.all([
    handlers.get("asset_register_external")({ kind: "job", library_id: "ancestor-alias", name: "Ancestor registration", folder_path: path.join(root, "libraries", "jobs") }),
    call(session, work, "v5_source_update", { ...args, content: "concurrent", expected_sha256: sha(source) }),
  ]);
  assert.notEqual(published.isError, true, JSON.stringify(published));
  const pathToSource = made.structuredContent.data.path;
  const bytes = await fs.readFile(pathToSource, "utf8");
  const denied = await call(session, work, "v5_source_update", { ...args, content: "after publication", expected_sha256: sha(bytes) });
  assert.equal(denied.isError, true);
  assert.equal(await fs.readFile(pathToSource, "utf8"), bytes);
});
