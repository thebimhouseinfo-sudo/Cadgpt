import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('Add-in header offers explicit connect/rebind without @cg conversation invocation', () => {
  const xaml = read('addins/cadgpt-autocad/ChatView.xaml');
  const view = read('addins/cadgpt-autocad/ChatView.xaml.cs');
  assert.match(xaml, /ConnectDrawingButton/);
  assert.match(xaml, /Connect this drawing/);
  assert.match(view, /ConnectDrawingButton_Click/);
  assert.match(view, /ConnectDrawingAsync\(/);
  assert.match(view, /TryDrawingSnapshot\(/);
});

test('Local host drawing bind uses authenticated Add-in endpoint and verified Anchor', () => {
  const index = read('src/index.ts');
  const client = read('addins/cadgpt-autocad/Stage0/AddinControlClient.cs');
  assert.match(index, /app\.post\("\/addin-control\/drawing\/connect"/);
  assert.match(index, /authorizeAddinControl\(req, res\)/);
  assert.match(index, /withCadHostLock\("autocad"/);
  assert.match(index, /allowExplicitRebind: true/);
  assert.match(index, /await ensureDrawingAnchorForBinding\(candidate/);
  assert.match(index, /selectPrimaryBoundDrawing\(candidate\)/);
  assert.match(client, /\/addin-control\/drawing\/connect\?document=/);
});

test('Custom Job finish does not mandate scratch deletion', () => {
  const jobs = read('src/cadgpt/tools/jobs.ts');
  const segment = jobs.slice(jobs.indexOf('"job_runtime_finish"'), jobs.indexOf('server.registerTool(', jobs.indexOf('"job_runtime_finish"') + 1));
  assert.doesNotMatch(segment, /clearRuntimeScratch:\s*outcome\s*===\s*"done"/);
});
