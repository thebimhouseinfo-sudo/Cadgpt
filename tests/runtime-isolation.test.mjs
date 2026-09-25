import test from "node:test";
import assert from "node:assert/strict";

test("CadGPT launch claims the MCP session without creating execution authority", async () => {
  const {
    checkAdmission,
    assertSessionClaimed,
    revokeSessionAdmissions,
    isSessionClaimed,
  } = await import("../dist/cadgpt/lib/admission.js");

  const inactive = checkAdmission("session-a", "Please edit this AutoCAD drawing");
  assert.equal(inactive.mode, "inactive");
  assert.equal(inactive.claimed, false);
  assert.throws(
    () => assertSessionClaimed("session-a"),
    /CADGPT_SESSION_REQUIRED/
  );

  const bareMention = checkAdmission("session-a", "@cadgpt", "mention");
  assert.equal(bareMention.mode, "active");
  assert.equal(bareMention.reason, "explicit_cadgpt");
  assert.equal(isSessionClaimed("session-a"), true);
  const cgAlias = checkAdmission("session-cg-alias", "@cg", "mention");
  assert.equal(cgAlias.mode, "active");
  assert.equal(cgAlias.reason, "explicit_cadgpt");
  assert.equal(isSessionClaimed("session-cg-alias"), true);

  const continuation = checkAdmission(
    "session-a",
    "drawing nào đang mở",
    "mention"
  );
  assert.equal(continuation.mode, "active");
  assert.equal(continuation.reason, "session_continuation");
  assert.doesNotThrow(() => assertSessionClaimed("session-a"));

  const plugin = checkAdmission("session-plugin", "CG", "plugin");
  assert.equal(plugin.mode, "active");
  assert.equal(plugin.reason, "explicit_cadgpt_plugin");
  assert.equal(isSessionClaimed("session-plugin"), true);

  revokeSessionAdmissions("session-plugin");
  assert.equal(isSessionClaimed("session-plugin"), false);
  assert.throws(
    () => assertSessionClaimed("session-plugin"),
    /CADGPT_SESSION_REQUIRED/
  );
});

test("headerless recovery accepts only cadgpt_cad_confirm with an explicit token", async () => {
  const { extractHeaderlessCadConfirmToken } = await import(
    "../dist/cadgpt/lib/headerless-recovery.js"
  );

  assert.equal(
    extractHeaderlessCadConfirmToken({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "cadgpt_cad_confirm",
        arguments: { confirmation_token: "token-a", choice_key: "1" },
      },
    }),
    "token-a"
  );
  assert.equal(
    extractHeaderlessCadConfirmToken({
      method: "tools/call",
      params: {
        name: "cadgpt_work_start",
        arguments: { confirmation_token: "token-a" },
      },
    }),
    undefined
  );
  assert.equal(
    extractHeaderlessCadConfirmToken({
      method: "notifications/initialized",
      confirmation_token: "token-a",
    }),
    undefined
  );
});

test("CAD prepare capability is session-bound, replaceable, single-use, and transactional", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-prepare-"));
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const {
    checkAdmission,
    revokeSessionAdmissions,
  } = await import("../dist/cadgpt/lib/admission.js");
  const {
    prepareCadLaunch,
    resolveCadPrepareSessionByToken,
    registerCadPrepareConfirmTool,
    clearCadPrepare,
  } = await import("../dist/cadgpt/tools/cad-launcher.js");

  try {
    const stateDir = path.join(tempRoot, "state");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, "tray-ready.json"),
      JSON.stringify({
        autocad_running: true,
        autocad_attached: true,
        autocad_drawing_count: 1,
        autocad_drawings: [
          { name: "Drawing1.dwg", full_name: "C:\\Drawing1.dwg" },
        ],
        autocad_probe_at: new Date().toISOString(),
      }),
      "utf8"
    );

    checkAdmission("prepare-session-a", "@cadgpt", "mention");
    checkAdmission("prepare-session-b", "@cadgpt", "mention");

    const launchA1 = await prepareCadLaunch("prepare-session-a");
    const launchB = await prepareCadLaunch("prepare-session-b");
    assert.ok(launchA1.confirmation_token);
    assert.ok(launchB.confirmation_token);
    assert.notEqual(launchA1.confirmation_token, launchB.confirmation_token);
    assert.equal(
      resolveCadPrepareSessionByToken(launchA1.confirmation_token),
      "prepare-session-a"
    );
    assert.equal(
      resolveCadPrepareSessionByToken(launchB.confirmation_token),
      "prepare-session-b"
    );

    const launchA2 = await prepareCadLaunch("prepare-session-a");
    assert.ok(launchA2.confirmation_token);
    assert.notEqual(launchA2.confirmation_token, launchA1.confirmation_token);
    assert.equal(
      resolveCadPrepareSessionByToken(launchA1.confirmation_token),
      undefined
    );
    assert.equal(
      resolveCadPrepareSessionByToken(launchA2.confirmation_token),
      "prepare-session-a"
    );

    let callback;
    const fakeServer = {
      registerTool(name, _config, registered) {
        assert.equal(name, "cadgpt_cad_confirm");
        callback = registered;
      },
    };

    registerCadPrepareConfirmTool(fakeServer, {
      sessionKey: "prepare-session-a",
      activateWorkspace: async (drawing) => ({
        text: "CadGPT / CG — Workspace Ready",
        work_handle: { execution_id: "exec-a", authority_token: "authority-a" },
        drawing,
      }),
    });

    await assert.rejects(
      () =>
        callback({
          confirmation_token: launchB.confirmation_token,
          choice_key: "1",
        }),
      /CAD_PREPARE_REQUIRED/
    );

    const ready = await callback({
      confirmation_token: launchA2.confirmation_token,
      choice_key: "1",
    });
    assert.match(ready.structuredContent.text, /Workspace Ready/);
    assert.equal(
      resolveCadPrepareSessionByToken(launchA2.confirmation_token),
      undefined
    );
    await assert.rejects(
      () =>
        callback({
          confirmation_token: launchA2.confirmation_token,
          choice_key: "1",
        }),
      /CAD_PREPARE_REQUIRED/
    );

    const retryLaunch = await prepareCadLaunch("prepare-session-a");
    assert.ok(retryLaunch.confirmation_token);
    let attempts = 0;
    let retryCallback;
    const retryServer = {
      registerTool(_name, _config, registered) {
        retryCallback = registered;
      },
    };
    registerCadPrepareConfirmTool(retryServer, {
      sessionKey: "prepare-session-a",
      activateWorkspace: async (drawing) => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary activation failure");
        return {
          text: "CadGPT / CG — Workspace Ready",
          work_handle: {
            execution_id: "exec-retry",
            authority_token: "authority-retry",
          },
          drawing,
        };
      },
    });

    await assert.rejects(
      () =>
        retryCallback({
          confirmation_token: retryLaunch.confirmation_token,
          choice_key: "1",
        }),
      /temporary activation failure/
    );
    assert.equal(
      resolveCadPrepareSessionByToken(retryLaunch.confirmation_token),
      "prepare-session-a"
    );

    const retried = await retryCallback({
      confirmation_token: retryLaunch.confirmation_token,
      choice_key: "1",
    });
    assert.match(retried.structuredContent.text, /Workspace Ready/);
    assert.equal(
      resolveCadPrepareSessionByToken(retryLaunch.confirmation_token),
      undefined
    );
  } finally {
    clearCadPrepare("prepare-session-a");
    clearCadPrepare("prepare-session-b");
    revokeSessionAdmissions("prepare-session-a");
    revokeSessionAdmissions("prepare-session-b");
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("MCP transport recovery preserves session claim and work handle for the same logical session", async () => {
  const { checkAdmission, assertSessionClaimed } = await import(
    "../dist/cadgpt/lib/admission.js"
  );
  const {
    createWorkRegistration,
    validateWorkHandle,
  } = await import("../dist/cadgpt/lib/work-registration.js");
  const {
    createMcpServer,
    disposeMcpServerRuntime,
  } = await import("../dist/cadgpt/server-factory.js");

  const sessionId = "mcp-recovery-authority";
  const serverA = createMcpServer(sessionId);

  const admission = checkAdmission(sessionId, "CG", "plugin");
  assert.equal(admission.mode, "active");

  const work = createWorkRegistration({
    sessionKey: sessionId,
    ownerType: "file",
    ownerId: "recovery-test",
    executionPath: "file",
  });

  await disposeMcpServerRuntime(serverA, { preserveSessionState: true });

  const serverB = createMcpServer(sessionId);
  assert.doesNotThrow(() => assertSessionClaimed(sessionId));
  assert.doesNotThrow(() =>
    validateWorkHandle(work.executionId, work.authorityToken, sessionId)
  );

  await disposeMcpServerRuntime(serverB);

  assert.throws(
    () => assertSessionClaimed(sessionId),
    /CADGPT_SESSION_REQUIRED/
  );
  assert.throws(
    () => validateWorkHandle(work.executionId, work.authorityToken, sessionId),
    /NO_ACTIVE_WORK/
  );
});

test("CadGPT welcome exposes the lightweight fake CLI control surface", async () => {
  const { CADGPT_WELCOME, CADGPT_ROOT_MENU, isBareCadGptLaunch } = await import(
    "../dist/cadgpt/lib/quickstart.js"
  );

  assert.equal(isBareCadGptLaunch("CG"), true);
  assert.equal(isBareCadGptLaunch("@cadgpt"), true);
  assert.equal(isBareCadGptLaunch("@cg"), true);
  assert.equal(
    isBareCadGptLaunch("[$cg](app://asdk_app_6ab535cdbd948191afeacf6b0ad5b863)", "plugin"),
    true
  );
  assert.equal(
    isBareCadGptLaunch("[$CadGPT](app://asdk_app_example)", "plugin"),
    true
  );
  assert.equal(
    isBareCadGptLaunch("[$cg](app://asdk_app_example) draw a line", "plugin"),
    false
  );
  assert.equal(
    isBareCadGptLaunch("[CG](app://asdk_app_example)", "plugin"),
    true
  );
  assert.equal(
    isBareCadGptLaunch("[Renamed Connector](app://asdk_app_example)", "plugin"),
    true
  );
  assert.equal(
    isBareCadGptLaunch("[Renamed Connector](app://asdk_app_example)", "mention"),
    false
  );
  assert.equal(
    isBareCadGptLaunch("\uFFFC[Renamed Connector](app://asdk_app_example)\u200B", "plugin"),
    true
  );
  assert.equal(
    isBareCadGptLaunch("$cg", "plugin"),
    true
  );

  assert.match(CADGPT_WELCOME, /CadGPT \/ CG/);
  assert.match(CADGPT_WELCOME, /CAD/);
  assert.match(CADGPT_WELCOME, /WORKSPACE/);
  assert.match(CADGPT_WELCOME, /COMMANDS/);
  assert.match(CADGPT_WELCOME, /cg\/cl/);
  assert.match(CADGPT_WELCOME, /cg\/cj/);
  assert.match(CADGPT_WELCOME, /cg\/job/);
  assert.match(CADGPT_WELCOME, /cg\//);
  assert.doesNotMatch(CADGPT_WELCOME, /cg\/mcp/);
  assert.match(CADGPT_ROOT_MENU, /cg\/mcp/);
  assert.match(CADGPT_ROOT_MENU, /cg\/help/);
  assert.match(CADGPT_ROOT_MENU, /cg\/list/);
});

test("tray JSON parser tolerates Windows PowerShell UTF-8 BOM", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-bom-"));
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  try {
    const stateDir = path.join(tempRoot, "state");
    await fs.mkdir(stateDir, { recursive: true });
    const statePath = path.join(stateDir, "tray-ready.json");
    const payload = {
      autocad_running: true,
      autocad_attached: true,
      autocad_drawing_count: 1,
      autocad_drawings: [{ name: "Test.dwg", full_name: "C:\\Test.dwg" }],
      autocad_probe_at: new Date().toISOString()
    };
    await fs.writeFile(statePath, "\uFEFF" + JSON.stringify(payload), "utf8");

    const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
    checkAdmission("bom-session", "@cadgpt", "mention");

    const modUrl = pathToFileURL(
      path.resolve("dist/cadgpt/tools/cad-launcher.js")
    ).href + `?bom=${Date.now()}`;
    const { prepareCadLaunch } = await import(modUrl);
    const launch = await prepareCadLaunch("bom-session");

    assert.equal(launch.autocad_detected, true);
    assert.equal(launch.mode, "cad_prepare");
    assert.equal(launch.drawings?.length, 1);
    assert.match(launch.welcome_text, /Test\.dwg/);
    assert.doesNotMatch(launch.welcome_text, /OPEN DRAWINGS/);
    assert.doesNotMatch(launch.welcome_text, /\nOnline\n/);
    assert.match(launch.welcome_text, /CAD\n1\. C:\\Test\.dwg/);
  } finally {
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});


test("work registrations and tool leases remain isolated across sessions", async () => {
  const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
  const {
    createWorkRegistration,
    acquireToolLease,
    runWithToolLease,
    releaseWorkRegistration,
  } = await import("../dist/cadgpt/lib/work-registration.js");

  const admissionA = checkAdmission("lease-session-a", "@cadgpt do file work");
  const admissionB = checkAdmission("lease-session-b", "@cadgpt do file work");
  const workA = createWorkRegistration({
    sessionKey: "lease-session-a",
    ownerType: "skill",
    ownerId: "write-lisp",
    executionPath: "file",
  });
  const workB = createWorkRegistration({
    sessionKey: "lease-session-b",
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
    sessionKey: "lease-session-a",
  });
  const leaseB = acquireToolLease({
    tool: "file_edit",
    family: "filesystem",
    targetId: "same-draft",
    executionId: workB.executionId,
    authorityToken: workB.authorityToken,
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
        sessionKey: "lease-session-b",
      }),
    /another ChatGPT session|NO_ACTIVE_WORK/
  );

  await runWithToolLease(leaseA, async () => undefined);
  await runWithToolLease(leaseB, async () => undefined);

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
    assert.throws(
      () =>
        createWorkRegistration({
          sessionKey: "production-session",
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


test("session continuation and control routing do not rotate the active work handle", async () => {
  const { checkAdmission } = await import(
    "../dist/cadgpt/lib/admission.js"
  );
  const {
    createWorkRegistration,
    acquireToolLease,
    runWithToolLease,
    activeToolLeaseCount,
    releaseWorkRegistration,
  } = await import("../dist/cadgpt/lib/work-registration.js");

  const sessionKey = "continuation-session";
  const first = checkAdmission(sessionKey, "@cadgpt start file work");
  assert.equal(first.mode, "active");

  const work = createWorkRegistration({
    sessionKey,
    ownerType: "skill",
    ownerId: "write-lisp",
    executionPath: "file",
  });

  const continuation = checkAdmission(sessionKey, "continue file work");
  assert.equal(continuation.mode, "active");
  assert.equal(continuation.reason, "session_continuation");

  const lease = acquireToolLease({
    tool: "file_read",
    family: "filesystem",
    targetId: "same-target",
    executionId: work.executionId,
    authorityToken: work.authorityToken,
    sessionKey,
  });
  assert.equal(activeToolLeaseCount(), 1);
  await runWithToolLease(lease, async () => undefined);
  assert.equal(activeToolLeaseCount(), 0);

  const activationWithTask = checkAdmission(sessionKey, "@cadgpt status");
  assert.equal(activationWithTask.mode, "active");

  const control = checkAdmission(sessionKey, "cg/help");
  assert.equal(control.mode, "control");

  const leaseAfterControl = acquireToolLease({
    tool: "file_read",
    family: "filesystem",
    targetId: "same-target",
    executionId: work.executionId,
    authorityToken: work.authorityToken,
    sessionKey,
  });
  await runWithToolLease(leaseAfterControl, async () => undefined);

  releaseWorkRegistration(
    work.executionId,
    work.authorityToken,
    sessionKey
  );
});

test("CAD candidate reservation is exclusive to its execution without starting CAD", async () => {
  const previous = process.env.CADGPT_BUILD_PROFILE;
  process.env.CADGPT_BUILD_PROFILE = "development";

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

  let workA;
  let workB;
  try {
    const admissionA = checkAdmission("candidate-a", "@cadgpt improve CAD MCP");
    workA = createWorkRegistration({
      sessionKey: "candidate-a",
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
    workB = createWorkRegistration({
      sessionKey: "candidate-b",
      ownerType: "job",
      ownerId: "job-b",
      executionPath: "cad",
    });
    assert.throws(
      () => assertCadCandidateAccess(workB.executionId),
      /CAD_CANDIDATE_RESERVED/
    );
  } finally {
    if (workA) await abortCadCandidate(workA.executionId).catch(() => undefined);
    if (workA) {
      releaseWorkRegistration(workA.executionId, workA.authorityToken, "candidate-a");
    }
    if (workB) {
      releaseWorkRegistration(workB.executionId, workB.authorityToken, "candidate-b");
    }
    if (previous === undefined) delete process.env.CADGPT_BUILD_PROFILE;
    else process.env.CADGPT_BUILD_PROFILE = previous;
  }
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
    const workA = createWorkRegistration({
      sessionKey: "dev-owner-a",
      ownerType: "skill",
      ownerId: "cad-mcp-dev",
      executionPath: "file",
    });

    assert.throws(
      () =>
        createWorkRegistration({
          sessionKey: "dev-owner-b",
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
  await assert.rejects(
    acceptCadCandidate(owner, "cad__cad_list_layers"),
    /CAD_CANDIDATE_MANIFEST_NOT_VERIFIED/
  );

  recordCadCandidateSuccess(owner, "cad_refresh_tools");
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
  const work = createWorkRegistration({
    sessionKey,
    ownerType: "file",
    ownerId: "busy-test",
    executionPath: "file",
  });

  const lease = acquireToolLease({
    tool: "file_read",
    family: "filesystem",
    executionId: work.executionId,
    authorityToken: work.authorityToken,
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
    const work = createWorkRegistration({
      sessionKey,
      ownerType: "skill",
      ownerId: "cad-mcp-dev",
      executionPath: "file",
    });

    const first = acquireToolLease({
      tool: "cad_mcp_dev_read",
      family: "cad-mcp-dev",
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });

    assert.throws(
      () =>
        acquireToolLease({
          tool: "cad_mcp_dev_search",
          family: "cad-mcp-dev",
          executionId: work.executionId,
          authorityToken: work.authorityToken,
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


test("ToolLease family authority survives lazy tool registration across work replacement", async () => {
  const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
  const {
    createWorkRegistration,
    acquireToolLease,
    releaseWorkRegistration,
  } = await import("../dist/cadgpt/lib/work-registration.js");

  const fileSession = "path-authority-file";
  const fileAdmission = checkAdmission(
    fileSession,
    "@cadgpt do file-only work"
  );
  const fileWork = createWorkRegistration({
    sessionKey: fileSession,
    ownerType: "file",
    ownerId: "file-only",
    executionPath: "file",
  });

  assert.throws(
    () =>
      acquireToolLease({
        tool: "drawing_list",
        family: "cad",
        executionId: fileWork.executionId,
        authorityToken: fileWork.authorityToken,
        sessionKey: fileSession,
      }),
    /EXECUTION_PATH_MISMATCH/
  );

  releaseWorkRegistration(
    fileWork.executionId,
    fileWork.authorityToken,
    fileSession
  );

  const cadSession = "path-authority-cad";
  const cadAdmission = checkAdmission(
    cadSession,
    "@cadgpt do cad-only work"
  );
  const cadWork = createWorkRegistration({
    sessionKey: cadSession,
    ownerType: "direct-cad",
    ownerId: "cad-only",
    executionPath: "cad",
  });

  assert.throws(
    () =>
      acquireToolLease({
        tool: "file_read",
        family: "filesystem",
        executionId: cadWork.executionId,
        authorityToken: cadWork.authorityToken,
        sessionKey: cadSession,
      }),
    /EXECUTION_PATH_MISMATCH/
  );

  releaseWorkRegistration(
    cadWork.executionId,
    cadWork.authorityToken,
    cadSession
  );
});


test("admission does not mistake email/identifier text for @cadgpt invocation", async () => {
  const { checkAdmission } = await import(
    "../dist/cadgpt/lib/admission.js"
  );

  assert.equal(
    checkAdmission("mention-boundary-email", "send this to foo@cadgpt.com").mode,
    "inactive"
  );
  assert.equal(
    checkAdmission("mention-boundary-identifier", "prefix_@cadgpt should not invoke").mode,
    "inactive"
  );
  assert.equal(
    checkAdmission("mention-boundary-valid", "please use @cadgpt for this").mode,
    "active"
  );
});


test("cad-mcp-dev reserved owner id cannot be reached through sanitized aliases", async () => {
  const previous = process.env.CADGPT_BUILD_PROFILE;
  process.env.CADGPT_BUILD_PROFILE = "development";
  try {
    const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
    const { createWorkRegistration } = await import(
      "../dist/cadgpt/lib/work-registration.js"
    );
    const admission = checkAdmission(
      "reserved-dev-alias",
      "@cadgpt improve CAD MCP"
    );
    assert.throws(
      () =>
        createWorkRegistration({
          sessionKey: "reserved-dev-alias",
          ownerType: "skill",
          ownerId: "cad mcp dev",
          executionPath: "file",
        }),
      /RESERVED_OWNER_ID/
    );

    assert.throws(
      () =>
        createWorkRegistration({
          sessionKey: "reserved-dev-alias",
          ownerType: "file",
          ownerId: "cad-mcp-dev",
          executionPath: "file",
        }),
      /CAD_MCP_DEV_OWNER_TYPE/
    );
  } finally {
    if (previous === undefined) delete process.env.CADGPT_BUILD_PROFILE;
    else process.env.CADGPT_BUILD_PROFILE = previous;
  }
});


test("work idle timeout defaults to 30 minutes", async () => {
  const { getWorkIdleTimeoutMs } = await import(
    "../dist/cadgpt/lib/work-registration.js"
  );
  assert.equal(getWorkIdleTimeoutMs(), 30 * 60 * 1000);
});
