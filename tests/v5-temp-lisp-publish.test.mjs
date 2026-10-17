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

test("V5 registers an already-authored managed Job in place without copying or checkout", async () => {
  const { publishManagedLibrary } = await import("../dist/cadgpt/tools/user-assets.js");
  const { getJobLibrariesRoot } = await import("../dist/cadgpt/lib/appdata.js");
  const dir = path.join(getJobLibrariesRoot(), "v5-authoring-demo", "first-job");
  await fs.mkdir(dir, { recursive: true });
  const source = path.join(dir, "JOB.md");
  await fs.writeFile(source, "# Sample Reusable Job\n\n## Steps\n1. Read input and report.\n");
  const published = await publishManagedLibrary("job", "v5-authoring-demo", "V5 Direct Builder");
  assert.equal(published.registered, 1);
  assert.equal(await fs.readFile(source, "utf8"), "# Sample Reusable Job\n\n## Steps\n1. Read input and report.\n");
});

test("V5 refreshes a previously published managed Job library without repromoting", async () => {
  const { refreshPublishedManagedLibrary } = await import("../dist/cadgpt/tools/user-assets.js");
  const { getJobLibrariesRoot } = await import("../dist/cadgpt/lib/appdata.js");
  const second = path.join(getJobLibrariesRoot(), "v5-authoring-demo", "second-job");
  await fs.mkdir(second, { recursive: true });
  await fs.writeFile(path.join(second, "JOB.md"), "# Second Job\n\n## Steps\n1. Report.\n");
  const refreshed = await refreshPublishedManagedLibrary("job", "v5-authoring-demo");
  assert.equal(refreshed.registered, 2);
  assert.equal(await refreshPublishedManagedLibrary("job", "never-published-v5"), null);
});
