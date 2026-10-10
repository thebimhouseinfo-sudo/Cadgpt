import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { verifiedLispLoadFailureResult } from "../dist/cadgpt/tools/cad-proxy.js";

const inputPath = "appdata/libraries/jobs/grille-tag/grille-tag/lisp/tagallgrille.lsp";
const drawing = "MAGS-drawing-fixture";

test("Lisp loaded=false is exposed as real tool failure with original source error and log", () => {
  const upstream = {
    structuredContent: {
      result: {
        loaded: false,
        error: "no function definition: TBH-GET-MODEL",
        log_tail: "\nError: no function definition: TBH-GET-MODEL\n",
      },
    },
  };
  const failure = verifiedLispLoadFailureResult(upstream, inputPath, drawing);
  assert.equal(failure?.isError, true);
  assert.equal(failure.structuredContent.ok, false);
  assert.equal(failure.structuredContent.data.error_code, "CADGPT_LISP_LOAD_FAILED");
  assert.equal(failure.structuredContent.data.source_path, inputPath);
  assert.equal(failure.structuredContent.data.drawing_id, drawing);
  assert.match(failure.structuredContent.data.error, /TBH-GET-MODEL/);
  assert.match(failure.structuredContent.data.log_tail, /TBH-GET-MODEL/);
  assert.equal(failure.structuredContent.data.loaded, false);
  assert.deepEqual(JSON.parse(failure.content[0].text), failure.structuredContent);
});

test("Lisp timeout inside FastMCP TextContent remains FAILED, never transport PASS", () => {
  const upstream = {
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: true,
        data: {
          loaded: false,
          error: "AutoCAD did not reach the Lisp load-success sentinel before timeout.",
        },
      }),
    }],
  };
  const failure = verifiedLispLoadFailureResult(upstream, inputPath, drawing);
  assert.equal(failure.isError, true);
  assert.match(failure.structuredContent.data.error, /timeout/);
  assert.equal(failure.structuredContent.data.error_code, "CADGPT_LISP_LOAD_FAILED");
});

test("CAD tool error without loaded=true stays unverified with original message", () => {
  const upstream = {
    isError: true,
    structuredContent: { ok: false, data: { error: "LISP_COMMAND_SCOPE: denied" } },
  };
  const failure = verifiedLispLoadFailureResult(upstream, inputPath, drawing);
  assert.equal(failure.isError, true);
  assert.equal(failure.structuredContent.data.error_code, "CADGPT_LISP_LOAD_UNVERIFIED");
  assert.match(failure.structuredContent.data.error, /LISP_COMMAND_SCOPE/);
});

test("only confirmed loaded=true without MCP transport error can be PASS", () => {
  assert.equal(verifiedLispLoadFailureResult(
    { structuredContent: { loaded: true, error: null } },
    inputPath, drawing
  ), null);
  assert.equal(verifiedLispLoadFailureResult(
    { isError: true, structuredContent: { loaded: true, error: "transport lost" } },
    inputPath, drawing
  )?.isError, true);
  assert.equal(verifiedLispLoadFailureResult(
    { structuredContent: { note: "Queued to AutoCAD" } },
    inputPath, drawing
  )?.isError, true);
});

test("Job Steps harness requires user-visible PASS/FAIL source diagnostics and no silent workaround", async () => {
  const harness = await fs.readFile(
    path.join(process.cwd(), "knowledge", "jobs", "REASONING_HARNESS.md"), "utf8"
  );
  assert.match(harness, /User-visible step reporting is mandatory/);
  assert.match(harness, /loaded=false/);
  assert.match(harness, /loaded=true/);
  assert.match(harness, /CadGPT platform\/source failure/);
  assert.match(harness, /before the runtime\s+resets Job Steps/);
  assert.match(harness, /do not silently call another lower-level/);
});
