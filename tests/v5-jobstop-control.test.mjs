import test from "node:test";
import assert from "node:assert/strict";

test("cg/jobstop invokes only Job stop, not Work stop or CAD disconnect", async () => {
  const callbacks = new Map();
  const fakeServer = { registerTool(name, _schema, callback) { callbacks.set(name, callback); } };
  const { registerCadGptControlTool } = await import("../dist/cadgpt/tools/control.js");
  let jobs = 0, works = 0, cadChecks = 0;
  registerCadGptControlTool(fakeServer, {
    sessionKey: "jobstop-test",
    getCadState: async () => { cadChecks++; return "ON"; },
    launchCadWorkspace: async () => "",
    listJobs: async () => "",
    stopCurrentJob: async () => { jobs++; return { stopped: true, detail: "Job stopped; CAD MCP still connected." }; },
    stopCurrentWork: async () => { works++; return { stopped: true, pending: false }; },
  });
  const result = await callbacks.get("cadgpt_control")({ surface: "jobstop" });
  assert.equal(result.structuredContent.text, "Job stopped; CAD MCP still connected.");
  assert.equal(jobs, 1);
  assert.equal(works, 0);
  assert.equal(cadChecks, 0, "Job stop must not depend on CAD MCP status polling");
});
