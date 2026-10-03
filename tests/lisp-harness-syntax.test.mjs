import test from "node:test";
import assert from "node:assert/strict";

import { validateLispSource } from "../dist/cadgpt/tools/lisp-harness.js";

test("AutoLISP validator accepts a structurally valid command", () => {
  const source = [
    "(defun c:HELLO (/)",
    '  (princ "\\nHello")',
    "  (princ))",
    "(princ)",
    "",
  ].join("\n");

  const result = validateLispSource(source, ["HELLO"], { profile: "syntax", fileName: "hello.lsp" });
  assert.equal(result.valid, true);
  assert.deepEqual(result.commands, ["HELLO"]);
});

test("AutoLISP validator rejects unmatched parentheses and unclosed strings", () => {
  const unmatched = validateLispSource("(defun c:BROKEN (/)\n  (princ))\n)", [], { profile: "syntax" });
  assert.equal(unmatched.valid, false);
  assert.ok(unmatched.diagnostics.some((item) => item.code === "UNMATCHED_CLOSE_PAREN"));

  const unclosedString = validateLispSource('(defun c:BROKEN (/)\n  (princ "oops)\n  (princ))', [], {
    profile: "syntax",
  });
  assert.equal(unclosedString.valid, false);
  assert.ok(unclosedString.diagnostics.some((item) => item.code === "UNCLOSED_STRING"));
});

test("AutoLISP validator rejects Common Lisp-only forms", () => {
  const result = validateLispSource("(defun c:BROKEN (/) (let ((x 1)) (princ x)) (princ))", [], {
    profile: "syntax",
  });
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((item) => item.code === "COMMON_LISP_FORM"));
});

test("AutoLISP validator enforces an expected public command", () => {
  const result = validateLispSource("(defun c:OTHER (/) (princ))", ["EXPECTED"], { profile: "syntax" });
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((item) => item.code === "MISSING_EXPECTED_COMMAND"));
});
