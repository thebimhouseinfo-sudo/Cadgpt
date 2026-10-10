import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "resources/cad/internal-lisp/tbh-toolkit/TBH Tool Kit/Annotation/MEP Properties.lsp");

function segment(source, from, to) {
  // GitHub Windows runners may check out the LISP file with CRLF line endings.
  const normalized = source.replace(/\r\n/g, "\n");
  const i = normalized.indexOf(from);
  const j = normalized.indexOf(to, i + from.length);
  assert.ok(i !== -1 && j > i, "Expected AutoLISP section: " + from);
  return normalized.slice(i, j);
}

test("M0a: bulk operations snapshot INSERT handles before ATTSYNC and resolve live objects later", async () => {
  const s = await fs.readFile(file, "utf8");
  const snapshot = segment(s, "(defun GT:SelectionHandles ", "(defun GT:ResolveInsertHandle ");
  const resolver = segment(s, "(defun GT:ResolveInsertHandle ", "(defun c:MEP_Properties_Create ");
  assert.match(snapshot, /\(assoc 5 \(entget ent\)\)/);
  assert.match(resolver, /\(handent handle\)/);
  assert.match(resolver, /"INSERT"/);

  const mep = segment(s, "(defun c:MEP_Properties_Create ", ";;; ===========================================================================\n;;; 4. AUTO-UPDATE");
  assert.ok(mep.indexOf("GT:SelectionHandles ss") >= 0, "MEP snapshot captured immediately after ssget");
  assert.match(mep, /GT:ResolveInsertHandle/);
  assert.doesNotMatch(mep, /\(ssname ss /, "never dereference stale ssget indexes across ATTSYNC");
});

test("M0a: Grille ATT upgrade uses one pass per block definition and safe handle rebinds", async () => {
  const s = await fs.readFile(file, "utf8");
  const upgrade = segment(s, "(defun c:GRILLE_ATTR_UPGRADE ", "(defun c:CG ");
  assert.match(upgrade, /GT:SelectionHandles ss/);
  assert.match(upgrade, /GT:SelectionHandles ts/);
  assert.match(upgrade, /GT:ResolveInsertHandle/);
  assert.match(upgrade, /uniqueGrilleBlocks/);
  assert.match(upgrade, /uniqueTagBlocks/);
  assert.doesNotMatch(upgrade, /\(ssname (?:ss|ts) /, "never reuse selection indexes after definition mutation");
  assert.match(upgrade, /GT:TagBelongsToGrille/, "XData backlink validation is still required");
  assert.match(upgrade, /GT:CopyExtendedFields/, "FACE_SIZE/MODEL only is unchanged");
});

test("M0a: no unrelated bulk owner changes to CG, GT or callback", async () => {
  const s = await fs.readFile(file, "utf8");
  const reactor = segment(s, "(defun mep_collect_targets ", "(defun mep_auto_update_callback ");
  assert.doesNotMatch(reactor, /\(ssgetfirst\s*\)/, "no actual PICKFIRST lookup in reactor");
  const copy = segment(s, "(defun c:CG ", "(princ \"\\n-> Type GT");
  assert.match(copy, /\(command "_.COPY"\)/);
  const tag = segment(s, "(defun c:GT ", ";;; ===========================================================================\n;;; EXISTING DWG UPGRADE");
  assert.match(tag, /GT:InsertTagWithPreview/);
});
