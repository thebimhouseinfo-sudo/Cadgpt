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

// ---------------------------------------------------------------------------
// Test 1 — physical template and source-path resolution
// ---------------------------------------------------------------------------
test("BLL source DWG is physically bundled and compatible with DWG format", async () => {
  const dwg = await fs.readFile(templateFile);
  assert.ok(dwg.length > 40000, "Bundled SRC template has substantial DWG content");
  assert.match(dwg.toString("ascii", 0, 6), /^AC10/, "Bundled template is a DWG");

  const lsp = await source();
  // New BLLH resolver checks BLLH_SOURCE_DWG env first, then *cadgpt-load-dir*
  assert.match(lsp, /BLLH_SOURCE_DWG/, "env override for source DWG path");
  assert.match(lsp, /\*cadgpt-load-dir\*/, "resolve actual TBH loader root");
  assert.match(lsp, /SRC\\\\FDM TEMPLATE\.dwg/, "relative SRC path inside source-path resolver");
  // ObjectDBX cache must be validated before reuse
  assert.match(lsp, /bllh:dbx-live-p \*BLLH:Dbx\*/, "verify cached ObjectDBX before reuse");
});

// ---------------------------------------------------------------------------
// Test 2 — handle map structure and persistence
// ---------------------------------------------------------------------------
test("BLLH handle map stores SOURCE path, validates hex handles, and supports get/put/save/load", async () => {
  const lsp = await source();

  // Map key format: GROUP|DISPLAY
  assert.match(lsp, /\(strcat group-name "\|" display-name\)/, "map key is GROUP|DISPLAY");

  // Handle validation: non-empty uppercase hex string
  assert.match(lsp, /bllh:handle-valid/, "handle validator present");
  assert.match(lsp, /wcmatch \(strcase value\)/, "hex validation uses wcmatch strcase");

  // map-save writes SOURCE header first
  const save = part(lsp, "(defun bllh:map-save ", "(defun bllh:map-load ");
  assert.match(save, /"SOURCE\|"/, "first line of map file is SOURCE path header");

  // map-load rejects map from a different DWG
  const load = part(lsp, "(defun bllh:map-load ", "(defun bllh:probe-dbx-progid ");
  assert.match(load, /DIFFERENT source DWG/, "map from a different DWG is rejected, no guessing");
  assert.match(load, /bllh:handle-valid val/, "only valid hex handles are loaded from map file");
  assert.match(load, /vl-string-position 124 line nil T/, "last pipe splits key from handle value");
});

// ---------------------------------------------------------------------------
// Test 3 — BLLHINIT migrates legacy names to handles, skips already-mapped entries
// ---------------------------------------------------------------------------
test("BLLHINIT resolves legacy block names to source handles and skips already-mapped entries", async () => {
  const lsp = await source();
  const init = part(lsp, "(defun c:BLLHINIT ", "(defun c:BLLHSET ");

  // BLLHINIT must skip entries that already have a handle
  assert.match(init, /bllh:map-get \(car grp\) \(car item\)/, "skip already-mapped entries");
  // Uses legacy name lookup only for migration
  assert.match(init, /bllh:find-source-sample doc \(cadr item\) \(car item\)/, "uses legacy name only during init migration");
  assert.match(init, /vla-get-Handle \(list obj\)/, "extracts the DWG handle from found object");
  assert.match(init, /bllh:map-put \(car grp\) \(car item\) handle/, "stores extracted handle into map");
  assert.match(init, /bllh:map-save source/, "persists handle map to disk after migration");
  // Reports unresolved entries without failing silently
  assert.match(init, /Unresolved:/, "logs unresolved blocks instead of silently skipping");
});

// ---------------------------------------------------------------------------
// Test 4 — handle-only runtime insertion path
// ---------------------------------------------------------------------------
test("BLL runtime insertion looks up handle only — never falls back to block name", async () => {
  const lsp = await source();

  // Insertion must require a handle in the map
  const insertion = part(lsp, "(defun bllh:insert-selected ", "(defun c:BLL ");
  assert.match(insertion, /bllh:map-load source/, "loads handle map before insertion");
  assert.match(insertion, /bllh:map-get \(car group\) label/, "retrieves handle from map");
  assert.match(insertion, /No SOURCE HANDLE mapped/, "alerts user when handle is missing; never guesses");
  assert.doesNotMatch(insertion, /tbhbl:/, "no reference to old tbhbl: prefix");

  // resolve-handle uses vla-HandleToObject — no name-based search at runtime
  const resolver = part(lsp, "(defun bllh:resolve-handle ", "(defun bllh:insert-from-library ");
  assert.match(resolver, /vla-HandleToObject/, "resolves object by handle ID, not by name");
  assert.match(resolver, /AcDbBlockReference/, "accepts block reference handles");
  assert.match(resolver, /AcDbBlockTableRecord/, "accepts block definition handles");
  assert.match(resolver, /no longer exists. Use BLLHSET/, "clear error when handle is stale");
  assert.doesNotMatch(resolver, /EffectiveName/, "runtime must not search by name");

  // insert-from-library guards against inserting into the template itself
  const lib = part(lsp, "(defun bllh:insert-from-library ", "(defun bllh:write-dcl ");
  assert.match(lib, /source template itself/, "refuses to insert into the source template");
  assert.match(lib, /bllh:resolve-handle src-doc source-handle/, "delegates to handle resolver");
  assert.match(lib, /\(eq opened T\)/, "closes only source document opened by BLL");
  assert.match(lib, /vla-Activate/, "restores destination drawing when source was opened visibly");

  // UCS->WCS conversion is in insert-selected (where getpoint is called)
  assert.match(insertion, /\(trans point 1 0\)/, "converts UCS insertion point to WCS for COM");
});

// ---------------------------------------------------------------------------
// Test 5 — BLLHSET manual mapping and BLLRELOAD lifecycle
// ---------------------------------------------------------------------------
test("BLLHSET maps by direct entity selection and BLLRELOAD invalidates both DBX and map caches", async () => {
  const lsp = await source();

  const setter = part(lsp, "(defun c:BLLHSET ", "(defun c:BLL ");
  // BLLHSET must be run while the source template is the active document
  assert.match(setter, /vla-get-FullName doc/, "checks active document identity");
  assert.match(setter, /strcase source/, "case-insensitive comparison of source path");
  assert.match(setter, /entsel/, "prompts user to pick a block INSERT");
  assert.match(setter, /cdr \(assoc 5 data\)/, "reads handle from DXF group 5");
  assert.match(setter, /bllh:map-put/, "saves new handle into map");
  assert.match(setter, /bllh:map-save/, "persists updated map to disk");

  const reload = part(lsp, "(defun c:BLLRELOAD ", "\n(princ");
  assert.match(reload, /bllh:release-dbx-cache/, "BLLRELOAD drops stale ObjectDBX document");
  assert.match(reload, /\*BLLH:MapLoaded\* nil/, "BLLRELOAD forces map reload on next BLL run");
});

// ---------------------------------------------------------------------------
// Test 6 — APPLOAD lazy guard: suppresses dialogs, captures errors
// ---------------------------------------------------------------------------
test("BLLHINIT auto-run at APPLOAD suppresses file picker and captures errors without crashing", async () => {
  const lsp = await source();

  // Autoloading flag suppresses file-picker dialogs
  assert.match(lsp, /\*BLLH:Autoloading\* T/, "sets autoloading flag before auto-init");
  assert.match(lsp, /\*BLLH:Autoloading\* nil/, "clears autoloading flag after auto-init");
  assert.match(lsp, /if \*BLLH:Autoloading\* nil/, "suppresses getfiled picker during autoload");

  // Error from auto-init is captured and printed, not re-thrown
  assert.match(lsp, /vl-catch-all-apply 'c:BLLHINIT/, "auto-init is guarded by vl-catch-all-apply");
  assert.match(lsp, /Auto-map failed:/, "prints failure message rather than crashing APPLOAD");

  // BLLHINIT skips entries already in the map
  const init = part(lsp, "(defun c:BLLHINIT ", "(defun c:BLLHSET ");
  assert.match(init, /\(not \(bllh:map-get/, "skips entries that already have a handle");
});

// ---------------------------------------------------------------------------
// Test 7 — full syntax validation with all four public commands
// ---------------------------------------------------------------------------
test("BLL full AutoLISP source passes actual syntax validator with all required commands", async () => {
  const lsp = await source();
  const verdict = validateLispSource(lsp, ["BLL", "BLLRELOAD", "BLLHINIT", "BLLHSET"], {
    profile: "syntax",
    fileName: "TBH_Block_Library.lsp",
  });
  assert.equal(verdict.valid, true, JSON.stringify(verdict.diagnostics));
});

