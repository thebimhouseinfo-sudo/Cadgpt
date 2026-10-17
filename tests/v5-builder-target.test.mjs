import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { assertBuilderTarget, currentBuilderTarget, clearBuilderTarget } from "../dist/cadgpt/runtime/builder-target.js";

test("V5 Builder Work owns one final package and releases it at cleanup", () => {
  const a = path.resolve("fixtures", "job-a");
  const b = path.resolve("fixtures", "job-b");
  assertBuilderTarget("test-exec-owner", a);
  assertBuilderTarget("test-exec-owner", a);
  assert.ok(currentBuilderTarget("test-exec-owner"));
  assert.throws(() => assertBuilderTarget("test-exec-owner", b), /V5_BUILDER_TARGET_OWNERSHIP_MISMATCH/);
  clearBuilderTarget("test-exec-owner");
  assert.equal(currentBuilderTarget("test-exec-owner"), null);
  assertBuilderTarget("test-exec-owner", b);
  clearBuilderTarget("test-exec-owner");
});
