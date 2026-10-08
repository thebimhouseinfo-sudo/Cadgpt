import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLispSource } from "../dist/cadgpt/tools/lisp-harness.js";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..",
  "resources", "cad", "internal-lisp", "tbh-toolkit", "TBH Tool Kit");
const sourceFile = path.join(base, "TBH_Block_Library.lsp");
const templateFile = path.join(base, "SRC", "FDM TEMPLATE.dwg");
const source = () => fs.readFile(sourceFile, "utf8");

function part(text, begin, end) {
  const i = text.indexOf(begin), j = text.indexOf(end, i + begin.length);
  assert.ok(i >= 0 && j > i, "Expected bounded Lisp function: " + begin);
  return text.slice(i, j);
}

test("BLL source DWG is physically bundled and compatible with DWG format", async () => {
  const dwg = await fs.readFile(templateFile);
  assert.ok(dwg.length > 40000, "Bundled SRC template has substantial DWG content");
  assert.match(dwg.toString("ascii", 0, 6), /^AC10/, "Bundled template is a DWG");
  const lsp = await source();
  assert.match(lsp, /SRC\\\\FDM TEMPLATE\.dwg/);
  assert.match(lsp, /\*cadgpt-load-dir\*/, "resolve actual TBH loader root");
  assert.match(lsp, /findfile \(getenv "TBHBL_LSP_PATH"\)/, "reject stale environment file locator");
  assert.match(lsp, /tbhbl:dbx-live-p \*TBHBL:Dbx\*/, "verify cached ObjectDBX before reuse");
});

test("BLL handles anonymous template block references and dependencies without pasting entire DWG", async () => {
  const lsp = await source();
  const sample = part(lsp, "(defun tbhbl:find-source-sample ", "(defun tbhbl:copy-primary-result ");
  const copier = part(lsp, "(defun tbhbl:copy-source-sample ", "(defun tbhbl:copy-block-def ");
  const importing = part(lsp, "(defun tbhbl:insert-from-library ", "(defun tbhbl:write-dcl ");
  assert.match(sample, /tbhbl:find-sample-in-owner/, "locate an actual INSERT in source ModelSpace or layouts");
  assert.match(copier, /vla-CopyObjects/, "source block reference deep-copy includes its dependencies");
  assert.match(copier, /vla-Move/, "copied sample relocates to picked WCS point");
  assert.match(copier, /vla-put-Rotation/, "copied sample rotation is normalized");
  assert.match(importing, /\(substr source-name 1 1\) "\*"/, "anonymous reference is not blindly inserted by its *U name");
  assert.match(importing, /tbhbl:copy-source-sample/, "an existing source INSERT is copied");
  assert.match(importing, /tbhbl:copy-block-def/, "named block definitions without source INSERT remain supported");
  assert.doesNotMatch(importing, /vl-cmdf|\(command/, "no arbitrary DWG insertion/paste workaround");
});

test("BLL reads real destination state after CopyObjects rather than retrying uncertain copies", async () => {
  const lsp = await source();
  const verify = part(lsp, "(defun tbhbl:copy-primary-result ", "(defun tbhbl:copy-source-sample ");
  const def = part(lsp, "(defun tbhbl:copy-block-def ", "(defun tbhbl:insert-from-library ");
  assert.match(verify, /vla-get-Count \(list owner\)/, "read post-copy destination count safely");
  assert.match(verify, /vlax-variant-value/);
  assert.match(verify, /vlax-safearray->list/);
  assert.match(def, /\(list dest-blocks name\)/, "verify copied named definition in dest Blocks table");
  assert.doesNotMatch(def, /CopyObjects returned an unreadable result/, "avoid false negative from variant shape");
});

test("BLL preserves dialog, native ROTATE preview, bound original document and UCS/WCS conversion", async () => {
  const lsp = await source();
  const insertion = part(lsp, "(defun tbhbl:insert-selected ", "(defun c:BLL ");
  const workflow = part(lsp, "(defun tbhbl:insert-from-library ", "(defun tbhbl:write-dcl ");
  assert.match(insertion, /\(trans point 1 0\)/, "getpoint returns UCS; COM insertion requires WCS");
  assert.match(insertion, /\(command "_.rotate" ent "" point pause\)/);
  assert.match(workflow, /\(eq opened T\)/, "close only source document opened by BLL");
  assert.match(workflow, /vla-Activate/, "return to original destination drawing if source was opened visibly");
  assert.match(lsp, /\(defun c:BLLRELOAD /);
  assert.match(lsp, /\(defun c:BLL /);
});

test("BLL full AutoLISP source passes actual syntax validator", async () => {
  const lsp = await source();
  const verdict = validateLispSource(lsp, ["BLL", "BLLRELOAD"], {
    profile: "syntax",
    fileName: "TBH_Block_Library.lsp",
  });
  assert.equal(verdict.valid, true, JSON.stringify(verdict.diagnostics));
});
