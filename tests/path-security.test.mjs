import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("mutation resolver requires absolute paths and blocks root escape", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-path-"));
  const appdata = path.join(temp, "appdata");
  const workspace = path.join(appdata, "workspace");
  const data = path.join(appdata, "data");
  const libraries = path.join(appdata, "libraries");
  const outside = path.join(temp, "outside");
  await Promise.all([
    fs.mkdir(workspace, { recursive: true }),
    fs.mkdir(data, { recursive: true }),
    fs.mkdir(libraries, { recursive: true }),
    fs.mkdir(outside, { recursive: true }),
  ]);

  const insideFile = path.join(workspace, "draft.txt");
  const outsideFile = path.join(outside, "outside.txt");
  await fs.writeFile(insideFile, "inside");
  await fs.writeFile(outsideFile, "outside");

  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = appdata;
  try {
    const { resolveAbsoluteMutationPath } = await import(
      "../dist/cadgpt/lib/path-security.js"
    );
    const writableRoots = [workspace, data];

    await assert.rejects(
      resolveAbsoluteMutationPath("appdata/workspace/draft.txt", {
        allowedRoots: writableRoots,
      }),
      /ABSOLUTE_PATH_REQUIRED/
    );

    assert.equal(
      await resolveAbsoluteMutationPath(insideFile, {
        allowedRoots: writableRoots,
      }),
      await fs.realpath(insideFile)
    );

    await assert.rejects(
      resolveAbsoluteMutationPath(outsideFile, {
        allowedRoots: writableRoots,
      }),
      /outside CadGPT/
    );

    const createTarget = path.join(workspace, "new", "created.txt");
    assert.equal(
      await resolveAbsoluteMutationPath(createTarget, {
        allowedRoots: writableRoots,
        forCreate: true,
      }),
      path.join(await fs.realpath(workspace), "new", "created.txt")
    );

    const junction = path.join(workspace, "escape-junction");
    try {
      await fs.symlink(outside, junction, "junction");
      await assert.rejects(
        resolveAbsoluteMutationPath(path.join(junction, "new.txt"), {
          allowedRoots: writableRoots,
          forCreate: true,
        }),
        /outside CadGPT/
      );
    } catch (error) {
      if (
        error?.code !== "EPERM" &&
        error?.code !== "EACCES" &&
        error?.code !== "UNKNOWN"
      ) {
        throw error;
      }
    }
  } finally {
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(temp, { recursive: true, force: true });
  }
});
