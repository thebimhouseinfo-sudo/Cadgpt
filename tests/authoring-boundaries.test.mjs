import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("HYBRID successor is staged without invalidating FILE authority", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-stage-"));
  const priorRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;
  try {
    const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");
    const {
      activeWorkForSession,
      commitSuccessorWorkRegistration,
      createSuccessorWorkRegistration,
      createWorkRegistration,
      releaseWorkRegistration,
      validateWorkHandle,
    } = await import("../dist/cadgpt/lib/work-registration.js");

    const sessionKey = "authoring-boundary-stage";
    checkAdmission(sessionKey, "@cadgpt", "mention");
    const initial = createWorkRegistration({
      sessionKey,
      ownerType: "skill",
      ownerId: "write-lisp",
      executionPath: "file",
    });

    const staged = createSuccessorWorkRegistration({
      previousExecutionId: initial.executionId,
      authorityToken: initial.authorityToken,
      sessionKey,
      executionPath: "hybrid",
    });
    assert.equal(activeWorkForSession(sessionKey)?.executionId, initial.executionId);
    assert.equal(
      validateWorkHandle(initial.executionId, initial.authorityToken, sessionKey).executionPath,
      "file"
    );

    releaseWorkRegistration(staged.executionId, staged.authorityToken, sessionKey);
    assert.equal(activeWorkForSession(sessionKey)?.executionId, initial.executionId);

    const staged2 = createSuccessorWorkRegistration({
      previousExecutionId: initial.executionId,
      authorityToken: initial.authorityToken,
      sessionKey,
      executionPath: "hybrid",
    });
    const committed = commitSuccessorWorkRegistration({
      previousExecutionId: initial.executionId,
      previousAuthorityToken: initial.authorityToken,
      successorExecutionId: staged2.executionId,
      successorAuthorityToken: staged2.authorityToken,
      sessionKey,
    });
    assert.equal(committed.executionPath, "hybrid");
    assert.equal(activeWorkForSession(sessionKey)?.executionId, committed.executionId);
    assert.throws(
      () => validateWorkHandle(initial.executionId, initial.authorityToken, sessionKey),
      /NO_ACTIVE_WORK/
    );
  } finally {
    process.env.CADGPT_APPDATA_ROOT = priorRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("canonical managed_path user libraries resolve through user-assets", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-managed-path-"));
  const priorRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;
  try {
    const registryRoot = path.join(tempRoot, "registry", "user");
    const jobRoot = path.join(tempRoot, "libraries", "jobs", "compat-jobs");
    await fs.mkdir(registryRoot, { recursive: true });
    await fs.mkdir(jobRoot, { recursive: true });
    const jobPath = path.join(jobRoot, "demo.py");
    await fs.writeFile(jobPath, "print('ok')", "utf8");
    await fs.writeFile(
      path.join(registryRoot, "libraries.json"),
      JSON.stringify({
        version: 1,
        libraries: [{
          id: "compat-jobs",
          kind: "job",
          name: "Compat Jobs",
          enabled: true,
          managed_path: "appdata/libraries/jobs/compat-jobs",
          origin: "created",
        }],
      }),
      "utf8"
    );

    const { resolveRegisteredAssetPath } = await import(
      "../dist/cadgpt/tools/user-assets.js"
    );
    const resolved = await resolveRegisteredAssetPath(
      "job",
      "compat-jobs",
      "demo.py"
    );
    assert.equal(await fs.realpath(resolved), await fs.realpath(jobPath));
  } finally {
    process.env.CADGPT_APPDATA_ROOT = priorRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("Direct Job bundled Lisp environment points to internal resources", async () => {
  const { getBundledLispLibrariesRoot } = await import(
    "../dist/cadgpt/lib/bundled-assets.js"
  );
  const root = getBundledLispLibrariesRoot().replaceAll("\\", "/");
  assert.match(root, /\/resources\/cad\/internal-lisp$/);

  const jobsSource = await fs.readFile(
    new URL("../src/cadgpt/tools/jobs.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    jobsSource,
    /CADGPT_BUNDLED_LISP_ROOT:\s*getBundledLispLibrariesRoot\(\)/
  );
  assert.doesNotMatch(
    jobsSource,
    /CADGPT_BUNDLED_LISP_ROOT:[\s\S]{0,160}appdata[\\/]+libraries[\\/]+lisp/
  );
});

test("server upgrade block stages successor instead of releasing FILE work first", async () => {
  const serverSource = await fs.readFile(
    new URL("../src/cadgpt/server-factory.ts", import.meta.url),
    "utf8"
  );
  const start = serverSource.indexOf(
    "upgradeToHybrid: async (previousExecutionId, authorityToken, drawingSelector) => {"
  );
  const end = serverSource.indexOf("\n  });\n\n  return server;", start);
  assert.ok(start >= 0 && end > start);
  const block = serverSource.slice(start, end);
  assert.match(block, /createSuccessorWorkRegistration/);
  assert.match(block, /commitSuccessorWorkRegistration/);
  assert.doesNotMatch(block, /releaseSessionWork\(sessionKey\)/);
});
