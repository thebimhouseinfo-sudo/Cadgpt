import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolkitRoot = path.join(root, "resources", "cad", "internal-lisp", "tbh-toolkit");
const canonical = { "1": "SA", "2": "RA", "3": "OA", "4": "EA", "5": "TA" };

// Only numeric *HVAC system* choices are governed by this rule.
// Other menus (insulation, shape, elbow type, grille geometry) keep their own numbering.
async function allLispFiles(dir) {
  const out = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...await allLispFiles(target));
    if (item.isFile() && /\.lsp$/i.test(item.name)) out.push(target);
  }
  return out.sort();
}

function relative(file) {
  return path.relative(toolkitRoot, file).replaceAll("\\", "/");
}

function assertNumericChoice(number, system, location) {
  const normalized = system.toUpperCase().replace(/^(SA|RA|OA|EA|TA)G$/, "$1");
  assert.equal(canonical[number], normalized, `${location}: ${number} must mean ${canonical[number] || "no system"}; found ${system}`);
}

test("scan every TBH Lisp system shortcut: 1 SA, 2 RA, 3 OA, 4 EA, 5 TA", async () => {
  const files = await allLispFiles(toolkitRoot);
  assert.ok(files.length >= 64, `full TBH Toolkit inventory expected; saw ${files.length}`);
  let checked = 0;
  const visited = new Set();

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const fileName = relative(file);

    // User-facing numeric system labels, including '1=Supply Air (SA)' and
    // grille labels such as '3 = OAG'. Excludes unrelated numbered menus.
    const fullLabel = /\b([0-5])\s*[=:]\s*(?:Supply|Return|Outside|Exhaust|Transfer)\s+Air\s*\((SA|RA|OA|EA|TA)\)/gi;
    // TAG alone can mean a generic annotation "Tag", so check it in the
    // explicit MEP Properties mapping test rather than guessing its meaning.
    const shortLabel = /\b([0-5])\s*[-=:]\s*(SA|RA|OA|EA|TA|SAG|RAG|OAG|EAG)\b/gi;
    for (const [kind, expression] of [["full", fullLabel], ["short", shortLabel]]) {
      for (const match of source.matchAll(expression)) {
        assertNumericChoice(match[1], match[2], `${fileName}:${kind}`);
        checked++;
        visited.add(fileName);
      }
    }

    // Also catch outdated round-duct style labels without '=' (0:SA).
    const colonLabel = /\b([0-5])\s*:\s*(SA|RA|OA|EA|TA)\b/gi;
    for (const match of source.matchAll(colonLabel)) {
      assertNumericChoice(match[1], match[2], `${fileName}:colon`);
      checked++;
      visited.add(fileName);
    }
  }

  assert.ok(checked >= 25, `system menu coverage unexpectedly shrank (found ${checked})`);
  assert.ok(visited.size >= 6, `system-menu file coverage unexpectedly shrank (found ${visited.size})`);
});

test("all bare numeric AutoCAD layer aliases, including shading, are canonical and unique", async () => {
  const files = await allLispFiles(toolkitRoot);
  const byAlias = new Map();
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(/\\(\\s*defun\\s+c:([1-5](?:r)?)\\s*\\(/gi)) {
      const alias = match[1].toLowerCase();
      const definitions = byAlias.get(alias) || [];
      definitions.push({ source, file: relative(file) });
      byAlias.set(alias, definitions);
    }
  }
  for (const [digit, system] of Object.entries(canonical)) {
    for (const suffix of ["", "r"]) {
      const alias = digit + suffix;
      const definitions = byAlias.get(alias) || [];
      assert.equal(definitions.length, 1, "Exactly one loader-owned definition for c:" + alias);
      const { source, file } = definitions[0];
      assert.equal(file, "TBH Tool Kit/Draw/Others/Change Layer.lsp", alias + " source");
      const layer = "Hvacduct-" + system.toLowerCase() + (suffix ? "-shading" : "");
      assert.ok(source.includes('(defun c:' + alias + ' () (_SetCLayer "' + layer + '"))'),
        "c:" + alias + " must target " + layer);
    }
  }
});

test("all four Grille interactive system selectors accept and apply exactly the canonical order", async () => {
  const source = await fs.readFile(path.join(toolkitRoot, "TBH Tool Kit", "Draw", "Create", "Grille.lsp"), "utf8");
  const prompts = source.split("Select system [1-SA/2-RA/3-OA/4-EA/5-TA]").length - 1;
  const keywords = source.split('initget "1 2 3 4 5 SA RA OA EA TA"').length - 1;
  assert.equal(prompts, 4, "all four independent Grille branches must prompt correct system numbers");
  assert.equal(keywords, 4, "all four branches must accept five numbers and five aliases");
  for (const [digit, system] of Object.entries(canonical)) {
    const expected = '((or (= sys_input "' + digit + '") (= sys_input "' + system + '")) (setq sys_name "' + system + '" prefix "Hvac-' + system + '"))';
    assert.equal(source.split(expected).length - 1, 4, "all Grille branches: " + digit + "=" + system);
  }
});

test("CD displayed order agrees with cd:norm-type, including OA and EA", async () => {
  const src = await fs.readFile(path.join(toolkitRoot, "TBH Tool Kit", "Draw", "Modify", "Change Duct Type.lsp"), "utf8");
  for (const [number, system] of Object.entries(canonical)) {
    assert.ok(src.includes(`((= kw "${number}") "${system}")`), `CD mapping: ${number}=${system}`);
  }
  assert.match(src, /3=Outside Air \(OA\) \/ 4=Exhaust Air \(EA\)/);
  assert.match(src, /initget "1 2 3 4 5 SA RA OA EA TA"/);
});

test("round duct CHANGE uses 1..5 and maps every shortcut to the right duct system", async () => {
  const src = await fs.readFile(path.join(toolkitRoot, "TBH Tool Kit", "Draw", "Create", "Round Duct.LSP"), "utf8");
  assert.match(src, /initget "1 2 3 4 5 SA RA OA EA TA"/);
  assert.match(src, /Change to Duct Type \[1=SA \/ 2=RA \/ 3=OA \/ 4=EA \/ 5=TA\]/);
  for (const [number, system] of Object.entries(canonical)) {
    assert.ok(src.includes(`((= nType "${number}") (setq nType "${system}"))`), `Round Duct: ${number}=${system}`);
  }
  assert.doesNotMatch(src, /Change to Duct Type \[0=SA/);
});

test("DTS normalizer and rectangular duct CHANGE retain consistent shortcuts", async () => {
  const dts = await fs.readFile(path.join(toolkitRoot, "TBH Tool Kit", "Draw", "Duct Type Setting.lsp"), "utf8");
  const rect = await fs.readFile(path.join(toolkitRoot, "TBH Tool Kit", "Draw", "Create", "Rectangular duct.lsp"), "utf8");
  for (const [number, system] of Object.entries(canonical)) {
    assert.ok(dts.includes(`(member s '("${number}" "${system}"))`), `DTS: ${number}=${system}`);
    assert.ok(rect.includes(`((= nType "${number}") (setq nType "${system}"))`), `Rectangular Duct: ${number}=${system}`);
  }
});

test("grille system selection and tapper use the same convention", async () => {
  const grille = await fs.readFile(path.join(toolkitRoot, "TBH Tool Kit", "Draw", "Create", "Grille.lsp"), "utf8");
  const tapper = await fs.readFile(path.join(toolkitRoot, "TBH Tool Kit", "Draw", "Others", "Tapper.lsp"), "utf8");
  const properties = await fs.readFile(path.join(toolkitRoot, "TBH Tool Kit", "Annotation", "MEP Properties.lsp"), "utf8");
  for (const [number, system] of Object.entries(canonical)) {
    assert.ok(grille.includes(`(= sys_input "${number}") (= sys_input "${system}")`), `Grille: ${number}=${system}`);
    assert.ok(tapper.includes(`((= sys_type "${number}") "Hvacduct-${system.toLowerCase()}")`), `Tapper: ${number}=${system}`);
    assert.ok(properties.includes(`((= kw "${number}") (setq layer "Hvac-${system}Grille"))`), `MEP Properties: ${number}=${system}`);
  }
});
