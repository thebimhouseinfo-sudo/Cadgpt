import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');
const file = fs.readFileSync(path.join(root,'src/cadgpt/tools/filesystem.ts'),'utf8');
test('Job authoring grants the draft bundle for both standalone and continued Work',()=>{
  assert.match(file, /currentWork\.ownerType === "skill" && currentWork\.ownerId === "jobcreate"/);
  assert.match(file, /currentWork\.capabilities\.includes\("job-authoring"\)/);
  assert.match(file, /const draftRoots = jobAuthoring \? \[getJobDraftRoot\(\)\] : \[\]/);
  assert.match(file, /if \(reasoningScope\) return \[\.\.\.new Set\(\[\.\.\.jobRoots, \.\.\.draftRoots\]\)\]/);
  assert.match(file, /if \(jobRoots\.length\) return \[\.\.\.new Set\(\[\.\.\.jobRoots, \.\.\.draftRoots\]\)\]/);
});
test('Managed Job libraries are never added to generic writable roots',()=>{
  const section=file.slice(file.indexOf('function currentWritableRoots()'),file.indexOf('export function assertNotGenericJobResultMutation'));
  assert.doesNotMatch(section,/getJobLibrariesRoot/);
});
