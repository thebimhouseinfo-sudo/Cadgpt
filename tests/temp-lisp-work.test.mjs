import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { registerTempLispTools } from "../dist/cadgpt/tools/temp-lisp.js";
import * as work from "../dist/cadgpt/lib/work-registration.js";
import { checkAdmission, revokeSessionAdmissions } from "../dist/cadgpt/lib/admission.js";

test("Temp Lisp uses shared runtime, exact Work owner and no Job lifecycle", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cg-temp-lisp-"));
  const old = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = temp;
  const session = "v2-temp-lisp";
  checkAdmission(session, "@cg", "mention");
  const current = work.createWorkRegistration({
    sessionKey: session, ownerType: "file", ownerId: "ordinary", executionPath: "hybrid",
  });
  const tools = new Map();
  registerTempLispTools({ registerTool(name, _config, cb) { tools.set(name, cb); } });
  try {
    const lease = work.acquireToolLease({
      sessionKey: session, tool: "file_temp_lisp_create", family: "filesystem",
      executionId: current.executionId, authorityToken: current.authorityToken,
    });
    await work.runWithToolLease(lease, async () => {
      const source = "(defun c:CGTEST () (princ))";
      const created = await tools.get("file_temp_lisp_create")({ source });
      assert.equal(created.structuredContent?.ok, true, JSON.stringify(created));
      const data = created.structuredContent.data;
      assert.deepEqual(data.commands, ["CGTEST"]);
      assert.equal(data.loaded, false);
      assert.equal(await fs.readFile(data.absolute_path, "utf8"), source);
      assert.equal(path.dirname(data.absolute_path), path.join(temp, "runtime", "dynamic-lisp"));
      const fake = await tools.get("file_temp_lisp_cleanup")({
        file_name: "../" + data.file_name, expected_sha256: data.sha256,
      });
      assert.equal(fake.structuredContent?.ok, false);
      const wrongHash = await tools.get("file_temp_lisp_cleanup")({
        file_name: data.file_name, expected_sha256: "0".repeat(64),
      });
      assert.equal(wrongHash.structuredContent?.ok, false);
      const deleted = await tools.get("file_temp_lisp_cleanup")({
        file_name: data.file_name, expected_sha256: data.sha256,
      });
      assert.equal(deleted.structuredContent?.ok, true, JSON.stringify(deleted));
      await assert.rejects(fs.stat(data.absolute_path), { code: "ENOENT" });
    });
    assert.equal(work.activeWorkForSession(session)?.executionId, current.executionId);
  } finally {
    work.releaseWorkRegistration(current.executionId, current.authorityToken, session);
    revokeSessionAdmissions(session);
    if (old === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = old;
    await fs.rm(temp, { recursive: true, force: true });
  }
});
