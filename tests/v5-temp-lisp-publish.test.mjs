import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-v5-publish-"));
const old = process.env.CADGPT_APPDATA_ROOT;
process.env.CADGPT_APPDATA_ROOT = root;
const { importLibrary } = await import("../dist/cadgpt/tools/user-assets.js");
const { getLispLibrariesRoot } = await import("../dist/cadgpt/lib/appdata.js");

test.after(async () => {
  if (old === undefined) delete process.env.CADGPT_APPDATA_ROOT;
  else process.env.CADGPT_APPDATA_ROOT = old;
  await fs.rm(root, { recursive: true, force: true });
});

test("V5 Lisp publishing copies sources independently and refuses repeated library", async () => {
  const source = path.join(root, "temp-jobs", "mock", "lisp");
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, "command.lsp"), "(defun c:V5PUBLISH () (princ))");
  const published = await importLibrary("lisp", "v5-publish-test", "V5 Publish", source, false);
  assert.equal(published.registered, 1);
  assert.equal(await fs.readFile(path.join(getLispLibrariesRoot(), "v5-publish-test", "command.lsp"), "utf8"),
    "(defun c:V5PUBLISH () (princ))");
  await assert.rejects(importLibrary("lisp", "v5-publish-test", "V5 Publish", source, false), /LIBRARY_ID_ALREADY_REGISTERED/);
});

test("V5 independent Lisp command names cannot silently collide", async () => {
  const source = path.join(root, "temp-jobs", "other", "lisp");
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, "second.lsp"), "(defun c:V5PUBLISH () (princ))");
  await assert.rejects(importLibrary("lisp", "v5-another-library", "Another", source, false),
    /LISP_LIBRARY_COMMAND_OR_ID_COLLISION/);
});
