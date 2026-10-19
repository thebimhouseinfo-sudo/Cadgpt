import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-v5-recovery-"));
const old = process.env.CADGPT_APPDATA_ROOT;
process.env.CADGPT_APPDATA_ROOT = dir;
const { beginRegistryPublication, endRegistryPublication, readRegistrySnapshot,
        recoverInterruptedRegistryPublication } =
  await import("../dist/cadgpt/runtime/registry-publication-recovery.js");
const { getUserCapabilitiesPath, getUserLibrariesManifestPath, ensureAppDataLayout } =
  await import("../dist/cadgpt/lib/appdata.js");
test.after(async () => {
  if (old === undefined) delete process.env.CADGPT_APPDATA_ROOT;
  else process.env.CADGPT_APPDATA_ROOT = old;
  await fs.rm(dir, { recursive: true, force: true });
});

test("V5 startup recovers both Registry files after interrupted two-file publication", async () => {
  await ensureAppDataLayout();
  const a = getUserLibrariesManifestPath(), b = getUserCapabilitiesPath();
  await fs.writeFile(a, '{"libraries":[1]}\n');
  await fs.writeFile(b, '{"entries":[2]}\n');
  await beginRegistryPublication(await readRegistrySnapshot());
  await fs.writeFile(a, '{"libraries":[3]}\n');
  await fs.writeFile(b, '{"entries":[4]}\n');
  await ensureAppDataLayout();
  assert.equal(await fs.readFile(a,"utf8"), '{"libraries":[1]}\n');
  assert.equal(await fs.readFile(b,"utf8"), '{"entries":[2]}\n');
  assert.equal(await recoverInterruptedRegistryPublication(), false);
});
test("V5 completed Registry publication is never rolled back", async () => {
  const a=getUserLibrariesManifestPath();
  await beginRegistryPublication(await readRegistrySnapshot());
  await fs.writeFile(a, '{"libraries":[5]}\n');
  await endRegistryPublication();
  assert.equal(await recoverInterruptedRegistryPublication(),false);
  assert.equal(await fs.readFile(a,"utf8"),'{"libraries":[5]}\n');
});
