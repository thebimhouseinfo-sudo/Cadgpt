import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

test("Existing Job editing requires exact cg/jobupdate and cannot target another Job", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-jobupdate-"));
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;
  const session = "jobupdate-command-test";
  try {
    const { checkAdmission, revokeSessionAdmissions } = await import("../dist/cadgpt/lib/admission.js");
    const workApi = await import("../dist/cadgpt/lib/work-registration.js");
    const grants = await import("../dist/cadgpt/runtime/job-update-grant.js");
    const { registerAdmissionTool } = await import("../dist/cadgpt/tools/admission.js");
    const { registerV5BuilderSourceTools } = await import("../dist/cadgpt/tools/v5-builder-source.js");
    const { registerCadGptControlTool } = await import("../dist/cadgpt/tools/control.js");
    const { getJobLibrariesRoot } = await import("../dist/cadgpt/lib/appdata.js");
    const handlers = new Map();
    const server = { registerTool(name, _schema, handler) { handlers.set(name, handler); } };

    const folder = path.join(getJobLibrariesRoot(), "existing", "job-a");
    const other = path.join(getJobLibrariesRoot(), "existing", "job-b");
    await fs.mkdir(folder, { recursive: true });
    await fs.mkdir(other, { recursive: true });
    const source = "# Existing Job\n";
    await fs.writeFile(path.join(folder, "JOB.md"), source);
    await fs.writeFile(path.join(other, "JOB.md"), source);
    checkAdmission(session, "@cg", "mention");
    const work = workApi.createWorkRegistration({
      sessionKey: session, ownerType: "skill", ownerId: "job-authoring", executionPath: "file",
    });
    registerAdmissionTool(server, {
      sessionKey: session,
      onActive: async () => ({}),
    });
    registerCadGptControlTool(server, {
      sessionKey: session,
      getCadState: async () => "ON",
      launchCadWorkspace: async () => "",
      listJobs: async () => "",
      stopCurrentJob: async () => ({ stopped: false, detail: "" }),
      stopCurrentWork: async () => ({ stopped: false, pending: false }),
      authorizeJobUpdate: async (libraryId, name) => {
        grants.activateJobUpdateGrant(session, path.join(getJobLibrariesRoot(), libraryId, name));
        return "AUTHORIZED";
      },
    });
    registerV5BuilderSourceTools(server);
    const sha = createHash("sha256").update(source).digest("hex");
    const request = async (folderName, contents) => {
      const lease = workApi.acquireToolLease({
        sessionKey: session, executionId: work.executionId,
        authorityToken: work.authorityToken, tool: "v5_source_update", family: "filesystem",
      });
      return workApi.runWithToolLease(lease, () => handlers.get("v5_source_update")({
        kind: "reusable-job", library_id: "existing", folder: folderName,
        relative_file: "JOB.md", content: contents, expected_sha256: sha,
      }));
    };
    const denied = await request("job-a", "# Spoofed Owner\n");
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied), /JOB_UPDATE_EXPLICIT_COMMAND_REQUIRED/);
    assert.equal(grants.observeExplicitJobUpdateCommand(session, "hãy sửa job"), false);
    assert.throws(() => grants.activateJobUpdateGrant(session, folder), /JOB_UPDATE_EXPLICIT_COMMAND_REQUIRED/);

    await handlers.get("cadgpt_admission")({ user_turn: "cg/jobupdate", invocation_source: "plugin" });
    const activated = await handlers.get("cadgpt_control")({
      surface: "jobupdate", job_library_id: "existing", job_folder: "job-a",
    });
    assert.equal(activated.structuredContent.text, "AUTHORIZED");
    const wrong = await request("job-b", "# Wrong Job\n");
    assert.equal(wrong.isError, true);
    assert.match(JSON.stringify(wrong), /JOB_UPDATE_EXPLICIT_COMMAND_REQUIRED/);
    const accepted = await request("job-a", "# Updated Job\n");
    assert.notEqual(accepted.isError, true, JSON.stringify(accepted));
    assert.equal(await fs.readFile(path.join(folder, "JOB.md"), "utf8"), "# Updated Job\n");
    assert.equal(await fs.readFile(path.join(other, "JOB.md"), "utf8"), source);
    grants.clearJobUpdateGrantForExecution(work.executionId);
    assert.equal(grants.hasJobUpdateGrantForWork(session, work.executionId), false);
    workApi.releaseSessionWork(session);
    revokeSessionAdmissions(session);
  } finally {
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
