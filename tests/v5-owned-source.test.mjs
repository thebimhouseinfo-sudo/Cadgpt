import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-v5-ownership-"));
const previous = process.env.CADGPT_APPDATA_ROOT;
process.env.CADGPT_APPDATA_ROOT = root;
const { ownedSourceRoot, resolveOwnedSourceMutation, newTempJobId } =
  await import("../dist/cadgpt/lib/owned-source.js");

test.after(async () => {
  if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
  else process.env.CADGPT_APPDATA_ROOT = previous;
  await fs.rm(root, { recursive: true, force: true });
});

test("V5 Temp Job UUID owns only its own source folder", async () => {
  const idA = newTempJobId(), idB = newTempJobId();
  assert.notEqual(idA, idB);
  const ownerA = { kind: "temp-job", id: idA };
  const a = ownedSourceRoot(ownerA), b = ownedSourceRoot({ kind: "temp-job", id: idB });
  await fs.mkdir(a, { recursive: true });
  const own = path.join(a, "foo.lsp");
  assert.equal(await resolveOwnedSourceMutation(own, ownerA, { forCreate: true }), path.join(await fs.realpath(a), "foo.lsp"));
  await assert.rejects(resolveOwnedSourceMutation(path.join(b, "evil.lsp"), ownerA, { forCreate: true }), /V5_SOURCE_OUTSIDE_OWNER/);
  await assert.rejects(resolveOwnedSourceMutation(path.join(a, "..", idB, "evil.lsp"), ownerA, { forCreate: true }), /V5_SOURCE_OUTSIDE_OWNER/);
});

test("V5 reusable Job authoring grant excludes neighboring Job", async () => {
  const owned = { kind: "reusable-job", libraryId: "hvac", relativeFolder: "job-a" };
  const mine = ownedSourceRoot(owned);
  await fs.mkdir(mine, { recursive: true });
  const target = path.join(mine, "tools", "prepare.py");
  assert.equal(await resolveOwnedSourceMutation(target, owned, { forCreate: true }), path.join(await fs.realpath(mine), "tools", "prepare.py"));
  await assert.rejects(resolveOwnedSourceMutation(path.join(root, "libraries", "jobs", "hvac", "job-b", "JOB.md"), owned, { forCreate: true }), /V5_SOURCE_OUTSIDE_OWNER/);
  assert.throws(() => ownedSourceRoot({ kind: "reusable-job", libraryId: "..", relativeFolder: "job-a" }), /V5_INVALID_LIBRARY_ID/);
});

test("V5 canonical resolver rejects symlink escape", async (t) => {
  const owned = { kind: "reusable-lisp", libraryId: "tools", relativeFolder: "my-lisp" };
  const mine = ownedSourceRoot(owned);
  await fs.mkdir(mine, { recursive: true });
  const outside = path.join(root, "outside");
  await fs.mkdir(outside, { recursive: true });
  const link = path.join(mine, "redirect");
  try { await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) { t.skip("Symlinks unavailable"); return; }
    throw error;
  }
  await assert.rejects(resolveOwnedSourceMutation(path.join(link, "evil.lsp"), owned, { forCreate: true }), /outside|roots|mutation/i);
});

test("V5 rejects a symlinked owner root redirected to another Job", async (t) => {
  const from = { kind: "reusable-job", libraryId: "junction-fixture", relativeFolder: "job-a" };
  const to = { kind: "reusable-job", libraryId: "junction-fixture", relativeFolder: "job-b" };
  const wrong = ownedSourceRoot(to);
  await fs.mkdir(wrong, { recursive: true });
  const link = ownedSourceRoot(from);
  try { await fs.symlink(wrong, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) { t.skip("Symlinks unavailable"); return; }
    throw error;
  }
  await assert.rejects(
    resolveOwnedSourceMutation(path.join(link, "JOB.md"), from, { forCreate: true }),
    /V5_OWNER_ROOT_ALIAS_BLOCKED/
  );
});

test("V5 protected internal toolkit is never Builder writable", async () => {
  const { ownedSourceRoot } = await import("../dist/cadgpt/lib/owned-source.js");
  assert.throws(
    () => ownedSourceRoot({ kind: "reusable-lisp", libraryId: "TBH-TOOLKIT", relativeFolder: "lisp" }),
    /V5_INTERNAL_LIBRARY_READ_ONLY/
  );
});
