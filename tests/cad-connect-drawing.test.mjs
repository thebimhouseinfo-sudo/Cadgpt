import test from "node:test";
import assert from "node:assert/strict";

const { resolveCadDrawingSelection } = await import(
  "../dist/cadgpt/tools/cad-launcher.js"
);

const drawings = [
  { key: "1", name: "Same.dwg", full_name: "C:\\One\\Same.dwg" },
  { key: "2", name: "Same.dwg", full_name: "C:\\Two\\Same.dwg" },
  { key: "3", name: "Unique.dwg", full_name: "C:\\Three\\Unique.dwg" },
];

test("drawing selection accepts exact full path and exact unique name", () => {
  assert.equal(
    resolveCadDrawingSelection(drawings, "C:\\Two\\Same.dwg").key,
    "2"
  );
  assert.equal(
    resolveCadDrawingSelection(drawings, "Unique.dwg").key,
    "3"
  );
});

test("drawing selection fails closed for ambiguous, missing and empty values", () => {
  assert.throws(
    () => resolveCadDrawingSelection(drawings, "Same.dwg"),
    /CAD_WORKSPACE_AMBIGUOUS_SELECTION/
  );
  assert.throws(
    () => resolveCadDrawingSelection(drawings, "Missing.dwg"),
    /CAD_WORKSPACE_INVALID_SELECTION/
  );
  assert.throws(
    () => resolveCadDrawingSelection(drawings, ""),
    /CAD_SINGLE_DRAWING_REQUIRED/
  );
});
