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
  assert.equal(await resolveOwnedSourceMutation(path.join(rootA, "JOB.md"), own, { forCreate: true }), path.join(await fs.realpath(rootA), "JOB.md"));
  await assert.rejects(
    resolveOwnedSourceMutation(path.join(root, "libraries", "jobs", "hvac", "other-job", "JOB.md"), own, { forCreate: true }),
    /V5_SOURCE_OUTSIDE_OWNER/
  );
});

test("V5 unregistered final JOB.md can prepare for real RUN without draft promotion", async () => {
  const fsSync = await import("node:fs");
  const source = fsSync.readFileSync(path.join(import.meta.dirname, "..", "src", "cadgpt", "tools", "jobs.ts"), "utf8");
  const start = source.indexOf('"job_runtime_prepare"');
  const end = source.indexOf('"job_runtime_finish"', start);
  const part = source.slice(start, end);
  assert.match(part, /source_path: z\.string\(\)\.min\(1\)\.optional\(\)/);
  assert.match(part, /V5_JOB_SOURCE_BUILDER_WORK_REQUIRED/);
  assert.match(part, /V5_JOB_SOURCE_OUTSIDE_MANAGED_LIBRARY/);
  assert.match(part, /jobId = "v5:"/);
});
