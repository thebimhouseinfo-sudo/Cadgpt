import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('R7 issue 63: stale Host lifetime is invalidated before auto-join', () => {
  const admission = source('src/cadgpt/server-factory.ts');
  const bindings = source('src/cadgpt/session/drawing-binding.ts');
  assert.match(admission, /await validatePrimaryBoundDrawing\(\)/);
  assert.match(admission, /error\.message\.startsWith\("BOUND_DRAWING_STALE:"\)/);
  assert.match(bindings, /const primaryStillOpen = docs\.some/);
  assert.match(bindings, /if \(!primaryStillOpen\) \{\s*primaryDrawing = null/);
  assert.match(bindings, /existingContexts\.delete\(id\)/);
});

test('R7 issue 63: explicit drawing bind restores verified primary without changing a live primary', () => {
  const bindings = source('src/cadgpt/session/drawing-binding.ts');
  const proxy = source('src/cadgpt/tools/cad-proxy.ts');
  assert.match(bindings, /else if \(!options\.allowExplicitRebind\)/);
  const start = proxy.indexOf('"drawing_bind"');
  const end = proxy.indexOf('"drawing_status"', start);
  const tool = proxy.slice(start, end);
  assert.match(tool, /await ensureDrawingAnchorForBinding\(drawing\)/);
  assert.match(tool, /selectPrimaryBoundDrawing\(drawing\)/);
  assert.doesNotMatch(tool, /DRAWING_REBIND_REQUIRES_SELECTION/);
});

test('R7 issue 64: jobcreate continued Work explicitly grants a restricted draft capability', () => {
  const control = source('src/cadgpt/tools/work-control.ts');
  const registration = source('src/cadgpt/lib/work-registration.ts');
  const fileTools = source('src/cadgpt/tools/filesystem.ts');
  assert.match(control, /owner_id\.trim\(\) === "jobcreate"/);
  assert.match(control, /"job-authoring"/);
  assert.match(registration, /capability === "job-authoring"/);
  assert.match(fileTools, /const draftRoots = jobAuthoring \? \[getJobDraftRoot\(\)\] : \[\]/);
  assert.match(fileTools, /if \(reasoningScope\) return \[\.\.\.new Set\(\[\.\.\.jobRoots, \.\.\.draftRoots\]\)\]/);
  assert.doesNotMatch(fileTools, /reasoningScope\) return \[\.\.\.new Set\(getWritableRoots\(\)/);
});
