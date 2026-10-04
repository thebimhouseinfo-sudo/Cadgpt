import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { listBundledLispEntries } from "../dist/cadgpt/lib/bundled-assets.js";
import { validateLispSource } from "../dist/cadgpt/tools/lisp-harness.js";

test("Drawing Anchor adapter is a core-private valid AutoLISP file", async () => {
  const source = await fs.readFile(
    new URL(
      "../resources/cad/core-lisp/drawing-anchor.lsp",
      import.meta.url
    ),
    "utf8"
  );

  const result = validateLispSource(source, [], {
    profile: "syntax",
    fileName: "drawing-anchor.lsp",
  });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.match(source, /defun\s+cadgpt-drawing-anchor-ensure/i);
  assert.doesNotMatch(source, /defun\s+c:/i);
  assert.match(source, /CADGPT_DRAWING_ANCHOR/);
  assert.match(source, /dictadd/);
  assert.match(source, /entmakex/);
});

test("Drawing Anchor adapter is not promoted into the bundled Lisp Registry", async () => {
  const entries = await listBundledLispEntries();
  assert.equal(
    entries.some((entry) =>
      String(entry.load_path).replaceAll("\\", "/").endsWith(
        "/drawing-anchor.lsp"
      )
    ),
    false
  );
});

test("Python Drawing Anchor service delegates DWG mutation to internal AutoLISP", async () => {
  const source = await fs.readFile(
    new URL(
      "../runtimes/cad-mcp/services/drawing_anchor_service.py",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /load_lisp_file\(ANCHOR_LISP_PATH\)/);
  assert.match(source, /run_lisp_function_sync/);
  assert.match(source, /internal_autolisp/);
  assert.doesNotMatch(source, /pythoncom|VARIANT|win32com|SetXRecordData|GetXRecordData/);
});
