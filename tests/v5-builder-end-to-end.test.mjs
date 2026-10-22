import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "v5-builder-real-"));
const env = process.env.CADGPT_APPDATA_ROOT;
process.env.CADGPT_APPDATA_ROOT = tmp;

const { checkAdmission, revokeSessionAdmissions } = await import("../dist/cadgpt/lib/admission.js");
const {
  createWorkRegistration, acquireToolLease,
  runWithToolLease, releaseSessionWork,
} = await import("../dist/cadgpt/lib/work-registration.js");
const { registerV5BuilderSourceTools } = await import("../dist/cadgpt/tools/v5-builder-source.js");
const { getJobLibrariesRoot } = await import("../dist/cadgpt/lib/appdata.js");
const { observeExplicitJobUpdateCommand, activateJobUpdateGrant } = await import("../dist/cadgpt/runtime/job-update-grant.js");

const handlers = new Map();
registerV5BuilderSourceTools({
  registerTool(name, _config, handler) { handlers.set(name, handler); },
});
const sha = s => createHash("sha256").update(s).digest("hex");
test.after(async () => {
  if (env === undefined) delete process.env.CADGPT_APPDATA_ROOT;
  else process.env.CADGPT_APPDATA_ROOT = env;
  await fs.rm(tmp, { recursive: true, force: true });
});

test("V5 Builder direct create/update/publish works only within same owned package", async () => {
  const session = "v5-builder-real-work";
  checkAdmission(session, "@cg", "mention");
  const work = createWorkRegistration({
    sessionKey: session, ownerType: "skill",
    ownerId: "jobcreate", executionPath: "file",
  });
  const call = async (tool, payload) => {
    const lease = acquireToolLease({
      sessionKey: session, executionId: work.executionId,
      authorityToken: work.authorityToken, tool, family: "filesystem",
    });
    return runWithToolLease(lease, () => handlers.get(tool)(payload));
  };
  const base = { kind: "reusable-job", library_id: "v5builderlib", folder: "joba", relative_file: "JOB.md" };
  const source = "# Direct Builder Job\n\n## Steps\n1. Report.\n";
  try {
    const created = await call("v5_source_create", { ...base, content: source });
    assert.notEqual(created.isError, true, JSON.stringify(created));
    const savedPath = path.join(getJobLibrariesRoot(), "v5builderlib", "joba", "JOB.md");
    assert.equal(await fs.readFile(savedPath, "utf8"), source);

    const published = await call("v5_source_publish", {
      kind: "job", library_id: "v5builderlib", library_name: "Builder Integration",
    });
    assert.notEqual(published.isError, true, JSON.stringify(published));

    const updated = "# Direct Builder Job\n\n## Steps\n1. Updated step.\n";
    const locked = await call("v5_source_update", {
      ...base, content: updated, expected_sha256: sha(source),
    });
    assert.equal(locked.isError, true);
    assert.equal(await fs.readFile(savedPath, "utf8"), source);
    observeExplicitJobUpdateCommand(session, "cg/update");
    activateJobUpdateGrant(session, path.dirname(savedPath));
    const replaced = await call("v5_source_update", {
      ...base, content: updated, expected_sha256: sha(source),
    });
    assert.notEqual(replaced.isError, true, JSON.stringify(replaced));
    assert.equal(await fs.readFile(savedPath, "utf8"), updated);
    assert.equal(replaced.structuredContent?.data?.registry_refreshed, undefined);
    const promoted = await call("v5_source_publish", {
      kind: "job", library_id: "v5builderlib", library_name: "Builder Integration",
    });
    assert.notEqual(promoted.isError, true, JSON.stringify(promoted));
  } finally {
    releaseSessionWork(session);
    revokeSessionAdmissions(session);
  }
});
