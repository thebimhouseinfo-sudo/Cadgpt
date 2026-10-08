import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLispSource } from "../dist/cadgpt/tools/lisp-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tbh = path.join(root, "resources", "cad", "internal-lisp", "tbh-toolkit", "TBH Tool Kit", "Draw");
const read = (name) => fs.readFile(path.join(tbh, name), "utf8");

function section(text, begin, end) {
  const from = text.indexOf(begin);
  const until = text.indexOf(end, from + begin.length);
  assert.ok(from >= 0 && until > from, "Lisp section exists: " + begin);
  return text.slice(from, until);
}

test("MD follows actual D1/D2 SIZE and LENGTH placement rules, not fixed end offsets", async () => {
  const [md, rect, round] = await Promise.all([
    read("Modify/Modify Duct.lsp"),
    read("Create/Rectangular duct.lsp"),
    read("Create/Round Duct.LSP"),
  ]);
  const layout = section(md, "(defun md:att-layout ", "(defun md:att-point ");
  const d1 = section(rect, "(defun dt:draw ", "(defun dt:edit-ducts ");
  const d2 = section(round, "(defun rd:draw ", ";; ─── BATCH EDIT");

  // Check the shared world-corner decision and local end reversal.
  for (const code of [layout, d1, d2]) {
    assert.match(code, /0\.174/, "same vertical/horizontal orientation cutoff");
    assert.match(code, /0\.01/, "same world-coordinate tie tolerance");
  }
  assert.match(layout, /bxS \(if \(or \(= idx 1\) \(= idx 4\)\) mg \(- len mg\)\)/);
  assert.match(layout, /bxL\s+\(if \(or \(= idx 1\) \(= idx 4\)\) \(- len mg\) mg\)/);
  assert.match(d1, /bxTL \(if \(or \(= idxTL 1\) \(= idxTL 4\)\) mg \(- pl mg\)\)/);
  assert.match(d2, /bxSIZE \(if \(or \(= idxTL 1\) \(= idxTL 4\)\) mg \(- pl mg\)\)/);

  // D1: centerline if width <=250; otherwise two offset faces.
  assert.match(layout, /narrow \(<= width 250\.0\)/);
  assert.match(layout, /\(<= width 300\.0\)/);
  assert.match(layout, /\(setq high -50\.0 low \(\+ \(- width\) 50\.0\)\)/);
  assert.match(d1, /\(<= w 250\.0\)/);
  assert.match(d1, /\(<= w 300\.0\)/);
  assert.match(d1, /\(setq offAbove -50\.0 offBelow \(\+ \(- 0\.0 w\) 50\.0\)\)/);
  // D2: both on centerline.
  assert.match(layout, /\(= fam "RD"\)[\s\S]*?\(cons "SIZE" \(list bxS 0\.0 0 2\)\)/);
  assert.match(layout, /\(cons "LENGTH" \(list bxL 0\.0 2 2\)\)/);
  assert.match(d2, /\(rd:make-attrib "SIZE"[\s\S]*?bxSIZE 0\.0 1 cu ang tang\)/);
  assert.match(d2, /\(rd:make-attrib "LENGTH"[\s\S]*?bxLEN 0\.0 9 cu ang tang\)/);
});

test("MD snapshots old relative ATT positions before block swap and reflows after updates", async () => {
  const md = await read("Modify/Modify Duct.lsp");
  const areas = [
    { name: "rect size", source: section(md, "(defun md:do-size ", "    ((= fam \"RD\")"), width: "w", target: "newW" },
    { name: "round size", source: section(md, "    ((= fam \"RD\")", ";; ─── SWITCH FUNCTION"), width: "d", target: "newD" },
    { name: "switch width/height", source: section(md, "(defun md:do-switch ", ";; ─── LENGTH FUNCTIONS"), width: "w", target: "h" },
    { name: "rect length", source: section(md, "(defun md:resize-rect ", "(defun md:resize-round "), width: "W", target: "W", oldLength: "oldlen", afterLength: "pl" },
    { name: "round length", source: section(md, "(defun md:resize-round ", ";; ─── MAIN COMMAND"), width: "D", target: "D", oldLength: "oldlen", afterLength: "pl" },
  ];
  for (const { name, source, width, target, oldLength = "pl", afterLength = "pl" } of areas) {
    const capture = source.indexOf("(md:att-snapshot ent ");
    const swap = source.indexOf("(setq ed (subst (cons 2 ");
    const apply = source.indexOf("(md:att-reflow ent ");
    assert.ok(capture >= 0 && swap > capture && apply > swap, name + ": capture → block swap → ATT reposition");
    assert.ok(source.includes(" " + oldLength + " " + width + ")"), name + ": old dimensions captured");
    assert.ok(source.includes(" " + afterLength + " " + target + ")"), name + ": new dimensions applied");
  }
  assert.doesNotMatch(section(md, "(defun md:resize-rect ", ";; ─── MAIN COMMAND"), /\(md:move-att /);
});

test("MD preserves manual ATT adjustments, justification, values, hidden metadata and mirrored frames", async () => {
  const md = await read("Modify/Modify Duct.lsp");
  const capture = section(md, "(defun md:att-snapshot ", "(defun md:att-reflow ");
  const reflow = section(md, "(defun md:att-reflow ", ";; ─── PARSE BLOCK NAME");
  const frame = section(md, "(defun md:att-frame ", "(defun md:att-local ");

  assert.match(capture, /member tag '\("SIZE" "LENGTH"\)/, "only two visible duct tags repositioned");
  assert.match(capture, /md:att-local/, "snapshot original position in INSERT-local frame");
  assert.match(capture, /delta \(list \(- \(car local\) \(car spec\)\)/, "retain manually adjusted local offset");
  assert.match(reflow, /\(\+ \(car spec\) \(car delta\)\)/, "restore manual X offset after new layout");
  assert.match(reflow, /\(\+ \(cadr spec\) \(cadr delta\)\)/, "restore manual Y offset after new layout");
  assert.match(reflow, /caddr oldpt/, "retain ATT elevation");
  assert.match(reflow, /\(if \(nth 3 row\)/, "only switch original standard justifications");
  assert.doesNotMatch(reflow, /\(cons (?:1|50) /, "do not overwrite attribute content or text rotation");
  assert.match(frame, /\(assoc 41 ed\)/, "handle X scale");
  assert.match(frame, /\(assoc 42 ed\)/, "handle Y scale");
});

test("modified MD Lisp passes the real AutoLISP syntax preflight", async () => {
  const source = await read("Modify/Modify Duct.lsp");
  const verdict = validateLispSource(source, ["MD"], {
    profile: "syntax",
    fileName: "Modify Duct.lsp",
  });
  assert.equal(verdict.valid, true, JSON.stringify(verdict.diagnostics));
});
