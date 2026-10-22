import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-repair-flow-'));
process.env.CADGPT_APPDATA_ROOT = root;
process.env.CAD_MCP_PYTHON = process.platform === "win32" ? "python" : "python3";
const { createMcpServer, disposeMcpServerRuntime } = await import('../dist/cadgpt/server-factory.js');
const { publishManagedLibrary } = await import('../dist/cadgpt/tools/user-assets.js');
const { listRegisteredJobs } = await import('../dist/cadgpt/tools/jobs.js');
const workApi = await import('../dist/cadgpt/lib/work-registration.js');
const { cleanupExecutionState } = await import('../dist/cadgpt/runtime/execution-cleanup.js');
const sha = s => createHash('sha256').update(s).digest('hex');
const original = '# Repair Job\n\n## Steps\n1. Process owned JSON with tools/task.py; STOP/REPORT on failure.\n';
async function fixture(id) {
  const folder = path.join(root, 'libraries', 'jobs', id, 'task');
  await fs.mkdir(path.join(folder, 'tools'), { recursive: true });
  await fs.writeFile(path.join(folder, 'JOB.md'), original);
  await fs.writeFile(path.join(folder, 'tools', 'task.py'), "raise ValueError('REPAIR_FLOW_FAILURE')\n");
  await publishManagedLibrary('job', id, id);
  return { folder, id: (await listRegisteredJobs()).find(j => j.id.startsWith(id+'.job.')).id, library: id };
}
async function session(name, fn, ownerType = 'job') {
  const server = createMcpServer(name), client = new Client({name:'repair-flow',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  let handle;
  const ok = result => { assert.notEqual(result.isError, true, JSON.stringify(result)); return result; };
  const raw = (name, args={}) => client.callTool({name,arguments:args});
  const call = async (name,args={}) => ok(await raw(name,{...handle,...args}));
  const start = async () => {
    const r = await call('cadgpt_work_start',{owner_type:ownerType,owner_id:ownerType==='job'?'repair-operator':ownerType==='direct-cad'?'drawing-workspace':'job-authoring',execution_path:'file'});
    handle = r.structuredContent.data.work_handle;
  };
  const update = async (args={}) => {
    await call('cadgpt_admission',{user_turn:'cg/update',invocation_source:'plugin'});
    return call('cadgpt_control',{surface:'update',...args});
  };
  try {
    await server.connect(b); await client.connect(a);
    await call('cadgpt_admission',{user_turn:'@cg run the requested Job',invocation_source:'mention'});
    await start();
    await fn({client,call,raw,update,start,ok,get handle(){return handle;},name});
  } finally {await client.close();await disposeMcpServerRuntime(server);}
}
const selection = f => ({source_kind:'job',job_library_id:f.library,job_folder:'task'});
const edit = (f, content=original+'\nRepaired.\n') => ({kind:'reusable-job',library_id:f.library,folder:'task',relative_file:'JOB.md',content,expected_sha256:sha(original)});
test.after(async()=>{await fs.rm(root,{recursive:true,force:true});});

test('a failed Job helper can be repaired and rerun in the same operator Work', async()=>{
  const f = await fixture('repair-live');
  await session('repair-live', async c=>{
    await c.call('job_runtime_prepare',{id:f.id});
    const input = path.join(f.folder,'runtime','input.json');
    await c.call('file_create',{path:input,content:'{}'});
    const source = "raise ValueError('REPAIR_FLOW_FAILURE')\n";
    const helper = {script_path:path.join(f.folder,'tools','task.py'),input_json_path:input,expected_sha256:sha(source)};
    const failed = await c.raw('job_system_run_helper',{...c.handle,...helper});
    assert.equal(failed.isError,true); assert.match(JSON.stringify(failed),/REPAIR_FLOW_FAILURE/);
    await c.update();
    const fixed = "print('REPAIR_FLOW_OK')\n";
    await c.call('v5_source_update',{...edit(f),relative_file:'tools/task.py',content:fixed,expected_sha256:sha(source)});
    const rerun = await c.call('job_system_run_helper',{...helper,expected_sha256:sha(fixed)});
    assert.match(rerun.structuredContent.data.stdout,/REPAIR_FLOW_OK/);
    await c.call('job_runtime_finish',{outcome:'done',dwg_changed:false});
  });
});

test('cg/update still selects the failed Job after job_runtime_finish failed', async()=>{
  const f = await fixture('repair-finished');
  await session('repair-finished',async c=>{
    await c.call('job_runtime_prepare',{id:f.id});
    await fs.writeFile(path.join(f.folder,'runtime','pending.json'),'keep');
    await c.call('job_runtime_finish',{outcome:'failed'});
    const unlock=await c.update();
    assert.match(unlock.structuredContent.text,/authorized/i);
    await c.call('v5_source_update',edit(f));
    assert.equal(await fs.readFile(path.join(f.folder,'runtime','pending.json'),'utf8'),'keep');
  });
});

test('a repaired Job reruns from source_path on the existing operator Work', async()=>{
  const f = await fixture('repair-source-rerun');
  await session('repair-source-rerun',async c=>{
    await c.call('job_runtime_prepare',{id:f.id});
    await c.update(); await c.call('v5_source_update',edit(f));
    const rerun=await c.call('job_runtime_prepare',{source_path:path.join(f.folder,'JOB.md')});
    assert.match(rerun.structuredContent.data.workflow.content,/Repaired/);
  });
});

test('exact new cg/update target replaces an earlier Builder selection', async()=>{
  const a=await fixture('repair-switch-a'), b=await fixture('repair-switch-b');
  await session('repair-switch',async c=>{
    await c.update(selection(a)); await c.call('v5_source_update',edit(a));
    await c.update(selection(b)); await c.call('v5_source_update',edit(b));
    const denied=await c.raw('v5_source_update',{...c.handle,...edit(a)});
    assert.equal(denied.isError,true);
  },'skill');
});

test('source update consent survives Work cleanup and does not require a second Human command', async()=>{
  const f=await fixture('repair-renew');
  await session('repair-renew',async c=>{
    await c.update(selection(f)); await c.call('v5_source_update',edit(f));
    const old=c.handle;
    workApi.releaseSessionWork(c.name); await cleanupExecutionState(old.execution_id);
    await c.start();
    await c.call('v5_source_update',{...edit(f,original+'\nSecond repair.\n'),expected_sha256:sha(original+'\nRepaired.\n')});
    const stale=await c.raw('v5_source_update',{...old,...edit(f)});
    assert.equal(stale.isError,true);
  });
});

test('retrying update control and admission does not discard an exact source grant', async()=>{
  const f=await fixture('repair-retry');
  await session('repair-retry',async c=>{
    await c.update(selection(f));
    await c.call('cadgpt_control',{surface:'update',...selection(f)});
    await c.call('v5_source_update',edit(f));
    await c.call('cadgpt_admission',{user_turn:'cg/update',invocation_source:'plugin'});
    await c.call('v5_source_update',{...edit(f,original+'\nContinued.\n'),expected_sha256:sha(original+'\nRepaired.\n')});
  });
});

test('the most recently run Job is preferred over an older Builder target', async()=>{
  const a=await fixture('repair-recent-a'), b=await fixture('repair-recent-b');
  await session('repair-recent',async c=>{
    await c.update(selection(a)); await c.call('v5_source_update',edit(a));
    await c.call('job_runtime_prepare',{id:b.id});
    const selected=await c.update();
    assert(selected.structuredContent.text.toLowerCase().includes(b.folder.toLowerCase()));
    await c.call('v5_source_update',edit(b));
  },'skill');
});

test('a Direct Python Job fails, unlocks its retained target, repairs and reruns from source', async()=>{
  const f=await fixture('repair-direct');
  const source=path.join(f.folder,'direct.py');
  const broken="raise ValueError('DIRECT_REPAIR_FAILURE')\n";
  await fs.writeFile(source,broken);
  await publishManagedLibrary('job',f.library,f.library);
  const directId=(await listRegisteredJobs()).find(j=>j.id.startsWith(f.library+'.job.')&&j.id.endsWith('.direct')).id;
  await session('repair-direct',async c=>{
    const failed=await c.raw('job_run_direct',{...c.handle,id:directId});
    assert.equal(failed.isError,true);assert.match(JSON.stringify(failed),/DIRECT_REPAIR_FAILURE/);
    const unlocked=await c.update();assert.match(unlocked.structuredContent.text,/authorized/i);
    await c.call('v5_source_update',{...edit(f),relative_file:'direct.py',content:"print('DIRECT_REPAIR_OK')\n",expected_sha256:sha(broken)});
    const rerun=await c.call('job_run_direct',{source_path:source});
    assert.match(rerun.structuredContent.data.stdout,/DIRECT_REPAIR_OK/);
  });
});

test('ordinary drawing Work runs the prepared Job helper without entering Builder',async()=>{
  const f=await fixture('repair-drawing-work');
  await fs.writeFile(path.join(f.folder,'tools','task.py'),"print('OPERATOR_HELPER_OK')\n");
  await session('repair-drawing-work',async c=>{
    await c.call('job_runtime_prepare',{id:f.id});
    const input=path.join(f.folder,'runtime','input.json');
    await c.call('file_create',{path:input,content:'{}'});
    const result=await c.call('job_system_run_helper',{script_path:path.join(f.folder,'tools','task.py'),expected_sha256:sha("print('OPERATOR_HELPER_OK')\n"),input_json_path:input});
    assert.match(result.structuredContent.data.stdout,/OPERATOR_HELPER_OK/);
    const foreign=await fixture('repair-helper-foreign');
    const denied=await c.raw('job_system_run_helper',{...c.handle,script_path:path.join(foreign.folder,'tools','task.py'),expected_sha256:sha("raise ValueError('REPAIR_FLOW_FAILURE')\n"),input_json_path:input});
    assert.equal(denied.isError,true);assert.match(JSON.stringify(denied),/SYSTEM_HELPER_TOOLS_ONLY/);
  },'direct-cad');
});

test('a newly selected Lisp remains the update target after an earlier Job run',async()=>{
  const f=await fixture('repair-before-lisp');
  await session('repair-lisp-after-job',async c=>{
    await c.call('job_runtime_prepare',{id:f.id});
    await c.call('job_runtime_finish',{outcome:'failed'});
    const args={kind:'reusable-lisp',library_id:'repair-lisp',folder:'command',relative_file:'command.lsp'};
    await c.call('v5_source_create',{...args,content:'(princ)\n'});
    const unlocked=await c.update();
    assert(unlocked.structuredContent.text.toLowerCase().includes(path.join('repair-lisp','command').toLowerCase()));
  },'skill');
});

test('cg/update is an explicit workflow restart after cg/stop',async()=>{
  const f=await fixture('repair-stop');
  await session('repair-stop',async c=>{
    await c.call('job_runtime_prepare',{id:f.id});
    await c.call('cadgpt_control',{surface:'stop'});
    await c.update();
    await c.start();
    await c.call('v5_source_update',edit(f));
  });
});

test('normal execution by source path needs no edit unlock and cannot escape managed Jobs',async()=>{
  const f=await fixture('repair-run-only');
  await session('repair-run-only',async c=>{
    const run=await c.call('job_runtime_prepare',{source_path:path.join(f.folder,'JOB.md')});
    assert.equal(run.structuredContent.data.workflow.content,original);
    const locked=await c.raw('v5_source_update',{...c.handle,...edit(f)});
    assert.equal(locked.isError,true);
    const outside=path.join(root,'foreign','JOB.md');
    await fs.mkdir(path.dirname(outside),{recursive:true});await fs.writeFile(outside,original);
    const escape=await c.raw('job_runtime_prepare',{...c.handle,source_path:outside});
    assert.equal(escape.isError,true);assert.match(JSON.stringify(escape),/V5_JOB_SOURCE_OUTSIDE_MANAGED_LIBRARY/);
    const stale=await c.raw('v5_source_update',{...c.handle,...edit(f),authority_token:'foreign-token'});
    assert.equal(stale.isError,true);
  });
});

test('authorized source correction does not require a caller SHA proof',async()=>{
  const f=await fixture('repair-no-sha');
  await session('repair-no-sha',async c=>{
    await c.update(selection(f));
    const {expected_sha256,...payload}=edit(f);
    await c.call('v5_source_update',payload);
    assert.match(await fs.readFile(path.join(f.folder,'JOB.md'),'utf8'),/Repaired/);
    const stale=await c.raw('v5_source_update',{...c.handle,...edit(f)});
    assert.equal(stale.isError,true);assert.match(JSON.stringify(stale),/V5_SOURCE_REVISION_CONFLICT/);
  });
});

test('new authoring of a second package is not locked to the first Work target',async()=>{
  await session('repair-new-packages',async c=>{
    const args={kind:'reusable-job',library_id:'repair-new-packages',folder:'first',relative_file:'JOB.md',content:original};
    const a=await c.call('v5_source_create',args);
    const b=await c.call('v5_source_create',{...args,folder:'second'});
    assert.equal(await fs.readFile(a.structuredContent.data.path,'utf8'),original);
    assert.equal(await fs.readFile(b.structuredContent.data.path,'utf8'),original);
  },'skill');
});

test('source permission ends when an Operator Job starts even on the same Work',async()=>{
  const f=await fixture('repair-grant-end');
  await session('repair-grant-end',async c=>{
    await c.update(selection(f));await c.call('v5_source_update',edit(f));
    await c.call('job_runtime_prepare',{id:f.id});
    const denied=await c.raw('v5_source_update',{...c.handle,...edit(f),expected_sha256:sha(original+'\nRepaired.\n')});
    assert.equal(denied.isError,true);
    assert.equal(await fs.readFile(path.join(f.folder,'JOB.md'),'utf8'),original+'\nRepaired.\n');
  });
});

test('successful repair completion ends update permission without ending Work',async()=>{
  const f=await fixture('repair-done-grant');
  await session('repair-done-grant',async c=>{
    await c.call('job_runtime_prepare',{id:f.id});
    await c.update();await c.call('v5_source_update',edit(f));
    await c.call('job_runtime_finish',{outcome:'done',dwg_changed:false});
    const denied=await c.raw('v5_source_update',{...c.handle,...edit(f),expected_sha256:sha(original+'\nRepaired.\n')});
    assert.equal(denied.isError,true);
    assert.equal(workApi.activeWorkForSession(c.name).executionId,c.handle.execution_id);
  });
});

test('publishing one Job preserves sibling Registry metadata and excludes its runtime/helpers',async()=>{
  const f=await fixture('repair-publish-scope');
  const sibling=path.join(root,'libraries','jobs',f.library,'sibling');
  await fs.mkdir(sibling,{recursive:true});await fs.writeFile(path.join(sibling,'JOB.md'),'# Sibling Job\n');
  await publishManagedLibrary('job',f.library,f.library);
  const {getUserCapabilitiesPath}=await import('../dist/cadgpt/lib/appdata.js');
  const file=getUserCapabilitiesPath(), registry=JSON.parse(await fs.readFile(file,'utf8'));
  const foreign=registry.entries.find(e=>e.library_id===f.library&&e.relative_path==='sibling/JOB.md');
  foreign.title='User-maintained sibling metadata';foreign.custom={retain:true};
  await fs.writeFile(file,JSON.stringify(registry));
  await fs.mkdir(path.join(f.folder,'runtime'),{recursive:true});
  await fs.writeFile(path.join(f.folder,'runtime','noise.py'),"print('not a capability')\n");
  await session('repair-publish-scope',async c=>{
    await c.update(selection(f));await c.call('v5_source_update',edit(f));
    const published=await c.call('v5_source_publish',{kind:'job',library_id:f.library,library_name:f.library});
    assert.equal(published.structuredContent.data.registered,1);
    const next=JSON.parse(await fs.readFile(file,'utf8'));
    assert.deepEqual(next.entries.find(e=>e.id===foreign.id),foreign);
    assert.equal(next.entries.some(e=>e.library_id===f.library&&/runtime\/|tools\//.test(e.relative_path)),false);
    assert.equal(await fs.readFile(path.join(sibling,'JOB.md'),'utf8'),'# Sibling Job\n');
    const finished=await c.raw('v5_source_update',{...c.handle,...edit(f),expected_sha256:sha(original+'\nRepaired.\n')});
    assert.equal(finished.isError,true,'explicit publication completes the source update operation');
  });
});

test('publishing one Lisp preserves an independently maintained sibling capability',async()=>{
  const library='repair-publish-lisp', base=path.join(root,'libraries','lisp',library);
  for(const name of ['alpha','beta']){
    await fs.mkdir(path.join(base,name),{recursive:true});
    await fs.writeFile(path.join(base,name,name+'.lsp'),`(defun c:RP_${name} () (princ))\n`);
  }
  await publishManagedLibrary('lisp',library,library);
  const {getUserCapabilitiesPath}=await import('../dist/cadgpt/lib/appdata.js');
  const file=getUserCapabilitiesPath(), registry=JSON.parse(await fs.readFile(file,'utf8'));
  const foreign=registry.entries.find(e=>e.library_id===library&&e.relative_path==='beta/beta.lsp');
  foreign.title='Retain beta metadata';foreign.custom={owner:'beta'};
  await fs.writeFile(file,JSON.stringify(registry));
  await session('repair-publish-lisp',async c=>{
    await c.update({source_kind:'lisp',job_library_id:library,job_folder:'alpha'});
    await c.call('v5_source_update',{kind:'reusable-lisp',library_id:library,folder:'alpha',relative_file:'alpha.lsp',content:'(defun c:RP_alpha () (princ 1))\n',expected_sha256:sha('(defun c:RP_alpha () (princ))\n')});
    await c.call('v5_source_publish',{kind:'lisp',library_id:library,library_name:library});
    const next=JSON.parse(await fs.readFile(file,'utf8'));
    assert.deepEqual(next.entries.find(e=>e.id===foreign.id),foreign);
  },'skill');
});

test('Temp correction and completed cleanup need neither a caller hash nor Work shutdown',async()=>{
  await session('repair-temp-friction',async c=>{
    const a=(await c.call('temp_job_create')).structuredContent.data;
    const b=(await c.call('temp_job_create')).structuredContent.data;
    await c.call('temp_job_source_create',{id:a.id,relative_path:'notes.txt',content:'before'});
    await c.call('temp_job_source_update',{id:a.id,relative_path:'notes.txt',content:'after'});
    await c.call('temp_job_done',{id:a.id});
    const cleared=await c.call('temp_job_clear',{id:a.id});
    assert.deepEqual(cleared.structuredContent.data.removed,[a.id]);
    const held=await c.call('temp_job_clear',{id:b.id});
    assert.deepEqual(held.structuredContent.data.removed,[]);
    assert.equal(held.structuredContent.data.skipped.length,1);
    assert.equal(workApi.activeWorkForSession(c.name).executionId,c.handle.execution_id);
  },'skill');
});


test('explicit Create Lisp uses the current drawing Work without a role upgrade ceremony',async()=>{
  await session('repair-author-routing',async c=>{
    const before=c.handle.execution_id;
    await c.call('cadgpt_control',{surface:'cl'});
    await c.call('v5_source_create',{kind:'reusable-lisp',library_id:'repair-author-routing',folder:'command',relative_file:'command.lsp',content:'(princ)\n'});
    assert.equal(workApi.activeWorkForSession(c.name).executionId,before);
  },'direct-cad');
});

test('production does not expose or activate the MCP source policy bypass',async()=>{
  const previous=process.env.CADGPT_BUILD_PROFILE;
  process.env.CADGPT_BUILD_PROFILE='production';
  try {
    await session('repair-production-boundary',async c=>{
      assert.doesNotMatch(c.client.getInstructions(), /Human Power/);
      const names=(await c.client.listTools()).tools.map(t=>t.name);
      assert.equal(names.some(n=>n.startsWith('human_power_')||n.startsWith('cad_mcp_dev_')),false);

      const list=await c.raw('human_power_start',{...c.handle,task:'test',reason:'test',error_description:'test',expected_behavior:'test',human_approved:true});
      assert.equal(list.isError,true);
      const start=await c.raw('cadgpt_admission',{user_turn:'@cg human power on',invocation_source:'mention'});
      assert.equal(start.isError,true);
      assert.equal(workApi.activeWorkForSession(c.name).humanPower,undefined);
    });
  } finally {if(previous===undefined)delete process.env.CADGPT_BUILD_PROFILE;else process.env.CADGPT_BUILD_PROFILE=previous;}
});


test('compatibility notices never instruct the AI to block normal Jobs for a scan',async()=>{
  await session('repair-compat-instructions',async c=>{
    assert.doesNotMatch(c.client.getInstructions(),/before normal User Job create\/run\/refine, call/);
    const launch=await c.call('cadgpt_admission',{user_turn:'@cg',invocation_source:'mention'});
    assert.doesNotMatch(JSON.stringify(launch),/must be checked before they can run|blocks User Job execution|Until the scan is completed/);
  });
});

test('an update grant cannot create a different Job, while runtime Data and library reads remain free',async()=>{
  const f=await fixture('repair-owned-vs-data'),other=await fixture('repair-readable');
  await session('repair-owned-vs-data',async c=>{
    await c.call('job_runtime_prepare',{id:f.id});
    await c.call('file_create',{path:path.join(f.folder,'runtime','drawing-data.lsp'),content:'(setq drawing-data 1)\n'});
    await c.call('file_read',{path:path.join(other.folder,'JOB.md')});
    await c.update();
    const wrong=await c.raw('v5_source_create',{...c.handle,kind:'reusable-job',library_id:'repair-foreign-new',folder:'job',relative_file:'JOB.md',content:original});
    assert.equal(wrong.isError,true);
    await assert.rejects(fs.stat(path.join(root,'libraries','jobs','repair-foreign-new','job')),{code:'ENOENT'});
  });
});

test('Create Job intent does not turn a subsequent Operator run into permanent Builder authority',async()=>{
  const f=await fixture('repair-role-expiry');
  await session('repair-role-expiry',async c=>{
    await c.call('cadgpt_control',{surface:'cj'});
    await c.call('job_runtime_prepare',{id:f.id});
    const denied=await c.raw('v5_source_create',{...c.handle,kind:'reusable-job',library_id:'repair-role-expiry-new',folder:'job',relative_file:'JOB.md',content:original});
    assert.equal(denied.isError,true);
    await c.call('cadgpt_control',{surface:'cj'});
    await c.call('v5_source_create',{kind:'reusable-job',library_id:'repair-role-expiry-new',folder:'job',relative_file:'JOB.md',content:original});
  },'skill');
});

test('starting an Internal Operator Job expires a previous source update operation',async()=>{
  const f=await fixture('repair-internal-expiry');
  await session('repair-internal-expiry',async c=>{
    await c.update(selection(f));await c.call('v5_source_update',edit(f));
    const noDrawing=await c.raw('job_run_direct',{...c.handle,id:'tbh'});
    assert.equal(noDrawing.isError,true);
    const denied=await c.raw('v5_source_update',{...c.handle,...edit(f),expected_sha256:sha(original+'\nRepaired.\n')});
    assert.equal(denied.isError,true);
  });
});

test('standalone first RUN can publish its selected Job without source unlock or registration first',async()=>{
  const folder=path.join(root,'libraries','jobs','repair-first-run','report');
  await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'JOB.md'),original);
  await session('repair-first-run',async c=>{
    await c.call('job_runtime_prepare',{source_path:path.join(folder,'JOB.md')});
    const published=await c.call('v5_source_publish',{kind:'job',library_id:'repair-first-run',library_name:'First run'});
    assert.equal(published.structuredContent.data.registered,1);
  },'skill');
});

test('legacy Dynamic Lisp maintenance cannot bypass exact Engine ownership',async()=>{
  const a=await fixture('repair-dynamic-a'), b=await fixture('repair-dynamic-b');
  const engine='(defun c:RP_ENGINE () (princ 1))\n';
  for(const f of [a,b]){
    await fs.mkdir(path.join(f.folder,'dynamic-lisp'),{recursive:true});
    await fs.writeFile(path.join(f.folder,'dynamic-lisp','engine.lsp'),engine);
  }
  await session('repair-dynamic-scope',async c=>{
    await c.call('job_runtime_prepare',{id:a.id});
    await c.call('file_create',{path:path.join(a.folder,'runtime','data.json'),content:'{"count":2}'});
    const patch={relative_path:'dynamic-lisp/engine.lsp',expected_sha256:sha(engine),replacements:[{section:'logic',old_text:'princ 1',new_text:'princ 2'}]};
    const locked=await c.raw('job_dynamic_lisp_patch',{...c.handle,...patch,job_id:a.id});
    assert.equal(locked.isError,true);
    await c.update();
    const foreign=await c.raw('job_dynamic_lisp_patch',{...c.handle,...patch,job_id:b.id});
    assert.equal(foreign.isError,true);
    await c.call('job_dynamic_lisp_patch',{...patch,job_id:a.id});
    assert.equal(await fs.readFile(path.join(b.folder,'dynamic-lisp','engine.lsp'),'utf8'),engine);
  });
});
