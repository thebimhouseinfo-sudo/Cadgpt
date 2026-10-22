import test from 'node:test';
import assert from 'node:assert/strict';
import { cadUpstream } from '../dist/cadgpt/runtime/cad-upstream.js';
import { syncCadBusinessProxies } from '../dist/cadgpt/tools/cad-proxy.js';
import { bindDrawingForExecution, clearExecutionDrawingContexts } from '../dist/cadgpt/session/drawing-binding.js';
import * as work from '../dist/cadgpt/lib/work-registration.js';
import * as auth from '../dist/cadgpt/lib/admission.js';
import * as saves from '../dist/cadgpt/runtime/bound-save-ledger.js';

test('Save proxy forces bound identity and rejects mismatched or failed Save evidence', async () => {
  const session = 'save-proxy';
  const originalCall = cadUpstream.callTool, originalStatus = cadUpstream.status;
  let outcome = 'ok', sent, overlapping = false, saveCount = 0, enteredFirst, releaseFirst;
  let firstEntered = new Promise(resolve => { enteredFirst = resolve; });
  const firstReleased = new Promise(resolve => { releaseFirst = resolve; });
  auth.checkAdmission(session, '@cg', 'mention');
  const handle = work.createWorkRegistration({sessionKey:session,ownerType:'file',ownerId:'save-test',executionPath:'hybrid'});
  cadUpstream.status = () => ({enabled:true,connected:true});
  cadUpstream.callTool = async (name, args) => {
    if(name === 'acad_list_open_documents')return [{name:'A.dwg',full_name:'C:/A.dwg',runtime_document_id:'life-A',host:'autocad'}];
    if(name === 'acad_set_active_document')return {structuredContent:{runtime_document_id:'life-A'}};
    assert.equal(name,'acad_save_bound_document');
    sent = args;
    if (overlapping) {
      if (++saveCount === 1) { enteredFirst(); await firstReleased; }
      else throw new Error('queued Save failed');
    }
    if(outcome === 'throws')throw new Error('backend unavailable');
    if(outcome === 'error')return {isError:true,content:[{type:'text',text:'save failed'}]};
    return {structuredContent:{saved:true,runtime_document_id:outcome==='ok'?'life-A':'life-B'}};
  };
  try {
    await bindDrawingForExecution(handle.executionId,'A.dwg');
    const callbacks = new Map(), configs = new Map();
    syncCadBusinessProxies({registerTool(name, config, fn){configs.set(name,config);callbacks.set(name,fn);return {remove(){}};}});
    const name = 'cad__acad_save_bound_document';
    assert.equal(configs.get(name).inputSchema.runtime_document_id,undefined);
    const call = () => work.runWithToolLease(work.acquireToolLease({sessionKey:session,executionId:handle.executionId,authorityToken:handle.authorityToken,tool:name,family:'cad'}), () => callbacks.get(name)({runtime_document_id:'life-B'}));
    const good = await call();
    assert.notEqual(good.isError,true,JSON.stringify(good));
    assert.equal(sent.runtime_document_id,'life-A');
    assert.equal(saves.hasVerifiedBoundSave(handle.executionId,'life-A'),true);
    for (outcome of ['wrong','throws','error']) {
      saves.noteVerifiedBoundSave(handle.executionId,'life-A');
      const failed = await call();
      assert.equal(failed.isError,true,JSON.stringify(failed));
      assert.equal(saves.hasVerifiedBoundSave(handle.executionId,'life-A'),false,outcome);
    }
    overlapping = true; outcome = 'ok';
    const first = call(); await firstEntered;
    const second = call();
    // Both calls have entered the proxy while the first owns the host lock.
    await new Promise(resolve => setImmediate(resolve));
    releaseFirst();
    assert.notEqual((await first).isError, true);
    assert.equal((await second).isError, true);
    assert.equal(saves.hasVerifiedBoundSave(handle.executionId, 'life-A'), false,
      'failed queued Save must clear the earlier completed Save witness');
  } finally {
    cadUpstream.callTool=originalCall;cadUpstream.status=originalStatus;
    work.releaseSessionWork(session);auth.revokeSessionAdmissions(session);
    clearExecutionDrawingContexts(handle.executionId);saves.clearBoundSaveForExecution(handle.executionId);
  }
});
