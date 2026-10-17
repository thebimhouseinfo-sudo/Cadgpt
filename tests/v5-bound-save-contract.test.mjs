import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const jobs = fs.readFileSync(path.join(root, "src/cadgpt/tools/jobs.ts"), "utf8");
const proxy = fs.readFileSync(path.join(root, "src/cadgpt/tools/cad-proxy.ts"), "utf8");

test("V5 can Save bound DWG immediately and avoid duplicate Save at finish", () => {
  assert.match(jobs, /"job_runtime_save_now"/);
  assert.match(jobs, /noteVerifiedBoundSave\(lease\.workId, drawing\.runtime_document_identity\)/);
  const segment = jobs.slice(jobs.indexOf('"job_runtime_finish"'), jobs.indexOf('"job_system_acquire"'));
  assert.match(segment, /hasVerifiedBoundSave\(lease\.workId, drawing\.runtime_document_identity\)/);
  assert.match(segment, /early_save_verified: true/);
  assert.match(segment, /JOB_SAVE_FAILED/);
});

test("V5 invalidates earlier Save on later Lisp mutation or autorun LOAD", () => {
  assert.match(proxy, /invalidateBoundSave\(currentToolLease\(\)\.workId\)/);
  assert.match(proxy, /noteVerifiedBoundSave\(executionId, binding\.runtime_document_identity\)/);
});
