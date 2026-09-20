import test from "node:test";
import assert from "node:assert/strict";

test("admission requires literal @cadgpt in the exact current turn", async () => {
  const { checkAdmission, validateAdmissionToken } = await import(
    "../dist/cadgpt/lib/admission.js"
  );

  const inactive = checkAdmission("session-a", "Please edit this AutoCAD drawing");
  assert.equal(inactive.mode, "inactive");
  assert.equal(inactive.claimed, false);
  assert.equal(inactive.admission_token, undefined);

  const active = checkAdmission("session-a", "@cadgpt edit this AutoCAD drawing");
  assert.equal(active.mode, "active");
  assert.ok(active.admission_token);
  assert.doesNotThrow(() =>
    validateAdmissionToken(active.admission_token, "session-a")
  );
  assert.throws(
    () => validateAdmissionToken(active.admission_token, "session-b"),
    /another ChatGPT session/
  );
});

test("work registrations and tool leases remain isolated across sessions", async () => {
  const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
  const {
    createWorkRegistration,
    acquireToolLease,
    releaseWorkRegistration,
  } = await import("../dist/cadgpt/lib/work-registration.js");

  const admissionA = checkAdmission("lease-session-a", "@cadgpt do file work");
  const admissionB = checkAdmission("lease-session-b", "@cadgpt do file work");
  assert.ok(admissionA.admission_token);
  assert.ok(admissionB.admission_token);

  const workA = createWorkRegistration({
    sessionKey: "lease-session-a",
    admissionToken: admissionA.admission_token,
    ownerType: "skill",
    ownerId: "write-lisp",
    executionPath: "file",
  });
  const workB = createWorkRegistration({
    sessionKey: "lease-session-b",
    admissionToken: admissionB.admission_token,
    ownerType: "skill",
    ownerId: "write-lisp",
    executionPath: "file",
  });

  assert.notEqual(workA.executionId, workB.executionId);
  assert.notEqual(workA.authorityToken, workB.authorityToken);

  const leaseA = acquireToolLease({
    tool: "file_edit",
    family: "filesystem",
    targetId: "same-draft",
    executionId: workA.executionId,
    authorityToken: workA.authorityToken,
    admissionToken: admissionA.admission_token,
    sessionKey: "lease-session-a",
  });
  const leaseB = acquireToolLease({
    tool: "file_edit",
    family: "filesystem",
    targetId: "same-draft",
    executionId: workB.executionId,
    authorityToken: workB.authorityToken,
    admissionToken: admissionB.admission_token,
    sessionKey: "lease-session-b",
  });

  assert.notEqual(leaseA.leaseId, leaseB.leaseId);
  assert.equal(leaseA.workId, workA.executionId);
  assert.equal(leaseB.workId, workB.executionId);

  assert.throws(
    () =>
      acquireToolLease({
        tool: "file_edit",
        family: "filesystem",
        executionId: workA.executionId,
        authorityToken: workA.authorityToken,
        admissionToken: admissionA.admission_token,
        sessionKey: "lease-session-b",
      }),
    /another ChatGPT session|NO_ACTIVE_WORK/
  );

  releaseWorkRegistration(
    workA.executionId,
    workA.authorityToken,
    "lease-session-a"
  );
  releaseWorkRegistration(
    workB.executionId,
    workB.authorityToken,
    "lease-session-b"
  );
});

test("CAD host scheduler serializes calls on the same host", async () => {
  const { withCadHostLock } = await import(
    "../dist/cadgpt/runtime/cad-scheduler.js"
  );
  const events = [];

  const first = withCadHostLock("acad-host-1", async () => {
    events.push("a:start");
    await new Promise((resolve) => setTimeout(resolve, 40));
    events.push("a:end");
  });
  const second = withCadHostLock("acad-host-1", async () => {
    events.push("b:start");
    events.push("b:end");
  });

  await Promise.all([first, second]);
  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
});

test("production profile blocks cad-mcp-dev work registration", async () => {
  const previous = process.env.CADGPT_BUILD_PROFILE;
  process.env.CADGPT_BUILD_PROFILE = "production";
  try {
    const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
    const { createWorkRegistration } = await import(
      "../dist/cadgpt/lib/work-registration.js"
    );
    const admission = checkAdmission(
      "production-session",
      "@cadgpt improve CAD MCP"
    );
    assert.ok(admission.admission_token);
    assert.throws(
      () =>
        createWorkRegistration({
          sessionKey: "production-session",
          admissionToken: admission.admission_token,
          ownerType: "skill",
          ownerId: "cad-mcp-dev",
          executionPath: "file",
        }),
      /DEVELOPMENT_ONLY/
    );
  } finally {
    if (previous === undefined) delete process.env.CADGPT_BUILD_PROFILE;
    else process.env.CADGPT_BUILD_PROFILE = previous;
  }
});


test("a new current-turn admission rotates old authority and CONTROL cannot execute work", async () => {
  const { checkAdmission, validateAdmissionToken } = await import(
    "../dist/cadgpt/lib/admission.js"
  );
  const {
    createWorkRegistration,
    acquireToolLease,
    runWithToolLease,
    activeToolLeaseCount,
    releaseWorkRegistration,
  } = await import("../dist/cadgpt/lib/work-registration.js");

  const first = checkAdmission("rotation-session", "@cadgpt start file work");
  assert.equal(first.mode, "active");
  assert.ok(first.admission_token);

  const work = createWorkRegistration({
    sessionKey: "rotation-session",
    admissionToken: first.admission_token,
    ownerType: "skill",
    ownerId: "write-lisp",
    executionPath: "file",
  });

  const second = checkAdmission("rotation-session", "@cadgpt continue file work");
  assert.equal(second.mode, "active");
  assert.ok(second.admission_token);
  assert.throws(
    () => validateAdmissionToken(first.admission_token, "rotation-session"),
    /ADMISSION_REQUIRED/
  );

  const lease = acquireToolLease({
    tool: "file_read",
    family: "filesystem",
    targetId: "same-target",
    executionId: work.executionId,
    authorityToken: work.authorityToken,
    admissionToken: second.admission_token,
    sessionKey: "rotation-session",
  });
  assert.equal(activeToolLeaseCount(), 1);
  await runWithToolLease(lease, async () => {
    assert.equal(activeToolLeaseCount(), 1);
  });
  assert.equal(activeToolLeaseCount(), 0);

  const control = checkAdmission("rotation-session", "@cadgpt status");
  assert.equal(control.mode, "control");
  assert.ok(control.admission_token);
  assert.doesNotThrow(() =>
    validateAdmissionToken(control.admission_token, "rotation-session", "control_or_active")
  );
  assert.throws(
    () => validateAdmissionToken(control.admission_token, "rotation-session"),
    /ACTIVE_ADMISSION_REQUIRED/
  );

  assert.throws(
    () =>
      acquireToolLease({
        tool: "file_read",
        family: "filesystem",
        executionId: work.executionId,
        authorityToken: work.authorityToken,
        admissionToken: control.admission_token,
        sessionKey: "rotation-session",
      }),
    /ACTIVE_ADMISSION_REQUIRED/
  );

  const inactive = checkAdmission("rotation-session", "continue without invoking provider");
  assert.equal(inactive.mode, "inactive");
  assert.throws(
    () => validateAdmissionToken(control.admission_token, "rotation-session", "control_or_active"),
    /ADMISSION_REQUIRED/
  );

  releaseWorkRegistration(
    work.executionId,
    work.authorityToken,
    "rotation-session"
  );
});

test("CAD candidate reservation is exclusive to its execution without starting CAD", async () => {
  const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
  const {
    createWorkRegistration,
    releaseWorkRegistration,
  } = await import("../dist/cadgpt/lib/work-registration.js");
  const {
    beginCadCandidate,
    assertCadCandidateAccess,
    abortCadCandidate,
  } = await import("../dist/cadgpt/runtime/cad-candidate.js");

  const admissionA = checkAdmission("candidate-a", "@cadgpt improve CAD MCP");
  assert.ok(admissionA.admission_token);
  const workA = createWorkRegistration({
    sessionKey: "candidate-a",
    admissionToken: admissionA.admission_token,
    ownerType: "skill",
    ownerId: "cad-mcp-dev",
    executionPath: "hybrid",
  });

  const candidate = await beginCadCandidate({
    ownerExecutionId: workA.executionId,
    snapshotId: "snapshot-test",
    sourceFingerprint: "fingerprint-test",
  });
  assert.equal(candidate.ownerExecutionId, workA.executionId);
  assert.doesNotThrow(() => assertCadCandidateAccess(workA.executionId));

  const admissionB = checkAdmission("candidate-b", "@cadgpt run another CAD job");
  assert.ok(admissionB.admission_token);
  const workB = createWorkRegistration({
    sessionKey: "candidate-b",
    admissionToken: admissionB.admission_token,
    ownerType: "job",
    ownerId: "job-b",
    executionPath: "cad",
  });
  assert.throws(
    () => assertCadCandidateAccess(workB.executionId),
    /CAD_CANDIDATE_RESERVED/
  );

  await abortCadCandidate(workA.executionId);
  releaseWorkRegistration(workA.executionId, workA.authorityToken, "candidate-a");
  releaseWorkRegistration(workB.executionId, workB.authorityToken, "candidate-b");
});


test("cad-mcp-dev source tree admits only one active dev execution", async () => {
  const previous = process.env.CADGPT_BUILD_PROFILE;
  process.env.CADGPT_BUILD_PROFILE = "development";
  try {
    const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
    const {
      createWorkRegistration,
      releaseWorkRegistration,
    } = await import("../dist/cadgpt/lib/work-registration.js");

    const a = checkAdmission("dev-owner-a", "@cadgpt improve CAD MCP");
    const b = checkAdmission("dev-owner-b", "@cadgpt improve CAD MCP");
    assert.ok(a.admission_token);
    assert.ok(b.admission_token);

    const workA = createWorkRegistration({
      sessionKey: "dev-owner-a",
      admissionToken: a.admission_token,
      ownerType: "skill",
      ownerId: "cad-mcp-dev",
      executionPath: "file",
    });

    assert.throws(
      () =>
        createWorkRegistration({
          sessionKey: "dev-owner-b",
          admissionToken: b.admission_token,
          ownerType: "skill",
          ownerId: "cad-mcp-dev",
          executionPath: "file",
        }),
      /CAD_MCP_DEV_BUSY/
    );

    releaseWorkRegistration(
      workA.executionId,
      workA.authorityToken,
      "dev-owner-a"
    );
  } finally {
    if (previous === undefined) delete process.env.CADGPT_BUILD_PROFILE;
    else process.env.CADGPT_BUILD_PROFILE = previous;
  }
});


test("cad-mcp-dev is fail-closed unless build profile is explicitly development", async () => {
  const previous = process.env.CADGPT_BUILD_PROFILE;
  try {
    delete process.env.CADGPT_BUILD_PROFILE;
    const { isDevelopmentBuild } = await import(
      "../dist/cadgpt/lib/work-registration.js"
    );
    assert.equal(isDevelopmentBuild(), false);

    process.env.CADGPT_BUILD_PROFILE = "typo";
    assert.equal(isDevelopmentBuild(), false);

    process.env.CADGPT_BUILD_PROFILE = "development";
    assert.equal(isDevelopmentBuild(), true);
  } finally {
    if (previous === undefined) delete process.env.CADGPT_BUILD_PROFILE;
    else process.env.CADGPT_BUILD_PROFILE = previous;
  }
});

test("candidate acceptance requires a successful tool from the same generation", async () => {
  const {
    beginCadCandidate,
    recordCadCandidateSuccess,
    acceptCadCandidate,
    abortCadCandidate,
  } = await import("../dist/cadgpt/runtime/cad-candidate.js");

  const owner = "exec:test-candidate-evidence";
  const candidate = await beginCadCandidate({
    ownerExecutionId: owner,
    snapshotId: "snapshot-evidence",
    sourceFingerprint: "fingerprint-evidence",
  });

  await assert.rejects(
    acceptCadCandidate(owner, "cad__cad_list_layers"),
    /CAD_CANDIDATE_NOT_LIVE_VALIDATED/
  );

  recordCadCandidateSuccess(owner, "cad__cad_list_layers");
  const accepted = await acceptCadCandidate(owner, "cad__cad_list_layers");
  assert.equal(accepted.candidateId, candidate.candidateId);

  // Clean state if an assertion above changes in the future.
  await abortCadCandidate(owner).catch(() => undefined);
});

test("file mutation scheduler serializes same path and permits independent resources", async () => {
  const { withFileMutationLocks } = await import(
    "../dist/cadgpt/runtime/file-scheduler.js"
  );
  const same = [];
  const a = withFileMutationLocks(["C:/tmp/cadgpt-same.txt"], async () => {
    same.push("a:start");
    await new Promise((resolve) => setTimeout(resolve, 30));
    same.push("a:end");
  });
  const b = withFileMutationLocks(["C:/tmp/cadgpt-same.txt"], async () => {
    same.push("b:start");
    same.push("b:end");
  });
  await Promise.all([a, b]);
  assert.deepEqual(same, ["a:start", "a:end", "b:start", "b:end"]);

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let secondStarted = false;
  const first = withFileMutationLocks(["C:/tmp/cadgpt-a.txt"], async () => {
    await gate;
  });
  const second = withFileMutationLocks(["C:/tmp/cadgpt-b.txt"], async () => {
    secondStarted = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondStarted, true);
  release();
  await Promise.all([first, second]);
});


test("active ToolLease blocks explicit work replace/stop until the call finishes", async () => {
  const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
  const {
    createWorkRegistration,
    acquireToolLease,
    runWithToolLease,
    releaseWorkRegistration,
  } = await import("../dist/cadgpt/lib/work-registration.js");

  const sessionKey = "busy-work-session";
  const admission = checkAdmission(sessionKey, "@cadgpt run a long file operation");
  assert.ok(admission.admission_token);

  const work = createWorkRegistration({
    sessionKey,
    admissionToken: admission.admission_token,
    ownerType: "file",
    ownerId: "busy-test",
    executionPath: "file",
  });

  const lease = acquireToolLease({
    tool: "file_read",
    family: "filesystem",
    executionId: work.executionId,
    authorityToken: work.authorityToken,
    admissionToken: admission.admission_token,
    sessionKey,
  });

  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const running = runWithToolLease(lease, async () => {
    await gate;
  });

  assert.throws(
    () =>
      createWorkRegistration({
        sessionKey,
        admissionToken: admission.admission_token,
        ownerType: "file",
        ownerId: "replacement",
        executionPath: "file",
      }),
    /WORK_BUSY/
  );

  assert.throws(
    () =>
      releaseWorkRegistration(
        work.executionId,
        work.authorityToken,
        sessionKey
      ),
    /WORK_BUSY/
  );

  releaseGate();
  await running;

  const released = releaseWorkRegistration(
    work.executionId,
    work.authorityToken,
    sessionKey
  );
  assert.equal(released.executionId, work.executionId);
});


test("cad-mcp-dev permits only one active tool lease per source execution", async () => {
  const previous = process.env.CADGPT_BUILD_PROFILE;
  process.env.CADGPT_BUILD_PROFILE = "development";
  try {
    const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
    const {
      createWorkRegistration,
      acquireToolLease,
      runWithToolLease,
      releaseWorkRegistration,
    } = await import("../dist/cadgpt/lib/work-registration.js");

    const sessionKey = "dev-lease-serialize";
    const admission = checkAdmission(sessionKey, "@cadgpt improve CAD MCP");
    assert.ok(admission.admission_token);

    const work = createWorkRegistration({
      sessionKey,
      admissionToken: admission.admission_token,
      ownerType: "skill",
      ownerId: "cad-mcp-dev",
      executionPath: "file",
    });

    const first = acquireToolLease({
      tool: "cad_mcp_dev_read",
      family: "cad-mcp-dev",
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      admissionToken: admission.admission_token,
      sessionKey,
    });

    assert.throws(
      () =>
        acquireToolLease({
          tool: "cad_mcp_dev_search",
          family: "cad-mcp-dev",
          executionId: work.executionId,
          authorityToken: work.authorityToken,
          admissionToken: admission.admission_token,
          sessionKey,
        }),
      /CAD_MCP_DEV_BUSY/
    );

    await runWithToolLease(first, async () => undefined);
    releaseWorkRegistration(
      work.executionId,
      work.authorityToken,
      sessionKey
    );
  } finally {
    if (previous === undefined) delete process.env.CADGPT_BUILD_PROFILE;
    else process.env.CADGPT_BUILD_PROFILE = previous;
  }
});


test("dirty CAD MCP source blocks live CAD until candidate generation starts", async () => {
  const {
    beginCadDevSourceTransaction,
    assertCadDevSourceAccess,
    forceClearCadDevSourceTransaction,
  } = await import("../dist/cadgpt/runtime/cad-dev-source-transaction.js");
  const {
    beginCadCandidate,
    abortCadCandidate,
    assertCadRuntimeGenerationAccess,
  } = await import("../dist/cadgpt/runtime/cad-candidate.js");

  const owner = "exec:dev-source-owner";
  const other = "exec:unrelated-cad";

  beginCadDevSourceTransaction({
    ownerExecutionId: owner,
    snapshotId: "snapshot-source-gate",
  });

  assert.throws(
    () => assertCadDevSourceAccess(other),
    /CAD_MCP_DEV_SOURCE_RESERVED/
  );
  assert.throws(
    () => assertCadRuntimeGenerationAccess(owner),
    /CAD_CANDIDATE_REQUIRED/
  );

  const candidate = await beginCadCandidate({
    ownerExecutionId: owner,
    snapshotId: "snapshot-source-gate",
    sourceFingerprint: "candidate-source-fingerprint",
  });
  assert.equal(candidate.ownerExecutionId, owner);
  assert.doesNotThrow(() => assertCadRuntimeGenerationAccess(owner));

  await abortCadCandidate(owner);
  forceClearCadDevSourceTransaction(owner);
});
