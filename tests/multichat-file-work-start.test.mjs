import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("different chat starts FILE-only MTO on Host anchor without waking CAD", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-file-join-"));
  const prior = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const binding = await import("../dist/cadgpt/session/drawing-binding.js");
  const metadata = await import("../dist/cadgpt/runtime/drawing-persistence.js");
  const registration = await import("../dist/cadgpt/lib/work-registration.js");
  const admission = await import("../dist/cadgpt/lib/admission.js");
  const { registerWorkControlTools } = await import("../dist/cadgpt/tools/work-control.js");
  const { cadUpstream } = await import("../dist/cadgpt/runtime/cad-upstream.js");
  const runtime = await import("../dist/cadgpt/runtime/job-runtime.js");
  const callbacks = new Map();
  const fake = { registerTool(name, _spec, cb) { callbacks.set(name, cb); } };
  const session = "chat-B-file-only-mto";
  const originalCad = cadUpstream.callTool;
  try {
    binding.selectPrimaryBoundDrawing({
      drawing_id:"dwg_primary",drawing_anchor:"verified-MAGS",
      anchor_verified_readback:true,anchor_schema_version:1,
      execution_id:"chat-A", name:"MAGS.dwg",full_name:"C:/MAGS.dwg",
      runtime_document_identity:"life-A",document_selector:"C:/MAGS.dwg",
      host:"autocad",bound_at:new Date().toISOString(),
    });
    const source = path.join(root,"drawings","verified-MAGS","jobs","create-system-result","systems.json");
    await fs.mkdir(path.dirname(source),{recursive:true});
    await fs.writeFile(source,'{"systems":12}');
    cadUpstream.callTool = async () => {throw new Error("FILE-only chat must not call CAD MCP");};
    admission.checkAdmission(session,"@cg","mention");
    registerWorkControlTools(fake,{
      sessionKey:session,
      async prepareFamilies(){return {};},
      async upgradeToHybrid(){throw new Error("unexpected upgrade");},
    });
    const start = await callbacks.get("cadgpt_work_start")({
      owner_type:"job", owner_id:"mto", execution_path:"file", job_nonhybrid_path:"file",
    });
    assert.equal(start.structuredContent?.ok,true,JSON.stringify(start));
    const started = start.structuredContent.data;
    const execution = started.work_handle.execution_id;
    assert.equal(started.work_handle.execution_path,"file");
    assert.equal(started.shared_drawing_metadata?.read_only,true);
    assert.equal(await fs.readFile(source,"utf8"),'{"systems":12}');
    assert.deepEqual(metadata.drawingMetadataWritableRootsForExecution(execution),[]);
    assert.deepEqual(binding.getBoundDrawingsForExecution(execution),[]);
    const draft = path.join(root,"workspace","job-draft","mto","JOB.md");
    await fs.mkdir(path.dirname(draft),{recursive:true});
    await fs.writeFile(draft,"# MTO");
    await runtime.prepareJobRuntimeForExecution(execution,"mto",draft);
    const result = await runtime.prepareJobResultLocationForExecution(execution,started.shared_drawing_metadata.drawing_root);
    assert.equal(result.absolute_path.endsWith(path.join("jobs","mto-result")),true);
    assert.equal(runtime.jobRuntimeWritableRootsForExecution(execution).includes(result.absolute_path),true);
    assert.equal(runtime.jobRuntimeWritableRootsForExecution(execution).includes(path.dirname(source)),false);
    await runtime.cleanupJobRuntimeForExecution(execution);
    await metadata.cleanupDrawingMetadataForExecution(execution);
    const released = registration.releaseSessionWork(session);
    assert.equal(released, execution);
  } finally {
    cadUpstream.callTool = originalCad;
    admission.revokeSessionAdmissions(session);
    if(prior===undefined)delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT=prior;
    await fs.rm(root,{recursive:true,force:true});
  }
});
