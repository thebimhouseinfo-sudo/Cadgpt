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
  assert.match(source, /CADGPT_PERSISTENCE/);
  assert.match(source, /\(280 \. 1\)/);
  assert.match(source, /defun\s+cadgpt-drawing-anchor-read/i);
  assert.match(source, /dictadd/);
  assert.match(source, /entmakex/);
  assert.match(source, /HasExtensionDictionary/);
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

  assert.match(source, /load_lisp_file\([\s\S]*document=doc/);
  assert.match(source, /run_lisp_function_sync/);
  assert.match(source, /ANCHOR_LISP_READ_FUNCTION/);
  assert.match(source, /if read_raw != "MISSING"/);
  assert.match(source, /verify_raw = run_lisp_function_sync/);
  assert.match(source, /document=doc/);
  assert.match(source, /Drawing Anchor changed during the same exact-document transaction/);
  assert.match(source, /internal_autolisp/);
  assert.doesNotMatch(source, /pythoncom|VARIANT|win32com|SetXRecordData|GetXRecordData/);

  const sessionSource = await fs.readFile(
    new URL(
      "../runtimes/cad-mcp/connection/session.py",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(sessionSource, /expected_runtime_id = runtime_document_id\(doc\)/);
  assert.match(sessionSource, /last_runtime_id == expected_runtime_id/);
  assert.match(sessionSource, /did not activate the explicitly bound document before timeout/);

  const lispServiceSource = await fs.readFile(
    new URL(
      "../runtimes/cad-mcp/services/lisp_service.py",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(lispServiceSource, /def _send\(command: str, document=None\)/);
  assert.match(lispServiceSource, /def load_lisp_file\(path: str, document=None\)/);
  assert.match(lispServiceSource, /document if document is not None else get_active_document\(\)/);
});
