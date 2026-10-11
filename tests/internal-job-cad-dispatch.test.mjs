import test from "node:test";
import assert from "node:assert/strict";

import { checkAdmission, revokeSessionAdmissions } from "../dist/cadgpt/lib/admission.js";
import { toolFamily, toolFamilyForInvocation } from "../dist/cadgpt/lib/tool-policy.js";
import {
  acquireToolLease,
  createWorkRegistration,
  releaseWorkRegistration,
  runWithToolLease,
} from "../dist/cadgpt/lib/work-registration.js";
import { executeInternalDirectJob } from "../dist/cadgpt/tools/jobs.js";
import { getInternalJob } from "../dist/cadgpt/lib/internal-jobs.js";

test("TBH Internal Direct Job accepts CAD-only bound drawing Work; User Direct Job remains FILE-gated", async () => {
  const session = "tbh-internal-cad-work";
  checkAdmission(session, "@cg", "mention");
  const work = createWorkRegistration({
    sessionKey: session,
    ownerType: "direct-cad",
    ownerId: "bound-drawing",
    executionPath: "cad",
  });
  try {
    assert.equal(toolFamily("job_run_direct"), "job-authoring");
    assert.equal(toolFamilyForInvocation("job_run_direct", { id: "tbh" }), "cad");
    assert.equal(toolFamilyForInvocation("job_run_direct", { id: "TBH" }), "cad");
    assert.equal(toolFamilyForInvocation("job_run_direct", { id: "custom-job" }), "job-authoring");
    assert.equal(toolFamilyForInvocation("job_run_direct", { id: "unknown" }), "job-authoring");
    assert.equal(toolFamilyForInvocation("job_runtime_prepare", { id: "tbh" }), "job-authoring");

    assert.throws(() => acquireToolLease({
      tool: "job_run_direct", family: toolFamilyForInvocation("job_run_direct", { id: "custom-job" }),
      sessionKey: session,
      executionId: work.executionId, authorityToken: work.authorityToken,
    }), /EXECUTION_PATH_MISMATCH/);

    const lease = acquireToolLease({
      tool: "job_run_direct", family: toolFamilyForInvocation("job_run_direct", { id: "tbh" }),
      sessionKey: session, executionId: work.executionId,
      authorityToken: work.authorityToken,
    });
    const tbh = getInternalJob("tbh");
    let loadCalls = 0;
    const loaded = await runWithToolLease(lease, () =>
      executeInternalDirectJob(tbh, [], async (source) => {
        loadCalls++;
        assert.equal(source, "resources/cad/internal-lisp/tbh-toolkit/tbhloader.lsp");
        return { loaded: true, commands: [], drawing_id: "dwg-test", raw: { loaded: true } };
      }, () => {})
    );
    assert.equal(loadCalls, 1);
    assert.equal(loaded.loaded, true);
    assert.equal(loaded.registry, "internal");
  } finally {
    releaseWorkRegistration(work.executionId, work.authorityToken, session);
    revokeSessionAdmissions(session);
  }
});

test("Internal TBH requires CAD; normal FILE-only Job Work is insufficient", () => {
  const session = "tbh-internal-file-work";
  checkAdmission(session, "@cg", "mention");
  const work = createWorkRegistration({
    sessionKey: session,
    ownerType: "file",
    ownerId: "job-authoring",
    executionPath: "file",
  });
  try {
    assert.throws(() => acquireToolLease({
      tool: "job_run_direct", family: toolFamilyForInvocation("job_run_direct", { id: "tbh" }),
      sessionKey: session, executionId: work.executionId, authorityToken: work.authorityToken,
    }), /EXECUTION_PATH_MISMATCH/);
    const lease = acquireToolLease({
      tool: "job_run_direct", family: toolFamilyForInvocation("job_run_direct", { id: "mto" }),
      sessionKey: session, executionId: work.executionId, authorityToken: work.authorityToken,
    });
    assert.ok(lease);
    // Tool admission does not imply the User Job itself is executable.
    // That check still occurs inside job_run_direct (User Registry/epoch).
    return runWithToolLease(lease, async () => {}).finally(() => {
      releaseWorkRegistration(work.executionId, work.authorityToken, session);
      revokeSessionAdmissions(session);
    });
  } catch (error) {
    releaseWorkRegistration(work.executionId, work.authorityToken, session);
    revokeSessionAdmissions(session);
    throw error;
  }
});

test("HYBRID Job work admits both verified Internal TBH and ordinary Job authoring", async () => {
  const session = "tbh-internal-hybrid-work";
  checkAdmission(session, "@cg", "mention");
  const work = createWorkRegistration({
    sessionKey: session,
    ownerType: "job",
    ownerId: "some-job",
    executionPath: "hybrid",
  });
  try {
    for (const id of ["tbh", "custom-job"]) {
      const lease = acquireToolLease({
        tool: "job_run_direct", family: toolFamilyForInvocation("job_run_direct", { id }),
        sessionKey: session, executionId: work.executionId, authorityToken: work.authorityToken,
      });
      await runWithToolLease(lease, async () => {});
    }
  } finally {
    releaseWorkRegistration(work.executionId, work.authorityToken, session);
    revokeSessionAdmissions(session);
  }
});
