import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("cadgpt_work_upgrade safely transitions FILE work to HYBRID successor work", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-upgrade-test-"));
  const previousRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  try {
    const { createWorkRegistration, validateWorkHandle } = await import(
      "../dist/cadgpt/lib/work-registration.js"
    );
    const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
    const { registerWorkControlTools } = await import(
      "../dist/cadgpt/tools/work-control.js"
    );
    const { toolAuthority } = await import(
      "../dist/cadgpt/lib/tool-policy.js"
    );
    assert.equal(
      toolAuthority("cadgpt_work_upgrade"),
      "control",
      "cadgpt_work_upgrade must receive its old execution credentials intact"
    );

    const sessionKey = "test-upgrade-session-1";
    checkAdmission(sessionKey, "@cadgpt", "mention");

    const initialWork = createWorkRegistration({
      sessionKey,
      ownerType: "file",
      ownerId: "job-draft",
      executionPath: "file",
    });

    assert.equal(initialWork.executionPath, "file");

    const callbacks = new Map();
    const fakeServer = {
      registerTool(name, _config, callback) {
        callbacks.set(name, callback);
      },
    };

    let upgradeCalled = false;
    registerWorkControlTools(fakeServer, {
      sessionKey,
      prepareFamilies: async () => ({}),
      upgradeToHybrid: async (prevExecId, authTok, drawingSelector) => {
        upgradeCalled = true;
        const validated = validateWorkHandle(prevExecId, authTok, sessionKey);
        assert.equal(validated.executionId, initialWork.executionId);

        // Successor work
        const newWork = createWorkRegistration({
          sessionKey,
          ownerType: validated.ownerType,
          ownerId: validated.ownerId,
          executionPath: "hybrid",
        });

        return {
          work_handle: {
            execution_id: newWork.executionId,
            authority_token: newWork.authorityToken,
            owner_type: newWork.ownerType,
            owner_id: newWork.ownerId,
            execution_path: newWork.executionPath,
            generation: newWork.generation,
          },
          drawing: { name: drawingSelector || "Test.dwg", runtime_document_id: "doc-123" },
          cad_tools_ready: true,
          cad_proxy_tool_count: 5,
          cad_proxy_tools: ["cad__line", "cad__circle"],
        };
      },
    });

    const upgradeTool = callbacks.get("cadgpt_work_upgrade");
    assert.ok(upgradeTool, "cadgpt_work_upgrade tool must be registered");

    const upgradeResult = await upgradeTool({
      execution_id: initialWork.executionId,
      authority_token: initialWork.authorityToken,
      drawing_selector: "Plan.dwg",
    });

    assert.equal(upgradeCalled, true);
    assert.equal(upgradeResult.structuredContent.ok, true);
    assert.equal(upgradeResult.structuredContent.data.upgraded, true);
    assert.equal(upgradeResult.structuredContent.data.work_handle.execution_path, "hybrid");
    assert.equal(upgradeResult.structuredContent.data.drawing.name, "Plan.dwg");
    assert.equal(upgradeResult.structuredContent.data.cad_tools_ready, true);
  } finally {
    process.env.CADGPT_APPDATA_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("job draft creation and promotion validate library prerequisites clearly", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-job-lib-test-"));
  const previousRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  try {
    const registryRoot = path.join(tempRoot, "registry", "user");
    const draftRoot = path.join(tempRoot, "workspace", "job-draft");
    await fs.mkdir(registryRoot, { recursive: true });
    await fs.mkdir(draftRoot, { recursive: true });

    await fs.writeFile(
      path.join(registryRoot, "libraries.json"),
      JSON.stringify({
        libraries: [{ id: "my-existing-lib", kind: "job", enabled: true }],
      }),
      "utf8"
    );

    const { registerJobAuthoringTools } = await import(
      "../dist/cadgpt/tools/jobs.js"
    );

    const callbacks = new Map();
    const fakeServer = {
      registerTool(name, _config, callback) {
        callbacks.set(name, callback);
      },
    };
    registerJobAuthoringTools(fakeServer);

    const draftNew = callbacks.get("job_draft_new");
    assert.ok(draftNew);

    // 1. Test draft for unregistered library reports clear library_status
    const unregisteredDraftPath = path.join(draftRoot, "unregistered-lib", "test.py");
    const resUnregistered = await draftNew({
      draft_path: unregisteredDraftPath,
      content: "print('hello')",
    });

    assert.equal(resUnregistered.structuredContent.ok, true);
    assert.equal(resUnregistered.structuredContent.data.library_status.registered, false);
    assert.match(
      resUnregistered.structuredContent.data.library_status.note,
      /not yet in libraries\.json/
    );

    // 2. Test draft for registered library reports confirmed status
    const registeredDraftPath = path.join(draftRoot, "my-existing-lib", "test.py");
    const resRegistered = await draftNew({
      draft_path: registeredDraftPath,
      target_library_id: "my-existing-lib",
      content: "print('hello')",
    });
    assert.equal(resRegistered.structuredContent.ok, true);
    assert.equal(resRegistered.structuredContent.data.library_status.registered, true);

    // 3. Test promote to non-existent library gives clear error with available list
    const promoteTool = callbacks.get("job_promote_draft");
    assert.ok(promoteTool);

    const promoteError = await promoteTool({
      draft_path: registeredDraftPath,
      target_path: path.join(tempRoot, "libraries", "jobs", "non-existent", "test.py"),
      library_id: "non-existent",
      relative_path: "test.py",
      metadata: { id: "test", title: "Test", summary: "Test", risk: "low" },
      test_evidence: "tested ok",
      final_validation_evidence: "validated ok",
      user_accepted: true,
    });

    assert.equal(promoteError.isError, true);
    const errorMsg = promoteError.structuredContent?.summary || promoteError.content?.[0]?.text || "";
    assert.match(errorMsg, /MANAGED_LIBRARY_NOT_FOUND/);
    assert.match(errorMsg, /my-existing-lib/);
  } finally {
    process.env.CADGPT_APPDATA_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
