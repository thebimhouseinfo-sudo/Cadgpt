import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const jobs = fs.readFileSync(path.join(root, 'src/cadgpt/tools/jobs.ts'), 'utf8');
const service = fs.readFileSync(path.join(root, 'runtimes/cad-mcp/services/document_service.py'), 'utf8');
const tool = fs.readFileSync(path.join(root, 'runtimes/cad-mcp/tools/document_tools.py'), 'utf8');

test('Custom Job finish requires explicitly successful outcome for autosave', () => {
  const start = jobs.indexOf('"job_runtime_finish"');
  const end = jobs.indexOf('server.registerTool(', start + 1);
  const segment = jobs.slice(start, end);
  assert.match(segment, /outcome: z\.enum\(\["done", "failed"\]\)\.optional\(\)\.default\("failed"\)/);
  assert.match(segment, /if \(outcome === "done"\)/);
  assert.match(segment, /await cleanupJobRuntimeForExecution\(lease\.workId\)/);
  assert.match(segment, /JOB_SAVE_FAILED/);
  assert.match(segment, /autoSave\.saved !== true/);
  assert.doesNotMatch(segment, /JOB_DONE_AUTOSAVE_FAILED/);
  assert.ok(segment.indexOf("JOB_SAVE_FAILED") < segment.indexOf("await cleanupJobRuntimeForExecution(lease.workId)"));
  assert.match(segment, /withCadHostLock\(drawing\.host/);
  assert.match(segment, /activateDrawingContext\(drawing\)/);
  assert.match(segment, /acad_save_bound_document/);
  assert.doesNotMatch(jobs.slice(jobs.indexOf('"job_run_direct"'), jobs.indexOf('"job_run_direct_draft"')), /acad_save_bound_document/);
});

test('Python autosave selects exact named bound DWG, never blindly ActiveDocument', () => {
  assert.match(tool, /def acad_save_bound_document\(runtime_document_id: str\)/);
  assert.match(service, /get_document\(runtime_id=runtime_id\)/);
  assert.match(service, /if not before\["full_name"\]/);
  assert.match(service, /doc\.Save\(\)/);
  assert.match(service, /after\["runtime_document_id"\] != runtime_id/);
});
