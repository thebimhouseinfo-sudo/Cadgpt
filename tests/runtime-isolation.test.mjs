import test from "node:test";
import assert from "node:assert/strict";

test("continuity diagnostics fingerprint metadata without logging secrets or tool arguments", async () => {
  const {
    continuityFingerprint,
    continuityHeaderFingerprints,
    summarizeMcpBody,
  } = await import("../dist/cadgpt/lib/continuity-diagnostics.js");

  const headers = {
    authorization: "Bearer raw-secret",
    cookie: "session=raw-cookie",
    "x-api-key": "raw-api-key",
    "mcp-session-id": "transport-a",
    "x-openai-conversation-id": "conversation-a",
    "x-request-id": "request-a",
  };

  const fingerprints = continuityHeaderFingerprints(headers);
  assert.equal("authorization" in fingerprints, false);
  assert.equal("cookie" in fingerprints, false);
  assert.equal("x-api-key" in fingerprints, false);
  assert.equal(typeof fingerprints["mcp-session-id"], "string");
  assert.equal(typeof fingerprints["x-openai-conversation-id"], "string");
  assert.notEqual(fingerprints["x-openai-conversation-id"], "conversation-a");
  assert.equal(
    fingerprints["x-openai-conversation-id"],
    continuityFingerprint("conversation-a")
  );
  assert.notEqual(
    continuityFingerprint("conversation-a"),
    continuityFingerprint("conversation-b")
  );

  const summary = summarizeMcpBody({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "cadgpt_admission",
      arguments: {
        user_turn: "@cadgpt private user content",
        confirmation_token: "raw-confirmation-secret",
      },
    },
  });
  assert.deepEqual(summary, {
    rpc_method: "tools/call",
    tool_name: "cadgpt_admission",
  });
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /private user content/);
  assert.doesNotMatch(serialized, /raw-confirmation-secret/);
});

test("continuity diagnostics follow the current AppData root", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-continuity-root-"));
  const previous = process.env.CADGPT_APPDATA_ROOT;

  try {
    process.env.CADGPT_APPDATA_ROOT = tempRoot;
    const {
      continuityDiagnosticsPath,
      flushContinuityDiagnostics,
      logContinuityDiagnostic,
    } = await import("../dist/cadgpt/lib/continuity-diagnostics.js");

    logContinuityDiagnostic("dynamic-root-test", { marker: "ok" });
    await flushContinuityDiagnostics();

    const expected = path.join(tempRoot, "logs", "continuity.ndjson");
    assert.equal(path.resolve(continuityDiagnosticsPath()), path.resolve(expected));
    const content = await fs.readFile(expected, "utf8");
    assert.match(content, /dynamic-root-test/);
  } finally {
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

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

test("headerless recovery detects cadgpt_cad_confirm and treats token as optional", async () => {
  const {
    extractHeaderlessCadConfirmToken,
    isHeaderlessCadConfirmCall,
  } = await import("../dist/cadgpt/lib/headerless-recovery.js");

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
  const choiceOnly = {
    method: "tools/call",
    params: {
      name: "cadgpt_cad_confirm",
      arguments: { choice_key: "1" },
    },
  };
  assert.equal(isHeaderlessCadConfirmCall(choiceOnly), true);
  assert.equal(extractHeaderlessCadConfirmToken(choiceOnly), undefined);

  const unrelatedTool = {
    method: "tools/call",
    params: {
      name: "cadgpt_work_start",
      arguments: { confirmation_token: "token-a" },
    },
  };
  assert.equal(isHeaderlessCadConfirmCall(unrelatedTool), false);
  assert.equal(extractHeaderlessCadConfirmToken(unrelatedTool), undefined);
  assert.equal(
    extractHeaderlessCadConfirmToken({
      method: "notifications/initialized",
      confirmation_token: "token-a",
    }),
    undefined
  );
});

test("admission preserves auto-bound work authority in Workspace Ready response", async () => {
  const { registerAdmissionTool } = await import(
    "../dist/cadgpt/tools/admission.js"
  );
  const { revokeSessionAdmissions } = await import(
    "../dist/cadgpt/lib/admission.js"
  );

  let callback;
  const fakeServer = {
    registerTool(name, _config, registered) {
      assert.equal(name, "cadgpt_admission");
      callback = registered;
      return { remove() {} };
    },
  };

  registerAdmissionTool(fakeServer, {
    sessionKey: "admission-auto-bind",
    onActive: async () => ({
      launch_mode: "auto_bind",
      welcome_text: "CadGPT / CG — Workspace Ready",
      autocad_detected: true,
      auto_bound: true,
      drawing: { name: "Drawing1.dwg" },
      work_handle: {
        execution_id: "exec-auto",
        authority_token: "authority-auto",
      },
      cad_tools_ready: true,
      cad_proxy_tool_count: 2,
      cad_proxy_tools: ["cad__cad_list_layers", "cad__cad_list_entities"],
    }),
  });

  try {
    const result = await callback({
      user_turn: "@cg",
      invocation_source: "mention",
    });
    assert.equal(result.structuredContent?.launch_mode, "auto_bind");
    assert.equal(result.structuredContent?.auto_bound, true);
    assert.equal(
      result.structuredContent?.work_handle?.execution_id,
      "exec-auto"
    );
    assert.equal(
      result.structuredContent?.work_handle?.authority_token,
      "authority-auto"
    );
    assert.equal(result.structuredContent?.cad_tools_ready, true);
    assert.deepEqual(result.structuredContent?.cad_proxy_tools, [
      "cad__cad_list_layers",
      "cad__cad_list_entities",
    ]);
    assert.match(
      result.structuredContent?.welcome_text ?? "",
      /Workspace Ready/
    );
  } finally {
    revokeSessionAdmissions("admission-auto-bind");
  }
});

test("bare launch auto-binds only when tray reports exactly one drawing", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-single-auto-bind-")
  );
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const {
    checkAdmission,
    revokeSessionAdmissions,
  } = await import("../dist/cadgpt/lib/admission.js");
  const {
    clearCadPrepare,
    prepareCadLaunch,
  } = await import("../dist/cadgpt/tools/cad-launcher.js");

  const sessionKey = "single-auto-bind-session";
  checkAdmission(sessionKey, "@cg", "mention");

  const stateDir = path.join(tempRoot, "state");
  const statePath = path.join(stateDir, "tray-ready.json");
  await fs.mkdir(stateDir, { recursive: true });

  const writeTray = async (drawings) => {
    await fs.writeFile(
      statePath,
      JSON.stringify({
        autocad_running: true,
        autocad_attached: true,
        autocad_drawing_count: drawings.length,
        autocad_drawings: drawings,
        autocad_probe_at: new Date().toISOString(),
      }),
      "utf8"
    );
  };

  try {
    await writeTray([]);
    const zero = await prepareCadLaunch(sessionKey, {
      autoBindSingle: true,
    });
    assert.equal(zero.mode, "cad_prepare");
    assert.equal(zero.auto_bind_drawing, undefined);
    assert.match(zero.welcome_text ?? "", /Chưa có drawing/);

    await writeTray([
      { name: "Drawing1.dwg", full_name: "C:\\Drawing1.dwg" },
    ]);
    const one = await prepareCadLaunch(sessionKey, {
      autoBindSingle: true,
    });
    assert.equal(one.mode, "auto_bind");
    assert.equal(one.auto_bind_drawing?.name, "Drawing1.dwg");
    assert.equal(one.confirmation_token, undefined);
    assert.equal(one.welcome_text, undefined);

    await writeTray([
      { name: "Drawing1.dwg", full_name: "C:\\Drawing1.dwg" },
      { name: "Drawing2.dwg", full_name: "C:\\Drawing2.dwg" },
    ]);
    const many = await prepareCadLaunch(sessionKey, {
      autoBindSingle: true,
    });
    assert.equal(many.mode, "cad_prepare");
    assert.equal(many.drawings?.length, 2);
    assert.equal(typeof many.confirmation_token, "string");
    assert.match(many.welcome_text ?? "", /1\. C:\\Drawing1\.dwg/);
    assert.match(many.welcome_text ?? "", /2\. C:\\Drawing2\.dwg/);
  } finally {
    clearCadPrepare(sessionKey);
    revokeSessionAdmissions(sessionKey);
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("CAD prepare survives repeated launch and MCP session churn, while remaining single-use and transactional", async () => {
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
    assert.equal(launchA2.confirmation_token, launchA1.confirmation_token);
    assert.equal(
      resolveCadPrepareSessionByToken(launchA1.confirmation_token),
      "prepare-session-a"
    );

    let callback;
    const fakeServer = {
      registerTool(name, _config, registered) {
        assert.equal(name, "cadgpt_cad_confirm");
        callback = registered;
      },
    };

    // The transport may rotate, but the server factory now reuses the verified
    // logical conversation key. The user/model does not carry the token.
    registerCadPrepareConfirmTool(fakeServer, {
      sessionKey: "prepare-session-a",
      activateWorkspace: async (drawing) => ({
        text: "CadGPT / CG — Workspace Ready",
        work_handle: { execution_id: "exec-a", authority_token: "authority-a" },
        drawing,
      }),
    });

    const ready = await callback({
      choice_key: "Drawing1.dwg",
    });
    assert.match(ready.structuredContent.text, /Workspace Ready/);
    assert.equal(
      resolveCadPrepareSessionByToken(launchA2.confirmation_token),
      undefined
    );
    await assert.rejects(
      () =>
        callback({
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

test("production MCP router preserves CAD prepare across MCP session rotation and headerless recovery", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const express = (await import("express")).default;
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { LATEST_PROTOCOL_VERSION } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );
  const { createSessionManager } = await import(
    "../dist/cadgpt/lib/mcp-session-manager.js"
  );
  const { routeMcpPost } = await import(
    "../dist/cadgpt/lib/mcp-post-routing.js"
  );
  const {
    prepareCadLaunch,
    resolveCadPrepareSessionByToken,
    registerCadPrepareConfirmTool,
    clearCadPrepare,
  } = await import("../dist/cadgpt/tools/cad-launcher.js");
  const { registerAdmissionTool } = await import(
    "../dist/cadgpt/tools/admission.js"
  );
  const { revokeSessionAdmissions } = await import(
    "../dist/cadgpt/lib/admission.js"
  );
  const {
    createWorkRegistration,
    releaseSessionWork,
  } = await import("../dist/cadgpt/lib/work-registration.js");

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-router-"));
  const previousRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const app = express();
  app.use(express.json());
  let sessions;
  const route = "/mcp/test-token";

  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    if (httpServer.listening) return resolve();
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;

  const createServer = (sessionKey) => {
    const server = new McpServer(
      { name: "cadgpt-test", version: "0.1.0" },
      { capabilities: { tools: { listChanged: true } } }
    );

    registerAdmissionTool(server, {
      sessionKey,
      onActive: async ({ bareLaunch }) => {
        if (!bareLaunch) return;
        const launch = await prepareCadLaunch(sessionKey);
        return {
          launch_mode: launch.mode,
          welcome_text: launch.welcome_text,
          autocad_detected: launch.autocad_detected,
          ...(launch.confirmation_token
            ? { confirmation_token: launch.confirmation_token }
            : {}),
          ...(launch.drawings ? { drawings: launch.drawings } : {}),
        };
      },
    });

    registerCadPrepareConfirmTool(server, {
      sessionKey,
      activateWorkspace: async (drawing) => {
        const work = createWorkRegistration({
          sessionKey,
          ownerType: "direct-cad",
          ownerId: "integration-workspace",
          executionPath: "hybrid",
        });
        return {
          text: "CadGPT / CG — Workspace Ready",
          work_handle: {
            execution_id: work.executionId,
            authority_token: work.authorityToken,
          },
          drawing: {
            ...drawing,
            runtime_document_id: "integration-doc-1",
          },
        };
      },
    });

    return server;
  };

  sessions = createSessionManager(port, {
    createServer,
    deleteGraceMs: 10,
    cleanupMs: 10,
    sessionTtlMs: 60_000,
  });
  sessions.startCleanup();

  app.post(route, async (req, res) => {
    try {
      await routeMcpPost({
        req,
        res,
        sessions,
        sessionRecovery: true,
        resolveCadPrepareSessionByToken,
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
          id: req.body?.id ?? null,
        });
      }
    }
  });
  app.delete(route, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    const session =
      typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (!session) {
      sessions.sendNotFound(res, req.body?.id ?? null);
      return;
    }
    await sessions.handleExisting(session, req, res, req.body);
  });

  let sessionId;
  let rotatedSessionId;
  let logicalSessionKey;
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

    const url = `http://127.0.0.1:${port}${route}`;
    const baseHeaders = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const chatAHeaders = {
      ...baseHeaders,
      "x-openai-subject": "same-account",
      "x-openai-session": "chat-A",
    };

    const initialized = await fetch(url, {
      method: "POST",
      headers: chatAHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "cadgpt-integration-test", version: "0.1.0" },
        },
      }),
    });
    assert.equal(initialized.ok, true);
    sessionId = initialized.headers.get("mcp-session-id");
    assert.ok(sessionId);

    const sessionHeaders = {
      ...chatAHeaders,
      "mcp-session-id": sessionId,
      "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
    };

    const notification = await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    assert.equal(notification.ok, true);

    const admission = await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "cadgpt_admission",
          arguments: {
            user_turn: "@cadgpt",
            invocation_source: "mention",
          },
        },
      }),
    });
    assert.equal(admission.ok, true);
    const admissionBody = await admission.json();
    const token = admissionBody.result?.structuredContent?.confirmation_token;
    assert.equal(typeof token, "string");
    logicalSessionKey = sessions.get(sessionId)?.logicalSessionKey;
    assert.equal(typeof logicalSessionKey, "string");
    assert.notEqual(logicalSessionKey, sessionId);
    assert.equal(resolveCadPrepareSessionByToken(token), logicalSessionKey);

    // Simulate the connector opening a fresh MCP transport/session for the
    // next tool call while the ChatGPT conversation is still the same.
    const rotatedInit = await fetch(url, {
      method: "POST",
      headers: chatAHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 30,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "cadgpt-rotated-session", version: "0.1.0" },
        },
      }),
    });
    assert.equal(rotatedInit.ok, true);
    rotatedSessionId = rotatedInit.headers.get("mcp-session-id");
    assert.ok(rotatedSessionId);
    assert.notEqual(rotatedSessionId, sessionId);
    assert.equal(
      sessions.get(rotatedSessionId)?.logicalSessionKey,
      logicalSessionKey
    );

    const rotatedHeaders = {
      ...chatAHeaders,
      "mcp-session-id": rotatedSessionId,
      "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
    };
    const rotatedNotification = await fetch(url, {
      method: "POST",
      headers: rotatedHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    assert.equal(rotatedNotification.ok, true);

    const rotatedConfirmed = await fetch(url, {
      method: "POST",
      headers: rotatedHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "cadgpt_cad_confirm",
          arguments: {
            choice_key: "Drawing1.dwg",
          },
        },
      }),
    });
    assert.equal(rotatedConfirmed.ok, true);
    const rotatedConfirmBody = await rotatedConfirmed.json();
    assert.match(
      rotatedConfirmBody.result?.structuredContent?.text ?? "",
      /Workspace Ready/
    );
    assert.equal(resolveCadPrepareSessionByToken(token), undefined);

    // Prepare again on the rotated session, then prove the existing
    // headerless recovery path still works after that transport is detached.
    const rotatedAdmission = await fetch(url, {
      method: "POST",
      headers: rotatedHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 32,
        method: "tools/call",
        params: {
          name: "cadgpt_admission",
          arguments: {
            user_turn: "@cadgpt",
            invocation_source: "mention",
          },
        },
      }),
    });
    assert.equal(rotatedAdmission.ok, true);
    const rotatedAdmissionBody = await rotatedAdmission.json();
    const recoveryToken =
      rotatedAdmissionBody.result?.structuredContent?.confirmation_token;
    assert.equal(typeof recoveryToken, "string");
    assert.equal(resolveCadPrepareSessionByToken(recoveryToken), logicalSessionKey);

    const closed = await fetch(url, {
      method: "DELETE",
      headers: rotatedHeaders,
    });
    assert.equal(closed.ok, true);

    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(sessions.get(rotatedSessionId), undefined);
    assert.equal(resolveCadPrepareSessionByToken(recoveryToken), logicalSessionKey);

    const wrongConversation = await fetch(url, {
      method: "POST",
      headers: {
        ...chatAHeaders,
        "x-openai-session": "chat-C",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 33,
        method: "tools/call",
        params: {
          name: "cadgpt_cad_confirm",
          arguments: {
            confirmation_token: recoveryToken,
            choice_key: "1",
          },
        },
      }),
    });
    assert.equal(wrongConversation.status, 400);
    assert.equal(
      resolveCadPrepareSessionByToken(recoveryToken),
      logicalSessionKey
    );

    const wrongConversationChoiceOnly = await fetch(url, {
      method: "POST",
      headers: {
        ...chatAHeaders,
        "x-openai-session": "chat-C",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 34,
        method: "tools/call",
        params: {
          name: "cadgpt_cad_confirm",
          arguments: {
            choice_key: "1",
          },
        },
      }),
    });
    assert.equal(wrongConversationChoiceOnly.status, 400);
    assert.equal(
      resolveCadPrepareSessionByToken(recoveryToken),
      logicalSessionKey
    );

    const confirmed = await fetch(url, {
      method: "POST",
      headers: chatAHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "cadgpt_cad_confirm",
          arguments: {
            choice_key: "1",
          },
        },
      }),
    });
    assert.equal(confirmed.ok, true);
    const confirmBody = await confirmed.json();
    assert.match(
      confirmBody.result?.structuredContent?.text ?? "",
      /Workspace Ready/
    );
    assert.equal(
      confirmBody.result?.structuredContent?.drawing?.runtime_document_id,
      "integration-doc-1"
    );
    assert.equal(resolveCadPrepareSessionByToken(recoveryToken), undefined);

    const unrelated = await fetch(url, {
      method: "POST",
      headers: chatAHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "cadgpt_admission",
          arguments: {
            user_turn: "continue",
            invocation_source: "mention",
          },
        },
      }),
    });
    assert.equal(unrelated.status, 400);
    const unrelatedBody = await unrelated.json();
    assert.match(
      unrelatedBody.error?.message ?? "",
      /Mcp-Session-Id is required/
    );
  } finally {
    sessions.stopCleanup();
    await sessions.closeAll("integration test cleanup");
    if (logicalSessionKey) {
      releaseSessionWork(logicalSessionKey);
      clearCadPrepare(logicalSessionKey);
      revokeSessionAdmissions(logicalSessionKey);
    }
    await new Promise((resolve) => httpServer.close(resolve));
    if (previousRoot === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});


test("existing MCP transport rejects conflicting OpenAI conversation identity", async () => {
  const express = (await import("express")).default;
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { LATEST_PROTOCOL_VERSION } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );
  const { createSessionManager } = await import(
    "../dist/cadgpt/lib/mcp-session-manager.js"
  );
  const { routeMcpPost } = await import(
    "../dist/cadgpt/lib/mcp-post-routing.js"
  );

  const app = express();
  app.use(express.json());
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    if (httpServer.listening) return resolve();
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  const route = "/mcp/identity-conflict";

  const sessions = createSessionManager(port, {
    createServer: () =>
      new McpServer(
        { name: "cadgpt-identity-test", version: "0.1.0" },
        { capabilities: { tools: {} } }
      ),
    deleteGraceMs: 10,
    cleanupMs: 10,
    sessionTtlMs: 60_000,
  });

  app.post(route, async (req, res) => {
    await routeMcpPost({
      req,
      res,
      sessions,
      sessionRecovery: true,
      resolveCadPrepareSessionByToken: () => undefined,
    });
  });

  app.delete(route, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    const session =
      typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (!session) {
      sessions.sendNotFound(res, req.body?.id ?? null);
      return;
    }
    await sessions.handleExisting(session, req, res, req.body);
  });

  try {
    const url = `http://127.0.0.1:${port}${route}`;
    const initHeaders = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-openai-subject": "same-account",
      "x-openai-session": "chat-A",
    };
    const initialized = await fetch(url, {
      method: "POST",
      headers: initHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "cadgpt-identity-test", version: "0.1.0" },
        },
      }),
    });
    assert.equal(initialized.ok, true);
    const sessionId = initialized.headers.get("mcp-session-id");
    assert.ok(sessionId);

    const missingIdentity = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
        "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    assert.equal(missingIdentity.status, 400);

    const conflicting = await fetch(url, {
      method: "POST",
      headers: {
        ...initHeaders,
        "mcp-session-id": sessionId,
        "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
        "x-openai-session": "chat-C",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    assert.equal(conflicting.status, 400);

    const boundHeaders = {
      ...initHeaders,
      "mcp-session-id": sessionId,
      "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
    };
    const closed = await fetch(url, {
      method: "DELETE",
      headers: boundHeaders,
    });
    assert.equal(closed.ok, true);

    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(sessions.get(sessionId), undefined);

    const staleConflict = await fetch(url, {
      method: "POST",
      headers: {
        ...boundHeaders,
        "x-openai-session": "chat-C",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    assert.equal(staleConflict.status, 400);

    const staleMissing = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
        "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    assert.equal(staleMissing.status, 400);

    const recovered = await fetch(url, {
      method: "POST",
      headers: boundHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    assert.equal(recovered.ok, true);
  } finally {
    sessions.stopCleanup();
    await sessions.closeAll("identity conflict test cleanup");
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test("CAD document-list parser accepts FastMCP 1.2.x flattened TextContent", async () => {
  const { normalizeDocuments } = await import(
    "../dist/cadgpt/session/drawing-binding.js"
  );

  const one = normalizeDocuments({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          name: "Drawing1.dwg",
          full_name: "C:\\Drawing1.dwg",
          runtime_document_id: "doc-1",
          host: "autocad",
        }),
      },
    ],
    isError: false,
  });
  assert.equal(one.length, 1);
  assert.equal(one[0].name, "Drawing1.dwg");
  assert.equal(one[0].runtime_document_id, "doc-1");

  const two = normalizeDocuments({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          name: "A.dwg",
          full_name: "C:\\A.dwg",
          runtime_document_id: "doc-a",
        }),
      },
      {
        type: "text",
        text: JSON.stringify({
          name: "B.dwg",
          full_name: "C:\\B.dwg",
          runtime_document_id: "doc-b",
        }),
      },
    ],
    isError: false,
  });
  assert.deepEqual(
    two.map((item) => item.runtime_document_id),
    ["doc-a", "doc-b"]
  );

  assert.throws(
    () =>
      normalizeDocuments({
        content: [{ type: "text", text: "not-json" }],
        unexpected: true,
      }),
    /unexpected document-list payload.*shape=object\(keys=content,unexpected\)/i
  );

  const wrapped = normalizeDocuments({
    structuredContent: {
      documents: [
        {
          name: "Wrapped.dwg",
          full_name: "C:\\Wrapped.dwg",
          runtime_document_id: "doc-wrapped",
        },
      ],
    },
  });
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].runtime_document_id, "doc-wrapped");
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

test("CAD upstream captures child stderr and returns failed initial activation to sleeping", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-upstream-fail-"));
  const fakeEntry = path.join(tempRoot, "fake-cad-mcp.mjs");
  await fs.writeFile(
    fakeEntry,
    'process.stderr.write("cad-python-boom\\n"); setTimeout(() => process.exit(2), 20);',
    "utf8"
  );

  const previousPython = process.env.CAD_MCP_PYTHON;
  const previousEntry = process.env.CAD_MCP_ENTRY;
  const previousTimeout = process.env.CAD_MCP_CONNECT_TIMEOUT_MS;
  process.env.CAD_MCP_PYTHON = process.execPath;
  process.env.CAD_MCP_ENTRY = fakeEntry;
  process.env.CAD_MCP_CONNECT_TIMEOUT_MS = "1500";

  let cadUpstream;
  try {
    const moduleUrl =
      pathToFileURL(path.resolve("dist/cadgpt/runtime/cad-upstream.js")).href +
      `?failure=${Date.now()}`;
    ({ cadUpstream } = await import(moduleUrl));

    let failure;
    try {
      await cadUpstream.activate();
    } catch (error) {
      failure = error;
    }

    assert.ok(failure);
    assert.match(String(failure?.message ?? failure), /cad-python-boom/);
    assert.equal(cadUpstream.status().phase, "sleeping");
    assert.match(cadUpstream.status().last_error ?? "", /cad-python-boom/);
  } finally {
    if (cadUpstream) await cadUpstream.deactivate().catch(() => undefined);
    if (previousPython === undefined) delete process.env.CAD_MCP_PYTHON;
    else process.env.CAD_MCP_PYTHON = previousPython;
    if (previousEntry === undefined) delete process.env.CAD_MCP_ENTRY;
    else process.env.CAD_MCP_ENTRY = previousEntry;
    if (previousTimeout === undefined) delete process.env.CAD_MCP_CONNECT_TIMEOUT_MS;
    else process.env.CAD_MCP_CONNECT_TIMEOUT_MS = previousTimeout;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
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


test("checked-in environment keeps work idle timeout aligned at 30 minutes", async () => {
  const fs = await import("node:fs/promises");
  const envText = await fs.readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(envText, /^CADGPT_WORK_IDLE_MS=1800000$/m);
});


test("work idle timeout defaults to 30 minutes", async () => {
  const { getWorkIdleTimeoutMs } = await import(
    "../dist/cadgpt/lib/work-registration.js"
  );
  assert.equal(getWorkIdleTimeoutMs(), 30 * 60 * 1000);
});


test("work resume moves one authenticated work generation to a replacement MCP session", async () => {
  const {
    checkAdmission,
    assertSessionClaimed,
    revokeSessionAdmissions,
  } = await import("../dist/cadgpt/lib/admission.js");
  const {
    activeWorkForSession,
    createWorkRegistration,
    releaseSessionWork,
    validateWorkHandle,
  } = await import("../dist/cadgpt/lib/work-registration.js");
  const { registerWorkControlTools } = await import(
    "../dist/cadgpt/tools/work-control.js"
  );
  const { toolAuthority } = await import("../dist/cadgpt/lib/tool-policy.js");

  const sourceSession = "resume-source-session";
  const targetSession = "resume-target-session";
  checkAdmission(sourceSession, "@cadgpt", "mention");

  const work = createWorkRegistration({
    sessionKey: sourceSession,
    ownerType: "direct-cad",
    ownerId: "drawing-workspace",
    executionPath: "hybrid",
  });

  const callbacks = new Map();
  const prepared = [];
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
    },
  };

  registerWorkControlTools(fakeServer, {
    sessionKey: targetSession,
    prepareFamilies: async (executionPath, ownerId, executionId) => {
      prepared.push({ executionPath, ownerId, executionId });
    },
  });

  assert.equal(toolAuthority("cadgpt_work_resume"), "control");
  const resume = callbacks.get("cadgpt_work_resume");
  assert.equal(typeof resume, "function");

  const result = await resume({
    execution_id: work.executionId,
    authority_token: work.authorityToken,
  });
  assert.equal(result.structuredContent?.data?.resumed, true);
  assert.equal(prepared.length, 1);
  assert.deepEqual(prepared[0], {
    executionPath: "hybrid",
    ownerId: "drawing-workspace",
    executionId: work.executionId,
  });

  assert.equal(activeWorkForSession(sourceSession), null);
  assert.equal(activeWorkForSession(targetSession)?.executionId, work.executionId);
  assert.doesNotThrow(() => assertSessionClaimed(targetSession));
  assert.doesNotThrow(() =>
    validateWorkHandle(work.executionId, work.authorityToken, targetSession)
  );
  assert.throws(
    () => validateWorkHandle(work.executionId, work.authorityToken, sourceSession),
    /NO_ACTIVE_WORK/
  );

  const forged = await resume({
    execution_id: work.executionId,
    authority_token: "forged-token",
  });
  assert.equal(forged.isError, true);

  releaseSessionWork(targetSession);
  revokeSessionAdmissions(sourceSession);
  revokeSessionAdmissions(targetSession);
});

test("CAD document runtime identity excludes CAD-MCP-process-local COM identity", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(
    new URL("../runtimes/cad-mcp/connection/session.py", import.meta.url),
    "utf8"
  );

  const runtimeStart = source.indexOf("def runtime_document_id(doc)");
  const runtimeEnd = source.indexOf("def get_document(", runtimeStart);
  assert.ok(runtimeStart >= 0 && runtimeEnd > runtimeStart);
  const runtimeBlock = source.slice(runtimeStart, runtimeEnd);

  assert.match(runtimeBlock, /acad-hwnd:/);
  assert.match(runtimeBlock, /doc-hwnd:/);
  assert.doesNotMatch(runtimeBlock, /_oleobj_/);
  assert.doesNotMatch(runtimeBlock, /return f"py:/);
  assert.match(runtimeBlock, /cannot establish a reconnect-stable drawing identity/);
});


test("production MCP work resume restores lazy CAD tools after session rotation", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const express = (await import("express")).default;
  const { LATEST_PROTOCOL_VERSION } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );
  const { createSessionManager } = await import(
    "../dist/cadgpt/lib/mcp-session-manager.js"
  );
  const { routeMcpPost } = await import(
    "../dist/cadgpt/lib/mcp-post-routing.js"
  );
  const { resolveCadPrepareSessionByToken } = await import(
    "../dist/cadgpt/tools/cad-launcher.js"
  );

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-work-resume-"));
  const previousRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const app = express();
  app.use(express.json());
  const route = "/mcp/work-resume";
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    if (httpServer.listening) return resolve();
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  const sessions = createSessionManager(port, {
    sessionTtlMs: 60_000,
    cleanupMs: 60_000,
  });
  sessions.startCleanup();

  app.post(route, async (req, res) => {
    try {
      await routeMcpPost({
        req,
        res,
        sessions,
        sessionRecovery: true,
        resolveCadPrepareSessionByToken,
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
          id: req.body?.id ?? null,
        });
      }
    }
  });

  const url = `http://127.0.0.1:${port}${route}`;
  const baseHeaders = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };

  async function initialize(id) {
    const response = await fetch(url, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "cadgpt-work-resume-test", version: "0.1.0" },
        },
      }),
    });
    assert.equal(response.ok, true);
    const sessionId = response.headers.get("mcp-session-id");
    assert.ok(sessionId);
    const headers = {
      ...baseHeaders,
      "mcp-session-id": sessionId,
      "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
    };
    const initialized = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    assert.equal(initialized.ok, true);
    return { sessionId, headers };
  }

  let first;
  let second;
  try {
    first = await initialize(100);

    const admission = await fetch(url, {
      method: "POST",
      headers: first.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 101,
        method: "tools/call",
        params: {
          name: "cadgpt_admission",
          arguments: {
            user_turn: "@cadgpt start CAD work",
            invocation_source: "mention",
          },
        },
      }),
    });
    assert.equal(admission.ok, true);

    const started = await fetch(url, {
      method: "POST",
      headers: first.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 102,
        method: "tools/call",
        params: {
          name: "cadgpt_work_start",
          arguments: {
            owner_type: "direct-cad",
            owner_id: "drawing-workspace",
            execution_path: "hybrid",
          },
        },
      }),
    });
    assert.equal(started.ok, true);
    const startedBody = await started.json();
    const work = startedBody.result?.structuredContent?.data?.work_handle;
    assert.equal(typeof work?.execution_id, "string");
    assert.equal(typeof work?.authority_token, "string");

    second = await initialize(200);

    const beforeList = await fetch(url, {
      method: "POST",
      headers: second.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 201,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(beforeList.ok, true);
    const beforeBody = await beforeList.json();
    const beforeNames = (beforeBody.result?.tools ?? []).map((tool) => tool.name);
    assert.equal(beforeNames.includes("cadgpt_work_resume"), true);
    assert.equal(beforeNames.includes("cad_status"), true);

    const resumed = await fetch(url, {
      method: "POST",
      headers: second.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 202,
        method: "tools/call",
        params: {
          name: "cadgpt_work_resume",
          arguments: {
            execution_id: work.execution_id,
            authority_token: work.authority_token,
          },
        },
      }),
    });
    assert.equal(resumed.ok, true);
    const resumedBody = await resumed.json();
    assert.equal(resumedBody.result?.structuredContent?.data?.resumed, true);

    const afterList = await fetch(url, {
      method: "POST",
      headers: second.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 203,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(afterList.ok, true);
    const afterBody = await afterList.json();
    const afterNames = (afterBody.result?.tools ?? []).map((tool) => tool.name);
    assert.equal(afterNames.includes("cad_status"), true);

    const cadStatus = await fetch(url, {
      method: "POST",
      headers: second.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 204,
        method: "tools/call",
        params: {
          name: "cad_status",
          arguments: {
            execution_id: work.execution_id,
            authority_token: work.authority_token,
          },
        },
      }),
    });
    assert.equal(cadStatus.ok, true);
    const statusBody = await cadStatus.json();
    assert.equal(statusBody.result?.structuredContent?.ok, true);
    assert.equal(statusBody.result?.structuredContent?.data?.phase, "sleeping");
  } finally {
    sessions.stopCleanup();
    await sessions.closeAll("work resume integration cleanup");
    await new Promise((resolve) => httpServer.close(resolve));
    if (previousRoot === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});


test("work_start and work_status can resume an existing hybrid workspace after session rotation", async () => {
  const { checkAdmission, revokeSessionAdmissions } = await import(
    "../dist/cadgpt/lib/admission.js"
  );
  const {
    createWorkRegistration,
    activeWorkForSession,
    releaseSessionWork,
  } = await import("../dist/cadgpt/lib/work-registration.js");
  const { registerWorkControlTools } = await import(
    "../dist/cadgpt/tools/work-control.js"
  );

  const sourceSession = "continuation-start-source";
  const targetSession = "continuation-start-target";
  checkAdmission(sourceSession, "@cadgpt", "mention");
  const work = createWorkRegistration({
    sessionKey: sourceSession,
    ownerType: "direct-cad",
    ownerId: "drawing-workspace",
    executionPath: "hybrid",
  });

  const callbacks = new Map();
  const prepared = [];
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
    },
  };
  registerWorkControlTools(fakeServer, {
    sessionKey: targetSession,
    prepareFamilies: async (executionPath, ownerId, executionId) => {
      prepared.push({ executionPath, ownerId, executionId });
    },
  });

  const start = callbacks.get("cadgpt_work_start");
  const startResult = await start({
    owner_type: "job",
    owner_id: "tbh",
    execution_path: "file",
    continuation_execution_id: work.executionId,
    continuation_authority_token: work.authorityToken,
  });
  assert.equal(startResult.structuredContent?.data?.reused, true);
  assert.equal(startResult.structuredContent?.data?.resumed, true);
  assert.equal(
    startResult.structuredContent?.data?.work_handle?.execution_id,
    work.executionId
  );
  assert.equal(
    startResult.structuredContent?.data?.work_handle?.owner_id,
    "drawing-workspace"
  );
  assert.equal(activeWorkForSession(sourceSession), null);
  assert.equal(activeWorkForSession(targetSession)?.executionId, work.executionId);
  assert.equal(prepared.length, 1);

  const status = callbacks.get("cadgpt_work_status");
  const statusResult = await status({
    continuation_execution_id: work.executionId,
    continuation_authority_token: work.authorityToken,
  });
  assert.equal(statusResult.structuredContent?.data?.active, true);
  assert.equal(
    statusResult.structuredContent?.data?.execution_id,
    work.executionId
  );

  releaseSessionWork(targetSession);
  revokeSessionAdmissions(sourceSession);
  revokeSessionAdmissions(targetSession);
});

test("cg/cl and cg/cj are state-aware with and without a hybrid workspace", async () => {
  const { checkAdmission, revokeSessionAdmissions } = await import(
    "../dist/cadgpt/lib/admission.js"
  );
  const {
    createWorkRegistration,
    releaseSessionWork,
  } = await import("../dist/cadgpt/lib/work-registration.js");
  const { registerCadGptControlTool } = await import(
    "../dist/cadgpt/tools/control.js"
  );

  const sessionKey = "cg-authoring-state-matrix";
  const callbacks = new Map();
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
    },
  };

  registerCadGptControlTool(fakeServer, {
    sessionKey,
    getCadState: async () => "SLEEPING",
    launchCadWorkspace: async () => "list",
    listJobs: async () => "jobs",
    stopCurrentWork: async () => ({ stopped: false, pending: false }),
  });

  const control = callbacks.get("cadgpt_control");

  const noWorkCl = await control({ surface: "cl" });
  assert.equal(
    noWorkCl.structuredContent?.continuation_policy?.start_new_work,
    true
  );
  assert.equal(
    noWorkCl.structuredContent?.continuation_policy?.owner_id,
    "lisp-authoring"
  );
  assert.equal(
    noWorkCl.structuredContent?.continuation_policy?.execution_path,
    "file"
  );

  const noWorkCj = await control({ surface: "cj" });
  assert.equal(
    noWorkCj.structuredContent?.continuation_policy?.start_new_work,
    true
  );
  assert.equal(
    noWorkCj.structuredContent?.continuation_policy?.owner_id,
    "job-authoring"
  );

  checkAdmission(sessionKey, "@cadgpt", "mention");
  const work = createWorkRegistration({
    sessionKey,
    ownerType: "direct-cad",
    ownerId: "drawing-workspace",
    executionPath: "hybrid",
  });

  const withWorkspaceCl = await control({ surface: "cl" });
  assert.equal(
    withWorkspaceCl.structuredContent?.continuation_policy?.start_new_work,
    false
  );
  assert.match(
    withWorkspaceCl.structuredContent?.continuation_policy?.existing_work_action ?? "",
    /Reuse the current work_handle/
  );

  const withWorkspaceCj = await control({ surface: "cj" });
  assert.equal(
    withWorkspaceCj.structuredContent?.continuation_policy?.start_new_work,
    false
  );

  releaseSessionWork(sessionKey);
  revokeSessionAdmissions(sessionKey);
});

test("cad-mcp-dev is demand-driven and can attach to hybrid work without replacing it", async () => {
  const previous = process.env.CADGPT_BUILD_PROFILE;
  process.env.CADGPT_BUILD_PROFILE = "development";
  try {
    const { checkAdmission, revokeSessionAdmissions } = await import(
      "../dist/cadgpt/lib/admission.js"
    );
    const {
      activeWorkForSession,
      acquireToolLease,
      createWorkRegistration,
      releaseSessionWork,
      runWithToolLease,
    } = await import("../dist/cadgpt/lib/work-registration.js");
    const { registerWorkControlTools } = await import(
      "../dist/cadgpt/tools/work-control.js"
    );
    const { registerCadGptControlTool } = await import(
      "../dist/cadgpt/tools/control.js"
    );

    const sessionKey = "hybrid-demand-dev";
    checkAdmission(sessionKey, "@cadgpt", "mention");
    const work = createWorkRegistration({
      sessionKey,
      ownerType: "direct-cad",
      ownerId: "drawing-workspace",
      executionPath: "hybrid",
    });

    const controlCallbacks = new Map();
    const fakeControlServer = {
      registerTool(name, _config, callback) {
        controlCallbacks.set(name, callback);
      },
    };
    registerCadGptControlTool(fakeControlServer, {
      sessionKey,
      getCadState: async () => "SLEEPING",
      launchCadWorkspace: async () => "list",
      listJobs: async () => "jobs",
      stopCurrentWork: async () => ({ stopped: false, pending: false }),
    });

    const mcpPolicy = await controlCallbacks.get("cadgpt_control")({
      surface: "mcp",
    });
    assert.equal(
      mcpPolicy.structuredContent?.continuation_policy?.start_new_work,
      false
    );
    assert.equal(
      mcpPolicy.structuredContent?.continuation_policy?.enable_capability,
      "cad-mcp-dev"
    );

    const workCallbacks = new Map();
    const prepared = [];
    const fakeWorkServer = {
      registerTool(name, _config, callback) {
        workCallbacks.set(name, callback);
      },
    };
    registerWorkControlTools(fakeWorkServer, {
      sessionKey,
      prepareFamilies: async (executionPath, ownerId, executionId) => {
        prepared.push({ executionPath, ownerId, executionId });
      },
    });

    const start = workCallbacks.get("cadgpt_work_start");
    const result = await start({
      owner_type: "skill",
      owner_id: "cad-mcp-dev",
      execution_path: "hybrid",
      continuation_execution_id: work.executionId,
      continuation_authority_token: work.authorityToken,
    });

    assert.equal(result.structuredContent?.data?.reused, true);
    assert.equal(
      result.structuredContent?.data?.reason,
      "conversation_work_dev_capability_enabled"
    );
    assert.equal(
      result.structuredContent?.data?.work_handle?.execution_id,
      work.executionId
    );
    assert.equal(
      result.structuredContent?.data?.work_handle?.owner_id,
      "drawing-workspace"
    );
    assert.deepEqual(
      result.structuredContent?.data?.work_handle?.capabilities,
      ["cad-mcp-dev"]
    );
    assert.equal(
      activeWorkForSession(sessionKey)?.executionId,
      work.executionId
    );
    assert.equal(prepared.at(-1)?.ownerId, "cad-mcp-dev");

    const lease = acquireToolLease({
      tool: "cad_mcp_dev_read",
      family: "cad-mcp-dev",
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    assert.equal(lease.workId, work.executionId);
    assert.equal(lease.ownerId, "drawing-workspace");
    await runWithToolLease(lease, async () => undefined);

    releaseSessionWork(sessionKey);
    revokeSessionAdmissions(sessionKey);
  } finally {
    if (previous === undefined) delete process.env.CADGPT_BUILD_PROFILE;
    else process.env.CADGPT_BUILD_PROFILE = previous;
  }
});

test("cg/mcp remains unavailable in production and starts standalone dev work only in development", async () => {
  const { registerCadGptControlTool } = await import(
    "../dist/cadgpt/tools/control.js"
  );

  const previous = process.env.CADGPT_BUILD_PROFILE;
  try {
    process.env.CADGPT_BUILD_PROFILE = "production";
    const productionCallbacks = new Map();
    registerCadGptControlTool(
      {
        registerTool(name, _config, callback) {
          productionCallbacks.set(name, callback);
        },
      },
      {
        sessionKey: "mcp-production-policy",
        getCadState: async () => "SLEEPING",
        launchCadWorkspace: async () => "list",
        listJobs: async () => "jobs",
        stopCurrentWork: async () => ({ stopped: false, pending: false }),
      }
    );
    const production = await productionCallbacks.get("cadgpt_control")({
      surface: "mcp",
    });
    assert.equal(
      production.structuredContent?.continuation_policy?.start_new_work,
      false
    );
    assert.equal(
      production.structuredContent?.continuation_policy?.development_only,
      true
    );

    process.env.CADGPT_BUILD_PROFILE = "development";
    const developmentCallbacks = new Map();
    registerCadGptControlTool(
      {
        registerTool(name, _config, callback) {
          developmentCallbacks.set(name, callback);
        },
      },
      {
        sessionKey: "mcp-development-policy",
        getCadState: async () => "SLEEPING",
        launchCadWorkspace: async () => "list",
        listJobs: async () => "jobs",
        stopCurrentWork: async () => ({ stopped: false, pending: false }),
      }
    );
    const development = await developmentCallbacks.get("cadgpt_control")({
      surface: "mcp",
    });
    assert.equal(
      development.structuredContent?.continuation_policy?.start_new_work,
      true
    );
    assert.equal(
      development.structuredContent?.continuation_policy?.owner_id,
      "cad-mcp-dev"
    );
    assert.equal(
      development.structuredContent?.continuation_policy?.execution_path,
      "file"
    );
  } finally {
    if (previous === undefined) delete process.env.CADGPT_BUILD_PROFILE;
    else process.env.CADGPT_BUILD_PROFILE = previous;
  }
});


test("same OpenAI conversation survives MCP transport rotation without explicit resume while unrelated conversation stays isolated", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const express = (await import("express")).default;
  const { LATEST_PROTOCOL_VERSION } = await import("@modelcontextprotocol/sdk/types.js");
  const { createSessionManager } = await import("../dist/cadgpt/lib/mcp-session-manager.js");
  const { routeMcpPost } = await import("../dist/cadgpt/lib/mcp-post-routing.js");
  const { resolveCadPrepareSessionByToken } = await import("../dist/cadgpt/tools/cad-launcher.js");

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-logical-session-"));
  const previousRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const app = express();
  app.use(express.json());
  const route = "/mcp/logical-session";
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    if (httpServer.listening) return resolve();
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;

  const sessions = createSessionManager(port, {
    sessionTtlMs: 60_000,
    cleanupMs: 60_000,
  });
  sessions.startCleanup();

  app.post(route, async (req, res) => {
    try {
      await routeMcpPost({
        req,
        res,
        sessions,
        sessionRecovery: true,
        resolveCadPrepareSessionByToken,
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
          id: req.body?.id ?? null,
        });
      }
    }
  });

  const url = `http://127.0.0.1:${port}${route}`;
  const baseHeaders = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };

  async function initialize(id, openaiSession) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "x-openai-session": openaiSession,
        "x-openai-subject": "same-account",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "logical-session-test", version: "0.1.0" },
        },
      }),
    });
    assert.equal(response.ok, true);
    const sessionId = response.headers.get("mcp-session-id");
    assert.ok(sessionId);
    const headers = {
      ...baseHeaders,
      "mcp-session-id": sessionId,
      "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
      "x-openai-session": openaiSession,
      "x-openai-subject": "same-account",
    };
    const initialized = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    assert.equal(initialized.ok, true);
    return { sessionId, headers };
  }

  async function tool(headers, id, name, args = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    assert.equal(response.ok, true);
    return response.json();
  }

  let a;
  let b;
  let c;
  try {
    a = await initialize(1000, "chat-A");

    const initialListResponse = await fetch(url, {
      method: "POST",
      headers: a.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "initial-tools-list",
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(initialListResponse.ok, true);
    const initialListBody = await initialListResponse.json();
    const initialNames = (initialListBody.result?.tools ?? [])
      .map((item) => item.name)
      .sort();
    for (const required of [
      "cad__cad_list_layers",
      "cad_invoke_manifest_tool",
      "job_run_direct",
      "job_draft_validate",
      "job_promote_draft",
      "lisp_scaffold",
      "library_import",
      "asset_import",
      "file_create",
    ]) {
      assert.equal(
        initialNames.includes(required),
        true,
        `stable MCP surface is missing ${required}`
      );
    }
    const { cadUpstream } = await import("../dist/cadgpt/runtime/cad-upstream.js");
    assert.equal(cadUpstream.status().phase, "sleeping");

    const preAdmissionCad = await tool(
      a.headers,
      "pre-admission-cad",
      "cad__cad_list_layers",
      {}
    );
    assert.equal(preAdmissionCad.result?.isError, true);
    assert.match(
      JSON.stringify(preAdmissionCad.result ?? {}),
      /execution_id|authority_token|CADGPT_SESSION_REQUIRED|NO_ACTIVE_WORK/
    );

    const admission = await tool(a.headers, 1001, "cadgpt_admission", {
      user_turn: "@cadgpt start test work",
      invocation_source: "mention",
    });
    assert.equal(
      admission.result?.structuredContent?.data?.claimed,
      true
    );

    const started = await tool(a.headers, 1002, "cadgpt_work_start", {
      owner_type: "direct-cad",
      owner_id: "drawing-workspace",
      execution_path: "hybrid",
    });
    assert.equal(started.result?.structuredContent?.ok, true);
    assert.equal(
      started.result?.structuredContent?.data?.work_handle?.owner_id,
      "drawing-workspace"
    );
    assert.deepEqual(
      started.result?.structuredContent?.data?.work_handle?.work_capabilities,
      []
    );
    assert.equal(
      started.result?.structuredContent?.data?.tool_surface?.execution_path,
      "hybrid"
    );
    assert.ok(
      started.result?.structuredContent?.data?.tool_surface?.cad_proxy_tool_count > 0
    );

    b = await initialize(1010, "chat-A");
    assert.notEqual(a.sessionId, b.sessionId);

    const listResponse = await fetch(url, {
      method: "POST",
      headers: b.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1011,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(listResponse.ok, true);
    const listBody = await listResponse.json();
    const names = (listBody.result?.tools ?? [])
      .map((item) => item.name)
      .sort();
    assert.deepEqual(
      names,
      initialNames,
      "MCP tool definitions must remain stable across admission, work start, and transport rotation"
    );
    assert.equal(names.includes("cad_status"), true);
    assert.equal(names.includes("cad__cad_list_layers"), true);
    assert.equal(names.includes("job_draft_validate"), true);
    assert.equal(names.includes("job_promote_draft"), true);

    const cj = await tool(b.headers, 1012, "cadgpt_control", { surface: "cj" });
    assert.equal(
      cj.result?.structuredContent?.continuation_policy?.start_new_work,
      false
    );

    const status = await tool(b.headers, 1013, "cadgpt_work_status", {});
    assert.equal(status.result?.structuredContent?.data?.active, true);
    assert.equal(
      status.result?.structuredContent?.data?.execution_path,
      "hybrid"
    );

    c = await initialize(1020, "chat-C");
    const foreignBeforeAdmission = await tool(
      c.headers,
      1021,
      "cadgpt_work_status",
      {}
    );
    assert.equal(foreignBeforeAdmission.result?.isError, true);
    assert.match(
      foreignBeforeAdmission.result?.structuredContent?.data?.error ?? "",
      /CADGPT_SESSION_REQUIRED/
    );

    const admissionC = await tool(c.headers, 1022, "cadgpt_admission", {
      user_turn: "@cadgpt start separate test",
      invocation_source: "mention",
    });
    assert.equal(admissionC.result?.structuredContent?.data?.claimed, true);

    const foreignStatus = await tool(c.headers, 1023, "cadgpt_work_status", {});
    assert.equal(foreignStatus.result?.structuredContent?.data?.active, false);

    const foreignCj = await tool(c.headers, 1024, "cadgpt_control", { surface: "cj" });
    assert.equal(
      foreignCj.result?.structuredContent?.continuation_policy?.start_new_work,
      true
    );

    const stopped = await tool(b.headers, 1014, "cadgpt_control", { surface: "stop" });
    assert.match(stopped.result?.structuredContent?.text ?? "", /WORK\s+IDLE/);
  } finally {
    sessions.stopCleanup();
    await sessions.closeAll("logical session integration cleanup");
    await new Promise((resolve) => httpServer.close(resolve));
    if (previousRoot === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
