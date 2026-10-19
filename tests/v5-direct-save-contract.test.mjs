import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/cadgpt/tools/jobs.ts"), "utf8");
const section = src.slice(src.indexOf("async function executeDirectJobScript("), src.indexOf("const TBH_LOADER_PATH"));

test("Direct Python Job must save exact bound DWG after opaque COM mutation", () => {
  assert.match(section, /await cadUpstream\.callTool\("acad_save_bound_document"/);
  assert.match(section, /proof\.runtime_document_id !== drawing\.runtime_document_identity/);
  assert.match(section, /DIRECT_JOB_SAVE_UNVERIFIED/);
  assert.ok(section.indexOf('acad_save_bound_document') < section.indexOf('saved_document: savedDocument'));
});
test("Failed bound DWG Save preserves Direct Python Job runtime for recovery", () => {
  assert.match(section, /preserveForSaveRecovery = true/);
  assert.match(section, /preserveForSaveRecovery = false/);
  assert.match(section, /if \(!preserveForSaveRecovery\)\s*\{\s*await cleanupJobRuntimeForExecution/);
});
test("File-only Direct Python script does not need an unnecessary DWG Save", () => {
  assert.match(section, /if \(drawing && !options\.fileOnly\)/);
});
