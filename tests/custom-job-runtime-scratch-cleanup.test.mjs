import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const runtime = fs.readFileSync(path.join(root, "src/cadgpt/runtime/job-runtime.ts"), "utf8");
const jobs = fs.readFileSync(path.join(root, "src/cadgpt/tools/jobs.ts"), "utf8");

test("Custom Job DONE cleans scratch while failed Job preserves diagnostics", () => {
  const start = jobs.indexOf('"job_runtime_finish"');
  const next = jobs.indexOf("server.registerTool(", start + 1);
  const finish = jobs.slice(start, next);
  assert.match(finish, /clearRuntimeScratch: outcome === "done"/);
  assert.match(finish, /cleanupJobRuntimeForExecution\(lease\.workId/);
  assert.match(finish, /JOB_SAVE_FAILED/);
  assert.doesNotMatch(finish, /JOB_DONE_AUTOSAVE_FAILED/);
});

test("runtime scratch cleanup cannot target Job result or permanent assets", () => {
  assert.match(runtime, /expectedRuntime = path\.resolve\(context\.job_root, "runtime"\)/);
  assert.match(runtime, /isolatedRuns = path\.join\(expectedRuntime, "runs"\)/);
  assert.match(runtime, /runtime parent identity changed/);
  assert.match(runtime, /JOB_RUNTIME_CLEANUP_SCOPE/);
  assert.match(runtime, /if \(entry === JOB_STEPS_FILENAME\) continue/);
  assert.match(runtime, /fs\.rm\(path\.join\(context\.runtime_root, entry\)/);
  assert.match(runtime, /removed_runtime_entries: removedRuntimeEntries/);
});
