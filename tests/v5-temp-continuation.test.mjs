import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "cg-temp-continuation-"));
process.env.CADGPT_APPDATA_ROOT = root;
const admission = await import("../dist/cadgpt/lib/admission.js");
const workApi = await import("../dist/cadgpt/lib/work-registration.js");
const temp = await import("../dist/cadgpt/runtime/temp-job-v5.js");
const { cleanupExecutionState } = await import("../dist/cadgpt/runtime/execution-cleanup.js");
const { registerTempJobV5Tools } = await import("../dist/cadgpt/tools/temp-jobs-v5.js");
const handlers = new Map();
registerTempJobV5Tools({ registerTool(name, _config, callback) { handlers.set(name, callback); } });
const sessions = new Set();
function start(session) {
  sessions.add(session); admission.checkAdmission(session, "@cg", "mention");
  return workApi.createWorkRegistration({ sessionKey: session, ownerType: "file", ownerId: "job-authoring", executionPath: "file" });
}
function call(session, work, name, args) {
  const lease = workApi.acquireToolLease({ sessionKey: session, executionId: work.executionId, authorityToken: work.authorityToken, tool: name, family: "filesystem" });
  return workApi.runWithToolLease(lease, () => handlers.get(name)(args));
}
test.after(async () => {
  for (const session of sessions) { workApi.releaseSessionWork(session); admission.revokeSessionAdmissions(session); }
  await fs.rm(root, { recursive: true, force: true });
});

test("Temp source read returns exact text and hash for safe correction", async () => {
  assert.equal(typeof handlers.get("temp_job_source_read"), "function");
  const session = "temp-read"; const work = start(session);
  const made = await temp.createTempJob(work.executionId, session);
  const content = '(princ "Cửa gió")\n';
  await temp.writeTempSource(made.id, work.executionId, session, "lisp/test.lsp", content);
  const read = await call(session, work, "temp_job_source_read", { id: made.id, relative_path: "lisp/test.lsp" });
  assert.notEqual(read.isError, true, JSON.stringify(read));
  assert.equal(read.structuredContent.data.content, content);
  assert.equal(read.structuredContent.data.sha256, createHash("sha256").update(content).digest("hex"));
  assert.equal(read.structuredContent.data.bytes, Buffer.byteLength(content));
  const updated = await call(session, work, "temp_job_source_update", { id: made.id, relative_path: "lisp/test.lsp", content: "(princ 1)\n", expected_sha256: read.structuredContent.data.sha256 });
  assert.notEqual(updated.isError, true, JSON.stringify(updated));
});

test("same-session Temp source continues across Work cleanup while stale and foreign callers fail", async () => {
  const session = "temp-continuation"; let work = start(session);
  const old = work;
  const made = await temp.createTempJob(work.executionId, session);
  const written = await temp.writeTempSource(made.id, work.executionId, session, "script.py", "print(1)\n");
  workApi.releaseSessionWork(session); await cleanupExecutionState(work.executionId);
  work = start(session);
  const updated = await temp.updateTempSource(made.id, work.executionId, session, "script.py", "print(2)\n", written.sha256);
  assert(updated.sha256);
  assert.equal(await temp.getOwnedTempPython(made.id, work.executionId, session, "script.py"), written.path);
  await assert.rejects(temp.updateTempSource(made.id, old.executionId, session, "script.py", "bad", updated.sha256), /TEMP_JOB_NOT_OWNED/);
  const foreign = start("foreign-temp-session");
  await assert.rejects(temp.updateTempSource(made.id, foreign.executionId, "foreign-temp-session", "script.py", "bad", updated.sha256), /TEMP_JOB_NOT_OWNED/);
  assert.equal(await fs.readFile(written.path, "utf8"), "print(2)\n");
});

test("cleanup preserves an owned Temp while its successor Work is active", async () => {
  const session = "temp-cleanup-successor"; let work = start(session);
  const made = await temp.createTempJob(work.executionId, session);
  await temp.writeTempSource(made.id, work.executionId, session, "notes.txt", "unfinished");
  workApi.releaseSessionWork(session); work = start(session);
  const held = await temp.clearTempJobs(made.id);
  assert.deepEqual(held.removed, []);
  assert.equal(held.skipped.length, 1);
  assert.equal(await fs.readFile(path.join(made.root, "notes.txt"), "utf8"), "unfinished");
  workApi.releaseSessionWork(session);
  const cleared = await temp.clearTempJobs(made.id);
  assert.deepEqual(cleared.removed, [made.id]);
});

test("source APIs reject ownership metadata case variants and completed mutation", async () => {
  const session = "temp-meta-protection"; const work = start(session);
  const made = await temp.createTempJob(work.executionId, session);
  const metadata = await fs.readFile(path.join(made.root, ".temp-job.json"));
  await assert.rejects(temp.writeTempSource(made.id, work.executionId, session, ".TEMP-JOB.JSON", "{}"), /TEMP_JOB_METADATA_PROTECTED/);
  await temp.writeTempSource(made.id, work.executionId, session, "notes.txt", "notes");
  await temp.finishTempJob(made.id, work.executionId, session);
  await assert.rejects(temp.writeTempSource(made.id, work.executionId, session, "late.txt", "late"), /TEMP_JOB_ALREADY_DONE/);
  const after = JSON.parse(await fs.readFile(path.join(made.root, ".temp-job.json"), "utf8"));
  assert.equal(after.owner_session, JSON.parse(metadata).owner_session);
  assert.equal(after.state, "done");
});

test("Temp read denies foreign owners, traversal, metadata", async () => {
  assert.equal(typeof handlers.get("temp_job_source_read"), "function");
  const session = "temp-read-scope"; const work = start(session);
  const made = await temp.createTempJob(work.executionId, session);
  await temp.writeTempSource(made.id, work.executionId, session, "notes.txt", "private");
  const other = start("temp-reader-foreign");
  const foreign = await call("temp-reader-foreign", other, "temp_job_source_read", { id: made.id, relative_path: "notes.txt" });
  assert.equal(foreign.isError, true);
  for (const relative of ["../escape.txt", ".temp-job.json", ".TEMP-JOB.JSON"]) {
    const denied = await call(session, work, "temp_job_source_read", { id: made.id, relative_path: relative });
    assert.equal(denied.isError, true, relative);
  }
});


test("Temp source read rejects symlink escape", async (t) => {
  const session = "temp-symlink"; const work = start(session);
  const made = await temp.createTempJob(work.executionId, session);
  const outside = path.join(root, "outside-secret.txt");
  await fs.writeFile(outside, "secret");
  try { await fs.symlink(outside, path.join(made.root, "linked.txt")); }
  catch (error) { if (error.code === "EPERM") return t.skip("Windows symlink privilege unavailable"); throw error; }
  const denied = await call(session, work, "temp_job_source_read", { id: made.id, relative_path: "linked.txt" });
  assert.equal(denied.isError, true);
  assert.equal(JSON.stringify(denied).includes('"content":"secret"'), false);
});


test("cleanup preserves Temp while a closing session still has an in-flight tool", async () => {
  const session = "temp-cleanup-inflight"; const work = start(session);
  const made = await temp.createTempJob(work.executionId, session);
  await temp.writeTempSource(made.id, work.executionId, session, "notes.txt", "in progress");
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { finish = resolve; });
  const lease = workApi.acquireToolLease({ sessionKey: session, executionId: work.executionId, authorityToken: work.authorityToken, tool: "temp_job_source_read", family: "filesystem" });
  const pending = workApi.runWithToolLease(lease, async () => { entered(); await held; });
  await started;
  try {
    workApi.releaseSessionWork(session);
    assert.equal(workApi.activeWorkForSession(session), null);
    const cleanup = await temp.clearTempJobs(made.id);
    assert.deepEqual(cleanup.removed, []);
    assert.equal(cleanup.skipped.length, 1);
  } finally { finish(); await pending; }
  assert.deepEqual((await temp.clearTempJobs(made.id)).removed, [made.id]);
});
