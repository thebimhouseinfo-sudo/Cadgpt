import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-job-a-b-"));
const priorEnv = process.env.CADGPT_APPDATA_ROOT;
process.env.CADGPT_APPDATA_ROOT = appRoot;

const { checkAdmission, revokeSessionAdmissions } = await import("../dist/cadgpt/lib/admission.js");
const registration = await import("../dist/cadgpt/lib/work-registration.js");
const persistence = await import("../dist/cadgpt/runtime/drawing-persistence.js");
const runtime = await import("../dist/cadgpt/runtime/job-runtime.js");
const { cleanupExecutionState } = await import("../dist/cadgpt/runtime/execution-cleanup.js");
const { registerWorkControlTools } = await import("../dist/cadgpt/tools/work-control.js");
const { registerJobAuthoringTools } = await import("../dist/cadgpt/tools/jobs.js");
const { registerFilesystemTools } = await import("../dist/cadgpt/tools/filesystem.js");

const callbacks = new Map();
const server = { registerTool(name, _conf, callback) { callbacks.set(name, callback); } };
registerWorkControlTools(server, {
  sessionKey: "job-a-b-regression",
  async prepareFamilies() { return {}; },
  async upgradeToHybrid() { throw Error("unexpected CAD upgrade"); },
});
registerJobAuthoringTools(server);
registerFilesystemTools(server);

const session = "job-a-b-regression";
checkAdmission(session, "@cg", "mention");

const workA = registration.createWorkRegistration({
  sessionKey: session, ownerType: "job", ownerId: "grille-tag", executionPath: "hybrid",
});
const root = path.join(appRoot, "drawings", "MAGS-verified-anchor");
const grilleFile = path.join(root, "jobs", "grille-tag-result", "grilles.json");
await fs.mkdir(path.dirname(grilleFile), { recursive: true });
await fs.writeFile(grilleFile, '{"FCU-MP-10-S1":"450x250"}\n', "utf8");
persistence.authorizeDrawingMetadataRootForExecution(workA.executionId, root);

test("A hybrid Grille Tag → B file-only Create System inherits only verified drawing read authority", async () => {
  const started = await callbacks.get("cadgpt_work_start")({
    owner_type: "job", owner_id: "create-system", execution_path: "file",
  });
  assert.equal(started.structuredContent?.data?.reused, false, JSON.stringify(started));
  assert.equal(started.structuredContent?.data?.drawing_metadata_handoff?.inherited, true);
  assert.equal(started.structuredContent?.data?.drawing_metadata_handoff?.drawing_root, root);
  const handle = started.structuredContent.data.work_handle;
  const workB = registration.activeWorkForSession(session);
  assert.equal(handle.execution_id, workB.executionId);
  assert.equal(workB.executionPath, "file");
  assert.deepEqual(persistence.drawingMetadataRootsForExecution(workB.executionId), [root]);
  assert.deepEqual(persistence.drawingMetadataWritableRootsForExecution(workB.executionId), []);

  // Delayed cleanup of A cannot revoke B or remove A's existing persisted data.
  await cleanupExecutionState(workA.executionId);
  assert.equal(await fs.readFile(grilleFile, "utf8"), '{"FCU-MP-10-S1":"450x250"}\n');
  assert.deepEqual(persistence.drawingMetadataRootsForExecution(workB.executionId), [root]);

  const fileReadLease = registration.acquireToolLease({
    tool: "file_read", family: "filesystem", targetId: grilleFile,
    executionId: workB.executionId, authorityToken: workB.authorityToken, sessionKey: session,
  });
  const resultA = await registration.runWithToolLease(fileReadLease,
    () => callbacks.get("file_read")({ path: grilleFile }));
  assert.equal(resultA.structuredContent?.data?.content, '{"FCU-MP-10-S1":"450x250"}\n');

  const deniedLease = registration.acquireToolLease({
    tool: "file_create", family: "filesystem", targetId: path.join(root, "unowned.json"),
    executionId: workB.executionId, authorityToken: workB.authorityToken, sessionKey: session,
  });
  const denied = await registration.runWithToolLease(deniedLease,
    () => callbacks.get("file_create")({path:path.join(root,"unowned.json"),content:"no"}));
  assert.equal(denied.structuredContent?.ok, false, "handoff is read-only until B prepares its result");

  const draft = path.join(appRoot, "workspace", "job-draft", "fixture", "create-system", "JOB.md");
  await fs.mkdir(path.dirname(draft), {recursive:true});
  await fs.writeFile(draft, "# Job: Create System\n## Step 1\n- Executor: FILE\n", "utf8");
  const lease = registration.acquireToolLease({
    tool: "job_runtime_prepare", family: "job-authoring", targetId: draft,
    executionId: workB.executionId, authorityToken: workB.authorityToken, sessionKey: session,
  });
  const prepared = await registration.runWithToolLease(lease,
    () => callbacks.get("job_runtime_prepare")({draft_path:draft}));
  assert.equal(prepared.structuredContent?.ok, true, JSON.stringify(prepared));
  const resultRoot = path.join(root,"jobs","create-system-result");
  assert.equal(prepared.structuredContent.data.drawing_result.absolute_path, resultRoot);
  assert.equal(prepared.structuredContent.data.drawing_metadata_read_only, true,
    "metadata handoff stays read only, even after B gets its own writable result");
  assert.deepEqual(runtime.jobRuntimeWritableRootsForExecution(workB.executionId).includes(resultRoot), true);

  const output = path.join(resultRoot, "system.json");
  const writeLease = registration.acquireToolLease({
    tool: "file_create", family: "filesystem", targetId: output,
    executionId: workB.executionId, authorityToken: workB.authorityToken, sessionKey: session,
  });
  const wrote = await registration.runWithToolLease(writeLease,
    () => callbacks.get("file_create")({path:output,content:'{"FCU-MP-10-S1":"450x250"}'}));
  assert.equal(wrote.structuredContent?.ok,true,JSON.stringify(wrote));
  assert.equal(await fs.readFile(output,"utf8"),'{"FCU-MP-10-S1":"450x250"}');

  // No write to Grille Tag's result, even after B prepares its own runtime.
  const otherLease = registration.acquireToolLease({
    tool: "file_create", family:"filesystem",targetId:path.join(root,"jobs","grille-tag-result","should-not-exist.json"),
    executionId:workB.executionId,authorityToken:workB.authorityToken,sessionKey:session,
  });
  const other = await registration.runWithToolLease(otherLease,
    () => callbacks.get("file_create")({path:path.join(root,"jobs","grille-tag-result","should-not-exist.json"),content:"bad"}));
  assert.equal(other.structuredContent?.ok,false);

  // A new work C can reuse B's already-authorized root without CAD restart.
  const c = await callbacks.get("cadgpt_work_start")({
    owner_type:"job",owner_id:"grille-tag",execution_path:"file",
  });
  assert.equal(c.structuredContent?.data?.drawing_metadata_handoff?.inherited,true,JSON.stringify(c));
  const workC = registration.activeWorkForSession(session);
  assert.deepEqual(persistence.drawingMetadataRootsForExecution(workC.executionId),[root]);
  assert.deepEqual(persistence.drawingMetadataWritableRootsForExecution(workC.executionId),[]);
});

test("cannot hand off arbitrary, ambiguous, cross-session or unauthenticated drawing roots", async () => {
  const source = "test-exec-source";
  const dest = "test-exec-dest";
  assert.equal(persistence.handoffVerifiedDrawingMetadataRoot(source,dest),null);
  assert.deepEqual(persistence.drawingMetadataRootsForExecution(dest),[]);
  assert.throws(() => persistence.authorizeDrawingMetadataRootForExecution(source, appRoot),
    /DRAWING_METADATA_SCOPE/);
  const secondRoot=path.join(appRoot,"drawings","another");
  persistence.authorizeDrawingMetadataRootForExecution(source,root);
  persistence.authorizeDrawingMetadataRootForExecution(source,secondRoot);
  assert.equal(persistence.handoffVerifiedDrawingMetadataRoot(source,dest),null,"no guess with multiple bindings");
  assert.deepEqual(persistence.drawingMetadataRootsForExecution(dest),[]);
  await persistence.cleanupDrawingMetadataForExecution(source);
  await persistence.cleanupDrawingMetadataForExecution(dest);

  const otherSession="job-a-b-other";
  checkAdmission(otherSession,"@cg","mention");
  const otherWork=registration.createWorkRegistration({
    sessionKey:otherSession,ownerType:"job",ownerId:"create-system",executionPath:"file",
  });
  assert.deepEqual(persistence.drawingMetadataRootsForExecution(otherWork.executionId),[]);
  registration.releaseWorkRegistration(otherWork.executionId,otherWork.authorityToken,otherSession);
  revokeSessionAdmissions(otherSession);
});

test("handoff transfers empty-root cleanup ownership so Job A cannot delete Job B's pending root", async () => {
  const source="empty-a-" + Date.now();
  const target="empty-b-" + Date.now();
  const folder=path.join(appRoot,"drawings","empty-test-anchor");
  await fs.mkdir(folder,{recursive:true});
  persistence.registerCreatedDrawingMetadataFolderForExecution(source,folder);
  assert.equal(persistence.handoffVerifiedDrawingMetadataRoot(source,target),folder);
  assert.deepEqual(persistence.drawingMetadataWritableRootsForExecution(target),[],
    "new execution receives only read permission");
  await persistence.cleanupDrawingMetadataForExecution(source);
  assert.equal((await fs.stat(folder)).isDirectory(),true,"A cleanup cannot remove B's root");
  const end=await persistence.cleanupDrawingMetadataForExecution(target);
  assert.equal(end.deleted_empty,true,"B cleanup can reclaim an unused folder");
});

test.after(async () => {
  const current=registration.activeWorkForSession(session);
  if(current){
    await runtime.cleanupJobRuntimeForExecution(current.executionId);
    await persistence.cleanupDrawingMetadataForExecution(current.executionId);
    registration.releaseWorkRegistration(current.executionId,current.authorityToken,session);
  }
  revokeSessionAdmissions(session);
  if(priorEnv===undefined) delete process.env.CADGPT_APPDATA_ROOT;
  else process.env.CADGPT_APPDATA_ROOT=priorEnv;
  await fs.rm(appRoot,{recursive:true,force:true});
});
