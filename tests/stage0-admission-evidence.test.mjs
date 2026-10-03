import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-stage0-evidence-"));
process.env.CADGPT_APPDATA_ROOT = tempRoot;
process.env.CADGPT_CONTINUITY_DIAGNOSTICS = "true";

const {
  flushContinuityDiagnostics,
} = await import("../dist/cadgpt/lib/continuity-diagnostics.js");
const {
  currentContinuityRequestContext,
  logStage0EvidenceEvent,
  runSessionProbeWithEvidence,
  withContinuityRequestContext,
} = await import("../dist/cadgpt/lib/continuity-request-context.js");
const {
  logicalConversationKeyFromRequest,
} = await import("../dist/cadgpt/lib/logical-conversation.js");
const {
  assertSessionClaimed,
  isSessionClaimed,
  revokeSessionAdmissions,
} = await import("../dist/cadgpt/lib/admission.js");
const {
  registerAdmissionTool,
} = await import("../dist/cadgpt/tools/admission.js");

function request(id, session, subject = "stage0-subject") {
  return {
    method: "POST",
    headers: {
      "mcp-session-id": "transport-" + session,
      "x-openai-session": session,
      "x-openai-subject": subject,
    },
    body: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "cadgpt_admission" },
    },
  };
}

async function records() {
  await flushContinuityDiagnostics();
  const logPath = path.join(tempRoot, "logs", "continuity.ndjson");
  const raw = await fs.readFile(logPath, "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function fakeServer() {
  const callbacks = new Map();
  return {
    callbacks,
    server: {
      registerTool(name, _config, callback) {
        callbacks.set(name, callback);
      },
    },
  };
}

test.after(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("active admission emits one connector-bound completion without changing result shape", async () => {
  const req = request("admission-success", "chat-A");
  const sessionKey = logicalConversationKeyFromRequest(req);
  assert.ok(sessionKey);

  const { callbacks, server } = fakeServer();
  registerAdmissionTool(server, {
    sessionKey,
    onActive: async () => ({ launch_mode: "ready" }),
  });

  const before = (await records()).length;
  const result = await withContinuityRequestContext(req, () =>
    callbacks.get("cadgpt_admission")({
      user_turn: "@cg run a harmless check",
      invocation_source: "mention",
    })
  );
  const added = (await records()).slice(before);

  assert.equal(result.structuredContent?.ok, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.structuredContent ?? {},
      "observation_id"
    ),
    false
  );

  const completions = added.filter((item) => item.event === "admission_completed");
  assert.equal(completions.length, 1);
  assert.equal(completions[0].schema_version, 1);
  assert.equal(completions[0].connector_bound, true);
  assert.equal(completions[0].success, true);
  assert.equal(completions[0].claimed, true);
  assert.equal(completions[0].mode, "active");
  assert.ok(completions[0].observation_id);
  assert.ok(completions[0].logical_session);
  assert.ok(completions[0].transport_session);
  assert.ok(completions[0].request_id);

  revokeSessionAdmissions(sessionKey);
});

test("inactive and control admission decisions do not emit success evidence", async () => {
  const inactiveReq = request("inactive", "chat-inactive");
  const inactiveKey = logicalConversationKeyFromRequest(inactiveReq);
  const inactive = fakeServer();
  registerAdmissionTool(inactive.server, {
    sessionKey: inactiveKey,
    onActive: async () => {
      throw new Error("should not run");
    },
  });

  const before = (await records()).length;
  await withContinuityRequestContext(inactiveReq, () =>
    inactive.callbacks.get("cadgpt_admission")({
      user_turn: "hello",
      invocation_source: "mention",
    })
  );

  const controlReq = request("control", "chat-control");
  const controlKey = logicalConversationKeyFromRequest(controlReq);
  const control = fakeServer();
  registerAdmissionTool(control.server, {
    sessionKey: controlKey,
    onActive: async () => {
      throw new Error("should not run");
    },
  });
  await withContinuityRequestContext(controlReq, () =>
    control.callbacks.get("cadgpt_admission")({
      user_turn: "cg/list",
      invocation_source: "plugin",
    })
  );

  const added = (await records()).slice(before);
  assert.equal(
    added.some(
      (item) =>
        item.event === "admission_completed" ||
        item.event === "admission_failed"
    ),
    false
  );

  revokeSessionAdmissions(inactiveKey);
  revokeSessionAdmissions(controlKey);
});

test("onActive failure emits fixed-category failure and preserves original throw", async () => {
  const req = request("admission-failure", "chat-failure");
  const sessionKey = logicalConversationKeyFromRequest(req);
  const secret = "SECRET_SENTINEL_ADMISSION_EXCEPTION";
  const { callbacks, server } = fakeServer();

  registerAdmissionTool(server, {
    sessionKey,
    onActive: async () => {
      throw new Error(secret);
    },
  });

  const before = (await records()).length;
  await assert.rejects(
    withContinuityRequestContext(req, () =>
      callbacks.get("cadgpt_admission")({
        user_turn: "@cg",
        invocation_source: "mention",
      })
    ),
    new RegExp(secret)
  );
  const added = (await records()).slice(before);
  const failures = added.filter((item) => item.event === "admission_failed");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].failure_category, "ADMISSION_CALLBACK_FAILED");
  assert.equal(failures[0].connector_bound, true);
  assert.equal(JSON.stringify(failures).includes(secret), false);

  revokeSessionAdmissions(sessionKey);
});

test("interleaved request contexts remain distinct", async () => {
  const reqA = request("context-A", "chat-context-A");
  const reqB = request("context-B", "chat-context-B");

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const [a, b] = await Promise.all([
    withContinuityRequestContext(reqA, async () => {
      const first = currentContinuityRequestContext();
      await gate;
      const second = currentContinuityRequestContext();
      return {
        observation: first?.observationId,
        after: second?.observationId,
        logical: first?.logicalFingerprint,
      };
    }),
    withContinuityRequestContext(reqB, async () => {
      const value = currentContinuityRequestContext();
      release();
      return {
        observation: value?.observationId,
        logical: value?.logicalFingerprint,
      };
    }),
  ]);

  assert.equal(a.observation, a.after);
  assert.notEqual(a.observation, b.observation);
  assert.notEqual(a.logical, b.logical);
});

test("missing or mismatched connector identity cannot become connector-bound evidence", async () => {
  const missingReq = {
    method: "POST",
    headers: { "mcp-session-id": "transport-missing" },
    body: { id: "missing" },
  };
  const before = (await records()).length;
  await withContinuityRequestContext(missingReq, async () => {
    logStage0EvidenceEvent("session_probe_completed", "server-key", {
      toolName: "job_list",
      success: true,
      claimed: true,
    });
  });

  const reqA = request("mismatch", "chat-mismatch-A");
  const reqB = request("mismatch-other", "chat-mismatch-B");
  const keyB = logicalConversationKeyFromRequest(reqB);
  await withContinuityRequestContext(reqA, async () => {
    logStage0EvidenceEvent("session_probe_completed", keyB, {
      toolName: "job_list",
      success: true,
      claimed: true,
    });
  });

  const added = (await records())
    .slice(before)
    .filter((item) => item.event === "session_probe_completed");
  assert.equal(added.length, 2);
  assert.equal(added[0].connector_bound, false);
  assert.equal(added[0].logical_session, null);
  assert.equal(added[1].connector_bound, false);
});

test("job_list probe records success only after authority and successful result", async () => {
  const req = request("probe-success", "chat-probe");
  const sessionKey = logicalConversationKeyFromRequest(req);
  const admission = fakeServer();
  registerAdmissionTool(admission.server, {
    sessionKey,
    onActive: async () => undefined,
  });
  await withContinuityRequestContext(req, () =>
    admission.callbacks.get("cadgpt_admission")({
      user_turn: "@cg probe setup",
      invocation_source: "mention",
    })
  );

  const secret = "SECRET_SENTINEL_JOB_OUTPUT";
  const before = (await records()).length;
  const result = await withContinuityRequestContext(req, () =>
    runSessionProbeWithEvidence(
      sessionKey,
      "job_list",
      () => {
        assertSessionClaimed(sessionKey);
      },
      async () => ({
        structuredContent: {
          ok: true,
          data: { hidden_fixture: secret },
        },
      })
    )
  );

  assert.equal(result.structuredContent.ok, true);
  const added = (await records()).slice(before);
  const completed = added.filter(
    (item) => item.event === "session_probe_completed"
  );
  assert.equal(completed.length, 1);
  assert.equal(completed[0].connector_bound, true);
  assert.equal(completed[0].success, true);
  assert.equal(JSON.stringify(completed).includes(secret), false);

  revokeSessionAdmissions(sessionKey);
});

test("job_list probe authority/callback/result failures remain failures and never create admission", async () => {
  const req = request("probe-failures", "chat-probe-failures");
  const sessionKey = logicalConversationKeyFromRequest(req);
  assert.equal(isSessionClaimed(sessionKey), false);

  const before = (await records()).length;
  await assert.rejects(
    withContinuityRequestContext(req, () =>
      runSessionProbeWithEvidence(
        sessionKey,
        "job_list",
        () => {
          assertSessionClaimed(sessionKey);
        },
        async () => ({ structuredContent: { ok: true } })
      )
    ),
    /CADGPT_SESSION_REQUIRED/
  );
  assert.equal(isSessionClaimed(sessionKey), false);

  const admission = fakeServer();
  registerAdmissionTool(admission.server, {
    sessionKey,
    onActive: async () => undefined,
  });
  await withContinuityRequestContext(req, () =>
    admission.callbacks.get("cadgpt_admission")({
      user_turn: "@cg setup",
      invocation_source: "mention",
    })
  );

  const callbackSecret = "SECRET_SENTINEL_PROBE_EXCEPTION";
  await assert.rejects(
    withContinuityRequestContext(req, () =>
      runSessionProbeWithEvidence(
        sessionKey,
        "job_list",
        () => {
          assertSessionClaimed(sessionKey);
        },
        async () => {
          throw new Error(callbackSecret);
        }
      )
    ),
    new RegExp(callbackSecret)
  );

  const errorResult = {
    isError: true,
    structuredContent: {
      ok: false,
      data: { error: "SECRET_SENTINEL_PROBE_RESULT" },
    },
  };
  const returned = await withContinuityRequestContext(req, () =>
    runSessionProbeWithEvidence(
      sessionKey,
      "job_list",
      () => {
        assertSessionClaimed(sessionKey);
      },
      async () => errorResult
    )
  );
  assert.equal(returned, errorResult);

  const failures = (await records())
    .slice(before)
    .filter((item) => item.event === "session_probe_failed");
  assert.equal(failures.length, 3);
  assert.deepEqual(
    failures.map((item) => item.failure_category),
    [
      "SESSION_AUTHORITY_FAILED",
      "PROBE_CALLBACK_FAILED",
      "PROBE_RESULT_FAILED",
    ]
  );
  const serialized = JSON.stringify(failures);
  assert.equal(serialized.includes(callbackSecret), false);
  assert.equal(serialized.includes("SECRET_SENTINEL_PROBE_RESULT"), false);

  revokeSessionAdmissions(sessionKey);
});
