import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

test("job_runtime_prepare rereads promoted Markdown and preserves same-active-Job Steps", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-steps-snapshot-"));
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = root;

  const admission = await import("../dist/cadgpt/lib/admission.js");
  const work = await import("../dist/cadgpt/lib/work-registration.js");
  const jobs = await import("../dist/cadgpt/tools/jobs.js");
  const runtime = await import("../dist/cadgpt/runtime/job-runtime.js");
  const session = "job-steps-snapshot-" + path.basename(root);
  admission.checkAdmission(session, "@cg", "mention");

  const callbacks = new Map();
  jobs.registerJobAuthoringTools({
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
    },
  });
  let execution = null;
  try {
    const sourcePath = path.join(
      root, "workspace", "job-draft", "fixture", "grille-tag", "JOB.md"
    );
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    const originalSource = "# Grille Tag\n\n## Stage 1\nCheck raw data\n";
    await fs.writeFile(sourcePath, originalSource, "utf8");
    execution = work.createWorkRegistration({
      sessionKey: session, ownerType: "job",
      ownerId: "grille-tag", executionPath: "hybrid"
    });
    const prepare = async () => {
      const lease = work.acquireToolLease({
        tool: "job_runtime_prepare", family: "job-authoring",
        executionId: execution.executionId, authorityToken: execution.authorityToken,
        sessionKey: session,
      });
      return work.runWithToolLease(lease, () =>
        callbacks.get("job_runtime_prepare")({ draft_path: sourcePath }));
    };
    const one = await prepare();
    assert.equal(one.structuredContent?.ok, true, JSON.stringify(one));
    const first = one.structuredContent.data;
    assert.equal(first.workflow.content, originalSource);
    assert.equal(first.workflow.source_sha256,
      createHash("sha256").update(originalSource).digest("hex"));
    assert.equal(first.job_steps.path, path.join(path.dirname(sourcePath), "runtime", "JOB_STEPS.md"));

    await fs.writeFile(first.job_steps.path, "- [✓] Check raw\n- [ ] Stage 1\n", "utf8");
    const newSource = "# Grille Tag\n\n## Stage 1\nCheck raw data\n## Stage 2\nLoad Lisp\n";
    await fs.writeFile(sourcePath, newSource, "utf8");
    const two = await prepare();
    assert.equal(two.structuredContent?.ok, true, JSON.stringify(two));
    assert.equal(two.structuredContent.data.workflow.content, newSource,
      "Do not cache or replay older JOB.md content");
    assert.equal(two.structuredContent.data.prior_job_transition?.resumed_same_active_job, true);
    assert.match(await fs.readFile(first.job_steps.path, "utf8"), /\[✓\] Check raw/,
      "same active Job must preserve verified progress");

    await runtime.cleanupJobRuntimeForExecution(execution.executionId);
    assert.match(await fs.readFile(first.job_steps.path, "utf8"), /\[ \] Check raw/,
      "Job finish restores initial checkbox state");
  } finally {
    if (execution && work.activeExecutionForSession(session)) {
      work.releaseWorkRegistration(execution.executionId, execution.authorityToken, session);
    }
    admission.revokeSessionAdmissions(session);
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
