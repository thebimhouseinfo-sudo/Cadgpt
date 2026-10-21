import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "v5-temp-py-"));
const oldRoot = process.env.CADGPT_APPDATA_ROOT;
const oldPython = process.env.CAD_MCP_PYTHON;
process.env.CADGPT_APPDATA_ROOT = tmp;
process.env.CAD_MCP_PYTHON = "python";

const { checkAdmission, revokeSessionAdmissions } = await import("../dist/cadgpt/lib/admission.js");
const { createWorkRegistration, releaseSessionWork } = await import("../dist/cadgpt/lib/work-registration.js");
const { createTempJob, writeTempSource, finishTempJob } = await import("../dist/cadgpt/runtime/temp-job-v5.js");
const { runOwnedTempPython } = await import("../dist/cadgpt/runtime/temp-python-v5.js");

test.after(async () => {
  if (oldRoot === undefined) delete process.env.CADGPT_APPDATA_ROOT;
  else process.env.CADGPT_APPDATA_ROOT = oldRoot;
  if (oldPython === undefined) delete process.env.CAD_MCP_PYTHON;
  else process.env.CAD_MCP_PYTHON = oldPython;
  await fs.rm(tmp, { recursive: true, force: true });
});

test("V5 Temp Python runs only owned, hash-verified source with JSON input", async () => {
  const session = "v5-temp-python-session";
  checkAdmission(session, "@cg", "mention");
  const work = createWorkRegistration({
    sessionKey: session, ownerType: "file",
    ownerId: "job-authoring", executionPath: "file",
  });
  try {
    const job = await createTempJob(work.executionId, session);
    const created = await writeTempSource(job.id, work.executionId, session, "tools/report.py",
      "import sys, json\nprint(json.load(open(sys.argv[1]))['name'])\n");
    const args = {
      id: job.id, execution: work.executionId, session,
      relativeFile: "tools/report.py", expectedSha256: created.sha256,
      inputJson: '{"name":"BOUND_TEMP"}',
    };
    const ran = await runOwnedTempPython(args);
    assert.equal(ran.exit_code, 0);
    assert.match(ran.stdout, /BOUND_TEMP/);
    await assert.rejects(
      runOwnedTempPython({ ...args, expectedSha256: "0".repeat(64) }),
      /TEMP_PYTHON_SOURCE_CONFLICT/
    );
    await finishTempJob(job.id, work.executionId, session);
    await assert.rejects(runOwnedTempPython(args), /TEMP_JOB_ALREADY_DONE/);
  } finally {
    releaseSessionWork(session);
    revokeSessionAdmissions(session);
  }
});
