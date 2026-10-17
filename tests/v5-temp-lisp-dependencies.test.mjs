import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { assertIndependentLispFolder } = await import("../dist/cadgpt/tools/temp-jobs-v5.js");

test("V5 Temp Lisp publication validates literal dependencies inside selected folder", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "v5-dependency-"));
  try {
    const sub = path.join(base, "scripts");
    await fs.mkdir(sub);
    await fs.writeFile(path.join(base, "main.lsp"), '(load "scripts/helper") (princ)');
    await fs.writeFile(path.join(sub, "helper.lsp"), "(princ)");
    await assertIndependentLispFolder(base);
    await fs.rm(path.join(sub, "helper.lsp"));
    await assert.rejects(assertIndependentLispFolder(base), /TEMP_LISP_DEPENDENCY_NOT_COPIED/);
    await fs.writeFile(path.join(base, "main.lsp"), '(load "../outside.lsp")');
    await assert.rejects(assertIndependentLispFolder(base), /TEMP_LISP_DEPENDENCY_OUTSIDE_SELECTED_FOLDER/);
    await fs.writeFile(path.join(base, "main.lsp"), '(load "C:\\\\Other\\\\helper.lsp")');
    await assert.rejects(assertIndependentLispFolder(base), /TEMP_LISP_EXTERNAL_DEPENDENCY/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("V5 Temp Lisp publication rejects nested symlink dependencies", async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "v5-lisp-link-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "v5-lisp-outside-"));
  try {
    await fs.mkdir(path.join(base, "nested"));
    try { await fs.symlink(outside, path.join(base, "nested", "outside"), process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      if (["EPERM", "EACCES"].includes(error.code)) { t.skip("Symlink unavailable"); return; }
      throw error;
    }
    await assert.rejects(assertIndependentLispFolder(base), /TEMP_LISP_DEPENDENCY_SYMLINK/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
