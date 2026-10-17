import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-v5-temp-"));
const previous = process.env.CADGPT_APPDATA_ROOT;
process.env.CADGPT_APPDATA_ROOT = root;
const { checkAdmission, revokeSessionAdmissions } = await import("../dist/cadgpt/lib/admission.js");
const { createWorkRegistration, releaseSessionWork } = await import("../dist/cadgpt/lib/work-registration.js");
const { createTempJob, writeTempSource, updateTempSource, finishTempJob, clearTempJobs } =
  await import("../dist/cadgpt/runtime/temp-job-v5.js");

test.after(async () => {
  if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
  else process.env.CADGPT_APPDATA_ROOT = previous;
  await fs.rm(root, { recursive: true, force: true });
});

test("V5 Temp job Builder creates, fixes, finishes, then safely cleans", async () => {
  const session = "v5-temp-session";
  checkAdmission(session, "@cg", "mention");
  const work = createWorkRegistration({
    sessionKey: session, ownerType: "file", ownerId: "job-authoring",
    executionPath: "hybrid",
  });
  try {
    const a = await createTempJob(work.executionId, session);
    const b = await createTempJob(work.executionId, session);
    assert.notEqual(a.id, b.id);
    const written = await writeTempSource(a.id, work.executionId, session, "lisp/foo.lsp", "(princ)");
    assert.match(written.path, /foo\.lsp$/);
    await assert.rejects(
      writeTempSource(a.id, work.executionId, session, "lisp/foo.lsp", "(princ)"),
      /EEXIST/
    );
    await assert.rejects(
      writeTempSource(a.id, work.executionId, session, "../escape.lsp", "bad"),
      /V5_SOURCE_OUTSIDE_OWNER/
    );
    const wrongSha = "0".repeat(64);
    await assert.rejects(updateTempSource(a.id, work.executionId, session, "lisp/foo.lsp", "(princ 2)", wrongSha), /TEMP_JOB_SOURCE_CONFLICT/);
    const sha = createHash("sha256").update("(princ)").digest("hex");
    await updateTempSource(a.id, work.executionId, session, "lisp/foo.lsp", "(princ 2)", sha);
    assert.equal(await fs.readFile(path.join(a.root, "lisp", "foo.lsp"), "utf8"), "(princ 2)");
    await finishTempJob(a.id, work.executionId, session);
    const premature = await clearTempJobs(a.id);
    assert.deepEqual(premature.removed, []);
    assert.equal(premature.skipped.length, 1);
    await assert.rejects(writeTempSource(a.id, work.executionId, session, "next.lsp", "x"), /TEMP_JOB_ALREADY_DONE/);
    await assert.rejects(writeTempSource(b.id, "other-work", session, "wrong.lsp", "x"), /TEMP_JOB_NOT_OWNED/);
  } finally {
    releaseSessionWork(session);
    revokeSessionAdmissions(session);
  }
  const clean = await clearTempJobs();
  assert.equal(clean.removed.length, 1);
  assert.equal(clean.skipped.length, 1); // unfinished B must be preserved
});
