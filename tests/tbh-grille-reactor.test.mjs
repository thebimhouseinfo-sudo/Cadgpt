import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLispSource } from "../dist/cadgpt/tools/lisp-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "resources/cad/internal-lisp/tbh-toolkit/TBH Tool Kit/Annotation/MEP Properties.lsp");
const getSource = () => fs.readFile(file, "utf8");

function extract(source, start, end) {
  const i = source.indexOf(start);
  const j = source.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, "Lisp section exists: " + start);
  return source.slice(i, j);
}

test("MEP global DB callback reads only the changed event ENAME, never stale PICKFIRST grille", async () => {
  const src = await getSource();
  const parseEvent = extract(src, "(defun mep_event_entity ", "(defun mep_flex_size_edit_p ");
  const targets = extract(src, "(defun mep_collect_targets ", "(defun mep_auto_update_callback ");
  const callback = extract(src, "(defun mep_auto_update_callback ", "(defun GT:TagBelongsToGrille ");
  assert.match(parseEvent, /\(cadr params\)/, "AcDb modification payload: (database modified-entity)");
  assert.match(targets, /mep_event_entity params/, "modified entity drives the target");
  assert.doesNotMatch(targets, /\(ssgetfirst\s*\)/, "no fallback to selected grille on unrelated tag erase");
  assert.doesNotMatch(callback, /\(sssetfirst\s/, "do not modify PICKFIRST inside modification reactor");
  assert.match(callback, /GT:GetLinkedTag/, "grille-to-tag sync remains enabled for relevant changes");
});

test("MEP ATT owner resolution uses DXF 330 ENAME, verifies grille layer and preserves manual-flex path", async () => {
  const src = await getSource();
  const owner = extract(src, "(defun mep_get_target_blockref ", "(defun mep_collect_targets ");
  const manual = extract(src, "(defun mep_flex_size_edit_p ", "(defun mep_get_target_blockref ");
  assert.match(owner, /\(assoc 330 ed\)/);
  assert.match(owner, /\(= \(type ownerEnt\) 'ENAME\)/);
  assert.match(owner, /\(= \(cdr \(assoc 0 ownerData\)\) "INSERT"\)/);
  assert.match(owner, /"HVAC-SAGRILLE" "HVAC-RAGRILLE"/);
  assert.match(owner, /"HVAC-OAGRILLE" "HVAC-EAGRILLE" "HVAC-TAGRILLE"/);
  assert.match(manual, /"FLEX_DUCT_SIZE"/, "explicit manual FLEX_DUCT_SIZE remains authoritative");
});

test("Grille linked tag resolution remains safe when tag was erased or link is stale", async () => {
  const src = await getSource();
  const linked = extract(src, "(defun GT:GetLinkedTag ", ";; =========================\n;; INITIALIZE GRILLE ATTRIBUTES");
  const belongs = extract(src, "(defun GT:TagBelongsToGrille ", ";;; ");
  assert.match(linked, /vl-catch-all-apply 'vla-HandleToObject/);
  assert.match(linked, /vl-catch-all-apply 'vlax-erased-p/, "no unguarded erased-object COM calls");
  assert.match(belongs, /\(= \(type storedGrilleHandle\) 'STR\)/, "malformed backlink must not call strcase on nil");
});

test("MEP Properties AutoLISP syntax preflight passes and public commands are intact", async () => {
  const src = await getSource();
  const expected = ["MEP_Properties_Create", "GT", "GRILLE_UPDATE"];
  const verdict = validateLispSource(src, expected, { profile: "syntax", fileName: "MEP Properties.lsp" });
  assert.equal(verdict.valid, true, JSON.stringify(verdict.diagnostics));
});
