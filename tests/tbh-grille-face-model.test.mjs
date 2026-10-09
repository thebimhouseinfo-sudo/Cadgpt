import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLispSource } from "../dist/cadgpt/tools/lisp-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolkit = path.join(root, "resources", "cad", "internal-lisp", "tbh-toolkit", "TBH Tool Kit");
const read = (relative) => fs.readFile(path.join(toolkit, relative), "utf8");
const fragment = (text, begin, end) => {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end, start + begin.length);
  assert.ok(start !== -1 && stop > start, "missing function boundary: " + begin);
  return text.slice(start, stop);
};

test("FACE_SIZE and MODEL are hidden and independent of legacy SIZE on grille and tag definitions", async () => {
  const source = await read("Annotation/MEP Properties.lsp");
  const grille = fragment(source, "(defun GT:GrilleAttributeTags ", "(defun GT:SyncBlockAttributes ");
  for (const tag of ["SIZE", "FACE_SIZE", "MODEL", "GRILLE_TYPE", "FLEX_DUCT_SIZE", "TAG_NUMBER"]) {
    assert.match(grille, new RegExp('"' + tag + '"'));
  }
  const add = fragment(source, "(defun add_mep_attrib_vla ", "(defun GT:GrilleAttributeTags ");
  assert.match(add, /vla-AddAttribute blkDef 100\.0 1 /);
  assert.match(add, /vla-put-Invisible newAtt :vlax-true/);
  const tag = fragment(source, "(defun GT:MakeGrilleTagBlock ", "(defun GT:SafeCallMEP ");
  assert.match(tag, /"FACE_SIZE" "MODEL"\)/);
  assert.match(tag, /add-att tag yMin T/);
  assert.match(tag, /add-att "TAG_NUMBER" 100\.0 nil/);
  assert.match(tag, /add-att "AIR_FLOW" -100\.0 nil/);
  assert.match(tag, /add-att "SIZE" -280\.0 nil/);
});

test("GT upgrades an existing grille, tags inherit both values, and reactor uses verified handle links", async () => {
  const s = await read("Annotation/MEP Properties.lsp");
  const init = fragment(s, "(defun GT:InitGrilleAttributes ", "(defun c:GT ");
  assert.match(init, /GT:GrilleAttributeTags/);
  assert.match(init, /if changed \(GT:SyncBlockAttributes bName\)/);
  const gt = fragment(s, "(defun c:GT ", "EXISTING DWG UPGRADE:");
  assert.match(gt, /hadAttrs/);
  assert.match(gt, /GT:InitGrilleAttributes ent layer/);
  assert.match(gt, /GT:GetBlockAttributes ent/);
  assert.match(gt, /GT:InsertTagWithPreview ent data tagBName/);
  const setter = fragment(s, "(defun GT:SetTagAttributes ", "(defun GT:InsertTagWithPreview ");
  assert.match(setter, /GT:GetAttr tag data/);
  assert.match(setter, /member tag '\("FACE_SIZE" "MODEL"\)/);
  const reactor = fragment(s, "(defun mep_auto_update_callback ", ";;; Helper: verify");
  assert.match(reactor, /GT:TagBelongsToGrille/);
  assert.match(reactor, /GT:SetTagAttributes/);
  assert.doesNotMatch(reactor, /GT:UpdateTagByTagNo/);
});

test("GRILLE_ATTR_UPGRADE handles existing GR-* blocks, does not use TAG_NUMBER for identity and copies only new values", async () => {
  const s = await read("Annotation/MEP Properties.lsp");
  const upgrade = fragment(s, "(defun c:GRILLE_ATTR_UPGRADE ", ";;; ===========================================================================\n;;; COMMAND: CG ");
  assert.match(upgrade, /GT:InitGrilleAttributes/);
  assert.match(upgrade, /GT:EnsureTagHiddenAttributes/);
  assert.match(upgrade, /GT:GetLinkedTag/);
  assert.match(upgrade, /GT:TagBelongsToGrille/);
  assert.match(upgrade, /GT:CopyExtendedFields/);
  assert.doesNotMatch(upgrade, /GT:UpdateTagByTagNo/);
  const copy = fragment(s, "(defun GT:CopyExtendedFields ", "(defun c:GRILLE_ATTR_UPGRADE ");
  assert.match(copy, /member tag '\("FACE_SIZE" "MODEL"\)/);
  assert.doesNotMatch(copy, /"SIZE"/);
  assert.doesNotMatch(copy, /"TAG_NUMBER"/);
});

test("GRR creates 3 rectangular FACE_SIZE values, Side Wall remains unspecified; stable INSERT is reused after ATTSYNC", async () => {
  const s = await read("Draw/Create/Grille.lsp");
  for (const [begin, end, type] of [
    ["(defun Grille:Eggcrate ", "(defun Grille:BarGrille ", "Eggcrate"],
    ["(defun Grille:BarGrille ", "(defun Grille:DoubleDeflection ", "Bar Grille"],
    ["(defun Grille:DoubleDeflection ", "(defun Grille:Sidewall ", "Double Deflection"],
  ]) {
    const section = fragment(s, begin, end);
    assert.match(section, /GT:SetAttrValue blk_ent "FACE_SIZE" \(strcat \(rtos w 2 0\) "x" \(rtos h 2 0\)\)/);
    assert.match(section, /GT:SetAttrValue blk_ent "GRILLE_TYPE"/);
    assert.match(section, /GT:InitGrilleAttributes blk_ent layer_main/);
    assert.match(section, /command "_\.rotate" blk_ent "" pt_c pause/);
  }
  const side = fragment(s, "(defun Grille:Sidewall ", "(defun C:GRR ");
  assert.match(side, /GT:InitGrilleAttributes blk_ent layer_main/);
  assert.doesNotMatch(side, /GT:SetAttrValue blk_ent "FACE_SIZE"/);
  assert.match(side, /command "_\.rotate" blk_ent "" pt_c pause/);
});

test("TG and CSV takeoff continue to use GT and enumerate hidden attributes", async () => {
  const tg = await read("Annotation/MEP Tag.lsp");
  const takeoff = await read("Special/Grille takeoff.lsp");
  assert.match(tg, /\(defun c:TG/);
  assert.match(tg, /\(c:GT\)/);
  assert.match(takeoff, /\(vlax-invoke obj 'getattributes\)/i);
  assert.match(takeoff, /\(vla-get-tagstring att\)/i);
  assert.match(takeoff, /\(vla-get-textstring att\)/i);
});

test("the modified LISP files pass the real repo syntax harness (not a mocked green test)", async () => {
  for (const [file, commands] of [
    ["Annotation/MEP Properties.lsp", ["GT", "GRILLE_ATTR_UPGRADE", "MEP_Properties_Create"]],
    ["Draw/Create/Grille.lsp", ["GRR"]],
  ]) {
    const result = validateLispSource(await read(file), commands, { profile: "syntax", fileName: file });
    assert.equal(result.valid, true, file + ": " + JSON.stringify(result.diagnostics));
  }
});
