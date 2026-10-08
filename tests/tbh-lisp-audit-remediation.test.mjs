import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLispSource } from "../dist/cadgpt/tools/lisp-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kit = path.join(root, "resources", "cad", "internal-lisp", "tbh-toolkit");
const sub = (p) => path.join(kit, "TBH Tool Kit", p);
const read = (p) => fs.readFile(sub(p), "utf8");

function portion(src, open, close) {
  const i=src.indexOf(open), j=src.indexOf(close,i+open.length);
  assert.ok(i>=0&&j>i, "expected source fragment: "+open);
  return src.slice(i,j);
}

test("MVATT, ROATT, EDATT have exactly one case-insensitive command implementation each", async () => {
  const code=await read("Annotation/AttModSuiteV1-1.lsp");
  for(const name of ["mvatt","roatt","edatt"]){
    const def=[...code.matchAll(/^\s*\(defun\s+c:([a-z0-9_-]+)\b/gim)].map(x=>x[1].toLowerCase());
    assert.equal(def.filter(x=>x===name).length,1, "no self-overriding alias for c:"+name);
  }
  assert.doesNotMatch(code, /\(defun c:MVATT \(\) \(c:mvAtt\)\)/);
  assert.doesNotMatch(code, /\(defun c:ROATT \(\) \(c:roAtt\)\)/);
  assert.doesNotMatch(code, /\(defun c:EDATT \(\) \(c:edAtt\)\)/);
  const selection=portion(code,"(defun LM:GetAttribSelection ",";;--------------------=={ Start Undo }");
  assert.match(selection, /\(if \(and o ss tag\) \(list o ss tag\) nil\)/,
    "cancelled or empty ATT selection must return NIL, not a truthy NIL list");
  assert.match(code, /\(defun c:roAtt \( \/ [^\n]*\bo\b/,
    "ROATT localizes the COM attribute ref");
});

test("MMA validates type and returns nil for unresolved system (no wcmatch on nil)", async () => {
  const code=await read("Draw/Modify/Match MEP Properties.lsp");
  const validate=portion(code, "(defun mma:valid-system ", "(defun c:MMA ");
  assert.match(validate, /\(= \(type sys\) 'STR\)/);
  assert.match(validate, /\(member \(strcase sys\) '\("SA" "RA" "OA" "EA" "TA"\)\)/);
  assert.match(validate, /\(strcase sys\)/);
  assert.doesNotMatch(validate, /\(wcmatch sys /);
  assert.match(code, /\(if \(not sys\)[\s\S]*?Cannot detect source system/,
    "keep the current user-facing missing-system message");
});

test("TC error handler cleans up DCL file and dialog on cancel/error without throwing", async () => {
  const code=await read("Special/TBH Calc.lsp");
  assert.match(code, /\(defun c:TC \(\/ \*error* /, "TC declares local *error*");
  const handler=portion(code,"(defun *error* ",";; 2. CONFIGURATION");
  assert.match(handler, /\(numberp dcl_id\)/);
  assert.match(handler, /\(vl-catch-all-apply 'close \(list file_handle\)\)/);
  assert.match(handler, /\(unload_dialog dcl_id\)/);
  assert.match(handler, /\(vl-file-delete dcl_file\)/);
  assert.match(code, /\(setq file_handle nil\)/, "closed file must not be closed twice");
  assert.doesNotMatch(code, /\(defun error \(msg\)/, "AutoLISP callback must be *error*");
  assert.match(code, /\(or \(null dcl_id\) \(<= dcl_id 0\)/, "invalid dialog id is handled");
});

test("ACC defines the shared angle function once", async () => {
  const code=await read("Draw/Auto Connect.lsp");
  assert.equal([...code.matchAll(/\(defun acc:tan2\s/g)].length,1);
});

test("all 63 toolkit children are listed once and physically present in the official loader", async () => {
  const loader=await fs.readFile(path.join(kit,"tbhloader.lsp"),"utf8");
  const paths=[...loader.matchAll(/^\s*"(TBH Tool Kit\/[^"]+\.lsp)"\s*$/gim)].map(x=>x[1]);
  assert.equal(paths.length,63);
  assert.equal(new Set(paths).size,paths.length,"no repeated child load");
  for(const item of paths) {
    const st=await fs.stat(path.join(kit,item));
    assert.ok(st.isFile(),"loaded file exists: "+item);
  }
});

test("new and consolidated fixes pass AutoLISP syntax preflight", async () => {
  const targets=[
    ["Annotation/AttModSuiteV1-1.lsp",["MVATT","ROATT","EDATT"]],
    ["Draw/Modify/Match MEP Properties.lsp",["MMA"]],
    ["Special/TBH Calc.lsp",["TC"]],
    ["Draw/Auto Connect.lsp",["ACC"]],
    ["Annotation/MEP Properties.lsp",["GT"]],
    ["Draw/Create/Blade Damper.lsp",["BD"]],
  ];
  for(const [relative,commands] of targets) {
    const verdict=validateLispSource(await read(relative), commands,
      {profile:"syntax",fileName:relative});
    assert.equal(verdict.valid,true,
      relative+" "+JSON.stringify(verdict.diagnostics));
  }
});
