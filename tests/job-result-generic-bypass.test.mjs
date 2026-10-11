import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { assertNotGenericJobResultMutation } from "../dist/cadgpt/tools/filesystem.js";
import * as work from "../dist/cadgpt/lib/work-registration.js";
import { checkAdmission, revokeSessionAdmissions } from "../dist/cadgpt/lib/admission.js";

test("generic file_create/edit/delete cannot bypass approved Job-result patch", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cg-v2-scope-"));
  const old = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tmp;
  const session = "v2-cross-job-file-scope";
  checkAdmission(session, "@cg", "mention");
  const reg = work.createWorkRegistration({
    sessionKey: session, ownerType: "file", ownerId: "temp-one-shot",
    executionPath: "hybrid",
  });
  try {
    const lease = work.acquireToolLease({
      sessionKey: session, executionId: reg.executionId,
      authorityToken: reg.authorityToken, tool: "file_edit", family: "filesystem",
    });
    await work.runWithToolLease(lease, async () => {
      const result = path.join(tmp, "drawings", "valid-anchor",
        "jobs", "grille-tag-result", "data.json");
      assert.throws(() => assertNotGenericJobResultMutation(result),
        /JOB_RESULT_SCOPED_PATCH_REQUIRED/);
      assert.doesNotThrow(() => assertNotGenericJobResultMutation(
        path.join(tmp, "workspace", "temp", "data.json")));
      assert.doesNotThrow(() => assertNotGenericJobResultMutation(
        path.join(tmp, "drawings", "valid-anchor", "knowledge", "notes.json")));
    });
  } finally {
    work.releaseWorkRegistration(reg.executionId, reg.authorityToken, session);
    revokeSessionAdmissions(session);
    if (old === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = old;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
