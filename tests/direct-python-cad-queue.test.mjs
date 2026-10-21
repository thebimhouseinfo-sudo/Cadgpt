import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("declared file-only Direct Python runs outside CAD Host lock; unknown legacy Direct stays serialized", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-direct-fifo-"));
  const savedRoot = process.env.CADGPT_APPDATA_ROOT;
  const savedPython = process.env.CAD_MCP_PYTHON;
  process.env.CADGPT_APPDATA_ROOT = root;
  process.env.CAD_MCP_PYTHON = "python";
  const { cadUpstream } = await import("../dist/cadgpt/runtime/cad-upstream.js");
  const { bindDrawingForExecution } = await import("../dist/cadgpt/session/drawing-binding.js");
  const { executeDirectJobScript } = await import("../dist/cadgpt/tools/jobs.js");
  const { withCadHostLock } = await import("../dist/cadgpt/runtime/cad-scheduler.js");
  const auth = await import("../dist/cadgpt/lib/admission.js");
  const work = await import("../dist/cadgpt/lib/work-registration.js");
  const metadata = await import("../dist/cadgpt/runtime/drawing-persistence.js");
  const originalCall = cadUpstream.callTool;
  const session = "fifo-direct-chat";
  const draft = path.join(root,"workspace","job-draft","mto","mto.py");
  const start = path.join(root,"workspace","job-draft","mto","runtime","started");
  let handle;
  try {
    await fs.mkdir(path.dirname(draft), {recursive:true});
    await fs.writeFile(draft, [
      "import os, time",
      "from pathlib import Path",
      "Path(os.environ['CADGPT_JOB_RUNTIME_ROOT'], 'started').write_text('yes')",
      "time.sleep(0.8)",
      "print('file processing complete')",
    ].join("\n"));
    cadUpstream.callTool = async (name) => {
      if (name === "acad_list_open_documents") {
        return [{
          name:"MAGS.dwg",full_name:"C:/MAGS.dwg",
          runtime_document_id:"life-fifo",host:"autocad",
        }];
      }
      if (name === "acad_set_active_document") {
        return {structuredContent:{runtime_document_id:"life-fifo"}};
      }
      if (name === "acad_save_bound_document") {
        return {structuredContent:{saved:true,runtime_document_id:"life-fifo"}};
      }
      if (name === "cad_ensure_drawing_anchor") {
        return {structuredContent:{drawing_anchor:"FIFO-verified",schema_version:1,state:"existing",verified_readback:true}};
      }
      throw new Error("Unexpected CAD call: "+name);
    };
    auth.checkAdmission(session,"@cg","mention");
    handle=work.createWorkRegistration({sessionKey:session,ownerType:"job",ownerId:"mto",executionPath:"hybrid"});
    await bindDrawingForExecution(handle.executionId,"MAGS.dwg");
    const run = (fileOnly) => {
      const lease=work.acquireToolLease({
        tool:"job_run_direct",family:"job-authoring",targetId:draft,
        sessionKey:session,executionId:handle.executionId,authorityToken:handle.authorityToken,
      });
      return work.runWithToolLease(lease, () =>
        executeDirectJobScript(draft,[],"mto",{fileOnly}));
    };

    // The file-only child has started, and is still sleeping when a second
    // chat's queued CAD command must be able to enter the Host lock.
    const fileRun=run(true);
    for(let i=0;i<300;i++){
      if(await fs.stat(start).then(()=>true,()=>false))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(await fs.stat(start).then(()=>true,()=>false),true);
    let fileFinished=false;
    fileRun.then(()=>{fileFinished=true;});
    await withCadHostLock("autocad",async()=>{});
    assert.equal(fileFinished,false,"CAD command must not wait for Python/Excel completion");
    const fileResult=await fileRun;
    assert.match(fileResult.stdout,/file processing complete/);

    // Without the declared file-only contract, preserve CAD serialization.
    await fs.rm(start,{force:true});
    const legacyRun=run(false);
    for(let i=0;i<300;i++){
      if(await fs.stat(start).then(()=>true,()=>false))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(await fs.stat(start).then(()=>true,()=>false),true);
    let entered=false;
    const waiting=withCadHostLock("autocad",async()=>{entered=true;});
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(entered,false,"unknown legacy Python must keep existing CAD protection");
    const legacyResult=await legacyRun;
    assert.equal(legacyResult.saved_document,true);
    await waiting;
    assert.equal(entered,true);
  } finally {
    cadUpstream.callTool=originalCall;
    if(handle) {
      await metadata.cleanupDrawingMetadataForExecution(handle.executionId);
      work.releaseSessionWork(session);
    }
    auth.revokeSessionAdmissions(session);
    if(savedRoot===undefined)delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT=savedRoot;
    if(savedPython===undefined)delete process.env.CAD_MCP_PYTHON;
    else process.env.CAD_MCP_PYTHON=savedPython;
    await fs.rm(root,{recursive:true,force:true});
  }
});
