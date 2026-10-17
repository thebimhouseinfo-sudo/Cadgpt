import test from "node:test";
import assert from "node:assert/strict";

const { toolAuthority, toolFamily } = await import("../dist/cadgpt/lib/tool-policy.js");

test("V5 Job helper accepts execution-owned Work or legacy SYSTEM caller", () => {
  assert.equal(toolAuthority("job_system_run_helper"), "work-or-system");
  assert.equal(toolAuthority("job_system_release"), "system");
  assert.equal(toolFamily("job_system_run_helper"), "job-authoring");
});

test("V5 Temp Lisp LOAD remains CAD-gated; file publication is FILE-gated", () => {
  assert.equal(toolFamily("temp_job_lisp_load"), "cad");
  assert.equal(toolFamily("temp_job_lisp_publish"), "filesystem");
  assert.equal(toolAuthority("temp_job_lisp_load"), "work");
});
