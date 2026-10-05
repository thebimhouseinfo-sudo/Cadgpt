import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("sequential Job start releases stale foreground/SYSTEM authority without deleting pending runtime data", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-job-transition-")
  );
  const previous =
    process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const {
    checkAdmission,
    revokeSessionAdmissions,
  } = await import(
    "../dist/cadgpt/lib/admission.js"
  );
  const {
    createWorkRegistration,
    releaseWorkRegistration,
  } = await import(
    "../dist/cadgpt/lib/work-registration.js"
  );
  const runtime = await import(
    "../dist/cadgpt/runtime/job-runtime.js"
  );
  const system = await import(
    "../dist/cadgpt/runtime/system-lease.js"
  );
  const {
    releasePriorJobAuthorityForStart,
  } = await import(
    "../dist/cadgpt/runtime/job-transition.js"
  );

  const sessionKey =
    "job-transition-session";
  checkAdmission(
    sessionKey,
    "@cg",
    "mention"
  );

  try {
    const jobA = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "fixture",
      "job-a",
      "JOB.md"
    );
    const jobB = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "fixture",
      "job-b",
      "JOB.md"
    );
    await fs.mkdir(
      path.dirname(jobA),
      { recursive: true }
    );
    await fs.mkdir(
      path.dirname(jobB),
      { recursive: true }
    );
    await fs.writeFile(
      jobA,
      "# Job: A\n",
      "utf8"
    );
    await fs.writeFile(
      jobB,
      "# Job: B\n",
      "utf8"
    );

    const work =
      createWorkRegistration({
        sessionKey,
        ownerType: "job",
        ownerId: "job-sequence",
        executionPath: "file",
      });

    const preparedA =
      await runtime.prepareJobRuntimeForExecution(
        work.executionId,
        "job-a",
        jobA,
        { resetRuntime: false }
      );
    const foregroundRaw =
      path.join(
        preparedA.runtime_root,
        "foreground-raw.json"
      );
    await fs.writeFile(
      foregroundRaw,
      "{}\n",
      "utf8"
    );

    const foregroundTransition =
      await releasePriorJobAuthorityForStart({
        executionId:
          work.executionId,
        sessionKey,
      });
    assert.equal(
      foregroundTransition.foreground
        .active,
      true
    );
    assert.equal(
      await fs.readFile(
        foregroundRaw,
        "utf8"
      ),
      "{}\n"
    );
    assert.equal(
      runtime.activeJobRuntimeForExecution(
        work.executionId
      ),
      null
    );

    const resumedA =
      await runtime.prepareJobRuntimeForExecution(
        work.executionId,
        "job-a",
        jobA,
        { resetRuntime: false }
      );
    assert.equal(
      resumedA.recovery_pending,
      true
    );

    const lease =
      system.acquireJobSystemLease({
        toolId: "job-a",
        jobId: "job-a",
        jobName: "Job A",
        sessionKey,
        readableRoots: [],
        writableRoots: [
          resumedA.runtime_root,
        ],
      });
    runtime.detachJobRuntimeForSystemLease(
      work.executionId,
      lease.tool_id
    );
    const systemRaw =
      path.join(
        resumedA.runtime_root,
        "system-raw.json"
      );
    await fs.writeFile(
      systemRaw,
      "{\"pending\":true}\n",
      "utf8"
    );

    const systemTransition =
      await releasePriorJobAuthorityForStart({
        executionId:
          work.executionId,
        sessionKey,
      });
    assert.deepEqual(
      systemTransition.released_system_jobs.map(
        (item) => item.job_id
      ),
      ["job-a"]
    );
    assert.deepEqual(
      system.activeJobSystemLeasesForSession(
        sessionKey
      ),
      []
    );
    assert.equal(
      await fs.readFile(
        systemRaw,
        "utf8"
      ),
      "{\"pending\":true}\n"
    );

    const preparedB =
      await runtime.prepareJobRuntimeForExecution(
        work.executionId,
        "job-b",
        jobB,
        { resetRuntime: false }
      );
    assert.equal(
      preparedB.job_id,
      "job-b"
    );
    assert.equal(
      preparedB.recovery_pending,
      false
    );
    assert.equal(
      await fs.readFile(
        foregroundRaw,
        "utf8"
      ),
      "{}\n"
    );
    assert.equal(
      await fs.readFile(
        systemRaw,
        "utf8"
      ),
      "{\"pending\":true}\n"
    );

    await runtime.cleanupJobRuntimeForExecution(
      work.executionId
    );
    releaseWorkRegistration(
      work.executionId,
      work.authorityToken,
      sessionKey
    );
  } finally {
    revokeSessionAdmissions(
      sessionKey
    );
    if (previous === undefined) {
      delete process.env
        .CADGPT_APPDATA_ROOT;
    } else {
      process.env.CADGPT_APPDATA_ROOT =
        previous;
    }
    await fs.rm(tempRoot, {
      recursive: true,
      force: true,
    });
  }
});
