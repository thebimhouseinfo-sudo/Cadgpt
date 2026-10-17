import test from "node:test";
import assert from "node:assert/strict";
import {
  noteVerifiedBoundSave,
  invalidateBoundSave,
  hasVerifiedBoundSave,
  clearBoundSaveForExecution,
  notePotentialCadMutation,
  hasPotentialCadMutation,
  resetCadMutationTracking,
} from "../dist/cadgpt/runtime/bound-save-ledger.js";

test("V5 Save witness is bound to exact execution and DWG lifetime identity", () => {
  noteVerifiedBoundSave("execution-a", "dwg-runtime-a");
  assert.equal(hasVerifiedBoundSave("execution-a", "dwg-runtime-a"), true);
  assert.equal(hasVerifiedBoundSave("execution-b", "dwg-runtime-a"), false);
  assert.equal(hasVerifiedBoundSave("execution-a", "dwg-runtime-b"), false);
  invalidateBoundSave("execution-a");
  assert.equal(hasVerifiedBoundSave("execution-a", "dwg-runtime-a"), false);
});

test("V5 Save witness never survives Work cleanup", () => {
  noteVerifiedBoundSave("execution-b", "dwg-runtime-b");
  clearBoundSaveForExecution("execution-b");
  assert.equal(hasVerifiedBoundSave("execution-b", "dwg-runtime-b"), false);
});

test("V5 possible CAD mutation disallows silent read-only completion and invalidates Save", () => {
  noteVerifiedBoundSave("exec-mutated", "dwg-one");
  notePotentialCadMutation("exec-mutated");
  assert.equal(hasPotentialCadMutation("exec-mutated"), true);
  assert.equal(hasVerifiedBoundSave("exec-mutated", "dwg-one"), false);
  resetCadMutationTracking("exec-mutated");
  assert.equal(hasPotentialCadMutation("exec-mutated"), false);
});
