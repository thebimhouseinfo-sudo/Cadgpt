import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mdFile = path.join(root, "resources", "cad", "internal-lisp", "tbh-toolkit", "TBH Tool Kit", "Draw", "Modify", "Modify Duct.lsp");

test("MD dynamic option menu has exactly three choices and no phantom default", async () => {
  const source = await fs.readFile(mdFile, "utf8");
  const command = source.slice(source.indexOf("(defun c:MD "));
  assert.match(command, /\(initget\s+"1 2 3"\)/);
  const promptMatch = command.match(/\(setq\s+opt\s+\(getkword\s+"([^"]+)"\)\)/);
  assert.ok(promptMatch, "MD must use the original getkword option selector");
  const prompt = promptMatch[1];
  const displayedMenu = prompt.match(/\[([^\]]+)\]/);
  assert.ok(displayedMenu, "AutoCAD Dynamic Input requires an explicit bracketed menu");

  // AutoCAD parses <...> as a default; W<->H created an extra '-' item.
  assert.doesNotMatch(prompt, /[<>]/, "No angle brackets inside the menu prompt");
  const entries = displayedMenu[1].split("/").map((item) => item.trim());
  assert.deepEqual(entries, ["1-Length", "2-Size", "3-Switch W-H"]);
  assert.deepEqual([...prompt.matchAll(/\b([123])-(?:Length|Size|Switch)\b/g)].map((match) => match[1]), ["1", "2", "3"]);
});

test("MD handlers and Enter-to-Length default stay untouched", async () => {
  const source = await fs.readFile(mdFile, "utf8");
  const command = source.slice(source.indexOf("(defun c:MD "));
  assert.match(command, /\(if\s+\(null opt\)\s+\(setq opt "1"\)\)/);
  for (const [key, handler] of [["1", "length"], ["2", "size"], ["3", "switch"]]) {
    const expected = '((= opt "' + key + '") (md:do-' + handler + ' ent ed info))';
    assert.ok(command.includes(expected), "MD option " + key + " must invoke md:do-" + handler);
  }
});
