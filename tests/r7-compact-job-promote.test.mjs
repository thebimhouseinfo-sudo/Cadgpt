import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const jobs=fs.readFileSync(path.resolve(import.meta.dirname,'../src/cadgpt/tools/jobs.ts'),'utf8');
const start=jobs.indexOf('"job_promote_draft"');
const fragment=jobs.slice(start,jobs.indexOf('\n  );',start));
test('Existing Job promotion accepts compact Registry-backed target with expected draft bundle SHA',()=>{
  assert.match(fragment,/registry_id: z\.string\(\)\.min\(1\)\.optional\(\)/);
  assert.match(fragment,/expected_draft_bundle_sha256/);
  assert.match(fragment,/JOB_PROMOTION_MANAGED_BUNDLE_DRIFT/);
  assert.match(fragment,/JOB_PROMOTION_REGISTERED_TARGET_MISMATCH/);
  assert.match(fragment,/JOB_PROMOTION_REGISTERED_ID_MISMATCH/);
  assert.match(fragment,/draftBundle\.sha256 !== expected_draft_bundle_sha256/);
  assert.match(fragment,/await replaceJobBundleFromSource/);
  assert.match(fragment,/registry_updated: true/);
  assert.match(fragment,/rollback_safe: true/);
});
