import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-v5-builder-"));
const previous = process.env.CADGPT_APPDATA_ROOT;
process.env.CADGPT_APPDATA_ROOT = root;
const { checkAdmission, revokeSessionAdmissions } = await import("../dist/cadgpt/lib/admission.js");
const { createWorkRegistration, releaseSessionWork, runWithToolLease } =
  await import("../dist/cadgpt/lib/work-registration.js");
const { registerV5BuilderSourceTools } = await import("../dist/cadgpt/tools/v5-builder-source.js");
const callbacks = new Map();
registerV5BuilderSourceTools({ registerTool(name, _schema, callback) { callbacks.set(name, callback); } });
const sha = text => createHash("sha256").update(text).digest("hex");

test.after(async () => {
  if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
  else process.env.CADGPT_APPDATA_ROOT = previous;
  await fs.rm(root, { recursive: true, force: true });
});

test("V5 direct Builder source tools are registered", () => {
  assert.equal(typeof callbacks.get("v5_source_create"), "function");
  assert.equal(typeof callbacks.get("v5_source_update"), "function");
});

test("V5 owner source path rejects traversal before mutation", async () => {
  const { ownedSourceRoot, resolveOwnedSourceMutation } =
    await import("../dist/cadgpt/lib/owned-source.js");
  const own = { kind: "reusable-job", libraryId: "hvac", relativeFolder: "own-job" };
  const rootA = ownedSourceRoot(own);
  await fs.mkdir(rootA, { recursive: true });
  assert.equal(await resolveOwnedSourceMutation(path.join(rootA, "JOB.md"), own, { forCreate: true }), path.join(rootA, "JOB.md"));
  await assert.rejects(
    resolveOwnedSourceMutation(path.join(root, "libraries", "jobs", "hvac", "other-job", "JOB.md"), own, { forCreate: true }),
    /V5_SOURCE_OUTSIDE_OWNER/
  );
});
