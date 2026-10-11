import test from "node:test";
import assert from "node:assert/strict";
import { registerCadGptControlTool } from "../dist/cadgpt/tools/control.js";
import { checkAdmission, revokeSessionAdmissions } from "../dist/cadgpt/lib/admission.js";
import * as work from "../dist/cadgpt/lib/work-registration.js";

test("CG authoring and global knowledge choose HYBRID but reuse active Work", async () => {
  const session = "v2-hybrid-control";
  checkAdmission(session, "@cg", "mention");
  const callbacks = new Map();
  let cadCalls = 0;
  registerCadGptControlTool({
    registerTool(name, _cfg, handler) { callbacks.set(name, handler); },
  }, {
    sessionKey: session,
    async getCadState() { cadCalls++; return "IDLE"; },
    async launchCadWorkspace() { cadCalls++; return ""; },
    async listJobs() { return ""; },
    async stopCurrentWork() { return { stopped: true, pending: false }; },
  });
  let current;
  try {
    for (const surface of ["cl", "cj", "kug"]) {
      const result = await callbacks.get("cadgpt_control")({ surface });
      assert.equal(result.structuredContent.continuation_policy.start_new_work, true);
      assert.equal(result.structuredContent.continuation_policy.execution_path, "hybrid");
    }
    current = work.createWorkRegistration({
      sessionKey: session, ownerType: "file", ownerId: "authoring", executionPath: "hybrid",
    });
    for (const surface of ["cl", "cj", "kug"]) {
      const result = await callbacks.get("cadgpt_control")({ surface });
      const policy = result.structuredContent.continuation_policy;
      assert.equal(policy.start_new_work, false);
      assert.equal(policy.active_work_handle.execution_id, current.executionId);
      assert.equal(policy.active_work_handle.execution_path, "hybrid");
    }
    assert.equal(cadCalls, 0, "workflow selection must not activate CAD");
  } finally {
    if (current) work.releaseWorkRegistration(current.executionId, current.authorityToken, session);
    revokeSessionAdmissions(session);
  }
});
