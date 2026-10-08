import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLispSource } from "../dist/cadgpt/tools/lisp-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const draw = path.join(root, "resources", "cad", "internal-lisp", "tbh-toolkit", "TBH Tool Kit", "Draw");
const bd = () => fs.readFile(path.join(draw, "Create", "Blade Damper.lsp"), "utf8");

function section(src, begin, end) {
  const start = src.indexOf(begin);
  const stop = src.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && stop > start, "section exists: " + begin);
  return src.slice(start, stop);
}

test("BD takes system only from picked duct's block/layer, never current layer or stale defaults", async () => {
  const src = await bd();
  const command = section(src, "(defun c:BD ", "(princ \"\\n[TBH] Blade Damper Tool loaded.");
  assert.match(command, /info\s+\(bd:parse-duct ent ed \(cadr sel\)\)/);
  assert.match(command, /blockSys \(if info \(cdr \(assoc 'sys info\)\) nil\)/);
  assert.match(command, /dts:system-from-layer ductLay/);
  assert.match(command, /bd:system-from-layer ductLay/);
  assert.match(command, /sys\s+\(if blockSys blockSys layerSys\)/);
  assert.doesNotMatch(command, /getvar "CLAYER"|bd:system-from-picked-layer-last2|\*DT:Type\*|\*RD:Type\*/,
    "current layer, two-character layer suffix and unrelated globals may not choose the system");
  assert.match(command, /\(and blockSys layerSys \(\/= blockSys layerSys\)\)/,
    "conflicting block/layer evidence must fail closed");
  assert.match(command, /Fix the duct before placing BD\./);
  assert.match(command, /\(\(null sys\)/, "unresolved system should not draw on an arbitrary layer");
});

test("BD outputs correct main and shading layer for SA RA OA EA TA", async () => {
  const src = await bd();
  const layers = section(src, "(defun bd:system-layer ", "(defun bd:shading-layer ");
  const command = section(src, "(defun c:BD ", "(princ \"\\n[TBH] Blade Damper Tool loaded.");
  const dt = await fs.readFile(path.join(draw, "Create", "Rectangular duct.lsp"), "utf8");
  const rd = await fs.readFile(path.join(draw, "Create", "Round Duct.LSP"), "utf8");
  for (const sys of ["SA", "RA", "OA", "EA", "TA"]) {
    const expected = "Hvacduct-" + sys.toLowerCase();
    const mapping = new RegExp('\\("' + sys + '"\\s*\\.\\s*"' + expected + '"\\)');
    assert.match(layers, mapping, "BD system " + sys + " targets " + expected);
    assert.match(dt, mapping, "D1 mapping " + sys);
    assert.match(rd, mapping, "D2 mapping " + sys);
  }
  assert.match(layers, /dts:get-system-layer/, "honor configured MEP mapping when available");
  assert.match(command, /lay\s+\(bd:system-layer sys\)/, "resolve target layer before drawing");
  assert.match(command, /\(bd:draw-spigot lay info size typ\)/, "apply resolved layer to geometry");
  assert.match(command, /\(bd:blockify blockName base \(cadr drawRes\) lay\)/,
    "apply resolved layer to INSERT");
  assert.match(src, /\(bd:shading-layer lay\)/, "shading derives from the very same target layer");
});

test("BD keeps existing damper type, size and edge-placement UI without manual system menu", async () => {
  const src = await bd();
  const command = section(src, "(defun c:BD ", "(princ \"\\n[TBH] Blade Damper Tool loaded.");
  assert.match(command, /initget "1 2"/);
  assert.match(command, /Select type \[1=Spigot\+BD, 2=Spigot Only\]/);
  assert.match(command, /Spigot Width/);
  assert.match(command, /Select duct edge to place BD/);
  assert.match(command, /bd:slide-preview ins info \(cadr sel\)/);
  assert.doesNotMatch(command, /Select System|Select Layer|Change System|Change Layer/i);
});

test("BD new source passes AutoLISP syntax preflight", async () => {
  const src = await bd();
  const verdict = validateLispSource(src, ["BD"], {
    profile: "syntax",
    fileName: "Blade Damper.lsp",
  });
  assert.equal(verdict.valid, true, JSON.stringify(verdict.diagnostics));
});
