import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("new Job in a different chat preserves MTO SYSTEM owner and its raw files", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-job-switch-"));
  const original = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = temp;
  const admission = await import("../dist/cadgpt/lib/admission.js");
  const registration = await import("../dist/cadgpt/lib/work-registration.js");
  const runtime = await import("../dist/cadgpt/runtime/job-runtime.js");
  const system = await import("../dist/cadgpt/runtime/system-lease.js");
  const transition = await import("../dist/cadgpt/runtime/job-transition.js");
  const suffix = path.basename(temp);
  const oldChat = "mto-chat-" + suffix;
  const newChat = "grille-chat-" + suffix;
  for (const key of [oldChat, newChat]) admission.checkAdmission(key, "@cg", "mention");

  const mto = registration.createWorkRegistration({
    sessionKey: oldChat, ownerType: "job", ownerId: "mto-refno-hardgate", executionPath: "file"
  });
  const grille = registration.createWorkRegistration({
    sessionKey: newChat, ownerType: "job", ownerId: "grille-tag", executionPath: "file"
  });
  try {
    const job = path.join(temp, "libraries", "jobs", "fixture", "mto", "JOB.md");
    await fs.mkdir(path.dirname(job), { recursive: true });
    await fs.writeFile(job, "# MTO\n");
    const prepared = await runtime.prepareJobRuntimeForExecution(mto.executionId, "mto-refno-hardgate", job);
    const raw = path.join(prepared.runtime_root, "unprocessed-mto-raw.json");
    await fs.writeFile(raw, '{"pending":true}\n');
    const lease = system.acquireJobSystemLease({
      toolId: "mto-refno-hardgate", jobId: "mto-refno-hardgate",
      jobName: "MTO", sessionKey: oldChat,
      readableRoots: [], writableRoots: [prepared.runtime_root]
    });
    runtime.detachJobRuntimeForSystemLease(mto.executionId, lease.tool_id);
    await assert.rejects(
      runtime.prepareJobRuntimeForExecution("another-owner", "mto-refno-hardgate", job),
      /JOB_RUNTIME_BUSY/
    );
    const switched = await transition.releasePriorJobAuthorityForStart({
      executionId: grille.executionId, sessionKey: newChat
    });
    assert.deepEqual(switched.retired_other_sessions.system_jobs, []);
    assert.deepEqual(system.allActiveJobSystemLeases().map(x=>x.job_id), ["mto-refno-hardgate"]);
    assert.deepEqual(runtime.activeDetachedJobRuntimeToolIds(), ["mto-refno-hardgate"]);
    assert.equal(registration.activeExecutionForSession(oldChat), mto.executionId);
    assert.equal(await fs.readFile(raw, "utf8"), '{"pending":true}\n');
    await system.runWithJobSystemLease(lease, async () => null);
    await assert.rejects(
      runtime.prepareJobRuntimeForExecution(grille.executionId, "mto-refno-hardgate", job),
      /JOB_RUNTIME_BUSY/,
      "the same Job root is exclusive even across independent chats"
    );
    const grilleJob = path.join(temp, "libraries", "jobs", "fixture", "grille", "JOB.md");
    await fs.mkdir(path.dirname(grilleJob), { recursive: true });
    await fs.writeFile(grilleJob, "# Grille\n");
    const after = await runtime.prepareJobRuntimeForExecution(
      grille.executionId, "grille-tag", grilleJob
    );
    assert.equal(after.job_id, "grille-tag", "different Job roots may run at the same time");
    await runtime.cleanupJobRuntimeForExecution(grille.executionId);
    system.releaseJobSystemLease(lease.tool_id, oldChat);
    await runtime.cleanupJobRuntimeForSystemLease(lease.tool_id);
  } finally {
    for (const [chat, work] of [[oldChat, mto], [newChat, grille]]) {
      if (registration.activeExecutionForSession(chat)) {
        registration.releaseWorkRegistration(work.executionId, work.authorityToken, chat);
      }
      admission.revokeSessionAdmissions(chat);
    }
    if (original === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = original;
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("new Job does not block an in-flight SYSTEM tool in another chat; host-close remains guarded", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-job-inflight-"));
  const original = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = temp;
  const admission = await import("../dist/cadgpt/lib/admission.js");
  const registration = await import("../dist/cadgpt/lib/work-registration.js");
  const runtime = await import("../dist/cadgpt/runtime/job-runtime.js");
  const system = await import("../dist/cadgpt/runtime/system-lease.js");
  const transition = await import("../dist/cadgpt/runtime/job-transition.js");
  const suffix = path.basename(temp), oldChat = "old-" + suffix, newChat = "new-" + suffix;
  for (const chat of [oldChat, newChat]) admission.checkAdmission(chat, "@cg", "mention");
  const a = registration.createWorkRegistration({
    sessionKey: oldChat, ownerType: "job", ownerId: "mto", executionPath: "file"
  });
  const b = registration.createWorkRegistration({
    sessionKey: newChat, ownerType: "job", ownerId: "tag", executionPath: "file"
  });
  let releaseTask;
  const pending = new Promise(resolve => { releaseTask = resolve; });
  try {
    const file = path.join(temp, "libraries", "jobs", "fixture", "mto", "JOB.md");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "# MTO\n");
    const prepared = await runtime.prepareJobRuntimeForExecution(a.executionId, "mto", file);
    const lease = system.acquireJobSystemLease({
      toolId:"mto",jobId:"mto",jobName:"MTO",sessionKey:oldChat,
      readableRoots:[],writableRoots:[prepared.runtime_root]
    });
    runtime.detachJobRuntimeForSystemLease(a.executionId,lease.tool_id);
    let running = false;
    const active = system.runWithJobSystemLease(lease, async () => {
      running = true;
      await pending;
    });
    assert.equal(running, true);
    const other = await transition.releasePriorJobAuthorityForStart({
      executionId:b.executionId,sessionKey:newChat
    });
    assert.deepEqual(other.retired_other_sessions.system_jobs, []);
    assert.equal(system.allActiveJobSystemLeases().length, 1, "other chat's active SYSTEM lease must survive");
    assert.equal(registration.activeExecutionForSession(oldChat), a.executionId);
    await assert.rejects(
      transition.terminalizeIdleJobAuthorities({reason:"cad_host_closed"}),
      /JOB_TRANSITION_BUSY/,
      "host-close is guarded while a SYSTEM tool is still in flight"
    );
    releaseTask();
    await active;
    const ended = await transition.terminalizeIdleJobAuthorities({
      reason:"cad_host_closed"
    });
    assert.deepEqual(ended.system_jobs,["mto"]);
    assert.equal(system.allActiveJobSystemLeases().length,0);
    assert.equal(registration.activeExecutionForSession(oldChat),null);
    assert.equal(registration.activeExecutionForSession(newChat),null);
  } finally {
    releaseTask();
    for (const [chat, work] of [[oldChat,a],[newChat,b]]) {
      if (registration.activeExecutionForSession(chat)) {
        registration.releaseWorkRegistration(work.executionId,work.authorityToken,chat);
      }
      admission.revokeSessionAdmissions(chat);
    }
    if (original===undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT=original;
    await fs.rm(temp,{recursive:true,force:true});
  }
});
