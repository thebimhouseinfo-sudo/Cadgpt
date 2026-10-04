import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("drawing metadata cleanup tracks only the last folder created by one execution", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-drawing-meta-")
  );
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  try {
    const persistence = await import(
      "../dist/cadgpt/runtime/drawing-persistence.js"
    );
    const executionId = "exec-drawing-meta-test";
    const first = path.join(
      tempRoot,
      "drawings",
      "first-anchor"
    );
    const second = path.join(
      tempRoot,
      "drawings",
      "second-anchor"
    );
    await fs.mkdir(first, { recursive: true });
    await fs.mkdir(second, { recursive: true });

    persistence.registerCreatedDrawingMetadataFolderForExecution(
      executionId,
      first
    );
    persistence.registerCreatedDrawingMetadataFolderForExecution(
      executionId,
      second
    );

    const result =
      await persistence.cleanupDrawingMetadataForExecution(
        executionId
      );
    assert.equal(result.deleted_empty, true);
    assert.equal(
      await fs.stat(first).then(() => true, () => false),
      true
    );
    assert.equal(
      await fs.stat(second).then(() => true, () => false),
      false
    );
  } finally {
    if (previous === undefined) {
      delete process.env.CADGPT_APPDATA_ROOT;
    } else {
      process.env.CADGPT_APPDATA_ROOT = previous;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("non-empty drawing metadata folder survives execution cleanup", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-drawing-meta-keep-")
  );
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  try {
    const persistence = await import(
      "../dist/cadgpt/runtime/drawing-persistence.js"
    );
    const executionId = "exec-drawing-meta-keep";
    const root = path.join(
      tempRoot,
      "drawings",
      "kept-anchor"
    );
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, "metadata.json"),
      "{}\n",
      "utf8"
    );

    persistence.registerCreatedDrawingMetadataFolderForExecution(
      executionId,
      root
    );
    const result =
      await persistence.cleanupDrawingMetadataForExecution(
        executionId
      );
    assert.equal(result.deleted_empty, false);
    assert.equal(result.kept_nonempty, true);
    assert.equal(
      await fs.stat(root).then(() => true, () => false),
      true
    );
  } finally {
    if (previous === undefined) {
      delete process.env.CADGPT_APPDATA_ROOT;
    } else {
      process.env.CADGPT_APPDATA_ROOT = previous;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("generic file mutations can use an execution-authorized drawing metadata root", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-drawing-file-")
  );
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const callbacks = new Map();
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
      return { remove() {} };
    },
  };

  const {
    checkAdmission,
    revokeSessionAdmissions,
  } = await import("../dist/cadgpt/lib/admission.js");
  const {
    acquireToolLease,
    createWorkRegistration,
    releaseWorkRegistration,
    runWithToolLease,
  } = await import(
    "../dist/cadgpt/lib/work-registration.js"
  );
  const { registerFilesystemTools } = await import(
    "../dist/cadgpt/tools/filesystem.js"
  );
  const persistence = await import(
    "../dist/cadgpt/runtime/drawing-persistence.js"
  );

  const sessionKey = "drawing-file-auth-test";
  checkAdmission(sessionKey, "@cg", "mention");

  try {
    registerFilesystemTools(fakeServer);
    const fileCreate = callbacks.get("file_create");
    assert.ok(fileCreate);

    const work = createWorkRegistration({
      sessionKey,
      ownerType: "job",
      ownerId: "metadata-test",
      executionPath: "hybrid",
    });
    const root = path.join(
      tempRoot,
      "drawings",
      "authorized-anchor"
    );
    await fs.mkdir(root, { recursive: true });
    persistence.authorizeDrawingMetadataRootForExecution(
      work.executionId,
      root
    );

    const lease = acquireToolLease({
      tool: "file_create",
      family: "filesystem",
      targetId: root,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    const target = path.join(root, "metadata.json");
    const created = await runWithToolLease(lease, () =>
      fileCreate({ path: target, content: "{}\n" })
    );
    assert.equal(created.isError, undefined);
    assert.equal(
      await fs.readFile(target, "utf8"),
      "{}\n"
    );

    const otherRoot = path.join(
      tempRoot,
      "drawings",
      "not-authorized"
    );
    await fs.mkdir(otherRoot, { recursive: true });
    const deniedLease = acquireToolLease({
      tool: "file_create",
      family: "filesystem",
      targetId: otherRoot,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    const denied = await runWithToolLease(deniedLease, () =>
      fileCreate({
        path: path.join(otherRoot, "should-not-write.json"),
        content: "{}\n",
      })
    );
    assert.equal(denied.isError, true);
    assert.match(
      JSON.stringify(denied),
      /outside CadGPT execution-authorized writable AppData/
    );

    releaseWorkRegistration(
      work.executionId,
      work.authorityToken,
      sessionKey
    );
  } finally {
    revokeSessionAdmissions(sessionKey);
    if (previous === undefined) {
      delete process.env.CADGPT_APPDATA_ROOT;
    } else {
      process.env.CADGPT_APPDATA_ROOT = previous;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
