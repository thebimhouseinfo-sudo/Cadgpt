import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("direct Python Job drafts validate and promote through the controlled Job lifecycle", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-direct-job-"));
  const previousRoot = process.env.CADGPT_APPDATA_ROOT;
  const previousPython = process.env.CAD_MCP_PYTHON;
  const previousSecret = process.env.CADGPT_DIRECT_JOB_TEST_SECRET;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;
  process.env.CAD_MCP_PYTHON = "python";
  process.env.CADGPT_DIRECT_JOB_TEST_SECRET = "must-not-leak";

  const { getAppDataRoot } = await import("../dist/cadgpt/lib/appdata.js");
  assert.equal(path.resolve(getAppDataRoot()), path.resolve(tempRoot));

  const { registerJobAuthoringTools } = await import(
    "../dist/cadgpt/tools/jobs.js"
  );
  const {
    acquireToolLease,
    createWorkRegistration,
    runWithToolLease,
  } = await import("../dist/cadgpt/lib/work-registration.js");
  const { checkAdmission } = await import("../dist/cadgpt/lib/admission.js");

  const callbacks = new Map();
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
    },
  };
  registerJobAuthoringTools(fakeServer);

  try {
    const registryRoot = path.join(tempRoot, "registry", "user");
    const draftRoot = path.join(tempRoot, "workspace", "job-draft");
    const libraryRoot = path.join(tempRoot, "libraries", "jobs", "direct-lib");
    await fs.mkdir(registryRoot, { recursive: true });
    await fs.mkdir(draftRoot, { recursive: true });
    await fs.mkdir(libraryRoot, { recursive: true });
    await fs.writeFile(
      path.join(registryRoot, "libraries.json"),
      JSON.stringify({
        libraries: [{ id: "direct-lib", kind: "job", enabled: true }],
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(registryRoot, "capabilities.json"),
      JSON.stringify({ version: 1, entries: [] }),
      "utf8"
    );

    const directDraft = path.join(draftRoot, "direct-lib", "fixture-direct", "fixture-direct.py");
    await fs.mkdir(path.dirname(directDraft), { recursive: true });
    await fs.writeFile(
      directDraft,
      [
        "import os",
        "drawing = os.environ.get('CADGPT_DRAWING_PATH')",
        "print(drawing or 'no-drawing')",
        "print('secret=' + str(os.environ.get('CADGPT_DIRECT_JOB_TEST_SECRET')))",
        "",
      ].join("\n"),
      "utf8"
    );

    const validate = callbacks.get("job_draft_validate");
    assert.equal(typeof validate, "function");
    const valid = await validate({ path: directDraft });
    assert.equal(
      valid.structuredContent?.data?.valid,
      true,
      JSON.stringify(valid)
    );
    assert.equal(valid.structuredContent?.data?.execution_mode, "direct");
    assert.match(valid.structuredContent?.data?.sha256 ?? "", /^[a-f0-9]{64}$/);

    const scratchRoot = path.join(
      tempRoot,
      "runtime",
      "direct-job"
    );
    const staleScratch = path.join(
      scratchRoot,
      "run-stale"
    );
    await fs.mkdir(staleScratch, { recursive: true });
    await fs.writeFile(
      path.join(
        staleScratch,
        ".cadgpt-direct-job.json"
      ),
      JSON.stringify({
        version: 1,
        execution_id: "exec:dead",
        job_id: "dead-direct",
        process_id: 99999999,
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(staleScratch, "raw.bin"),
      "stale",
      "utf8"
    );

    const sessionKey = "direct-draft-test-session";
    checkAdmission(sessionKey, "@cadgpt", "mention");
    const work = createWorkRegistration({
      sessionKey,
      ownerType: "file",
      ownerId: "job-authoring",
      executionPath: "file",
    });
    const lease = acquireToolLease({
      tool: "job_run_direct_draft",
      family: "job-authoring",
      targetId: directDraft,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    const runDraft = callbacks.get("job_run_direct_draft");
    assert.equal(typeof runDraft, "function");
    const draftRun = await runWithToolLease(lease, () =>
      runDraft({
        draft_path: directDraft,
        expected_sha256: valid.structuredContent.data.sha256,
        args: [],
      })
    );
    assert.equal(draftRun.structuredContent?.data?.validation_passed, true);
    const directStdout = String(
      draftRun.structuredContent?.data?.stdout ?? ""
    );
    assert.match(directStdout, /no-drawing/);
    assert.match(directStdout, /secret=None/);
    assert.equal(
      draftRun.structuredContent?.data?.file_output,
      "forbidden"
    );
    assert.equal(
      draftRun.structuredContent?.data?.scratch_cleaned,
      true
    );
    assert.equal(
      await fs
        .stat(staleScratch)
        .then(() => true, () => false),
      false,
      "a new Direct Job run must prune orphaned scratch from a dead execution"
    );

    const dataDraft = path.join(
      draftRoot,
      "direct-lib",
      "writes-data",
      "writes-data.py"
    );
    await fs.mkdir(path.dirname(dataDraft), { recursive: true });
    await fs.writeFile(
      dataDraft,
      [
        "from pathlib import Path",
        "Path('raw.json').write_text('raw', encoding='utf-8')",
        "Path(__file__).with_name('beside.json').write_text('raw', encoding='utf-8')",
        "print('done')",
        "",
      ].join("\n"),
      "utf8"
    );
    const dataValid = await validate({ path: dataDraft });
    assert.equal(dataValid.structuredContent?.data?.valid, true);
    const dataLease = acquireToolLease({
      tool: "job_run_direct_draft",
      family: "job-authoring",
      targetId: dataDraft,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });
    const dataRun = await runWithToolLease(dataLease, () =>
      runDraft({
        draft_path: dataDraft,
        expected_sha256:
          dataValid.structuredContent.data.sha256,
        args: [],
      })
    );
    assert.equal(dataRun.isError, true, JSON.stringify(dataRun));
    assert.match(
      JSON.stringify(dataRun),
      /DIRECT_JOB_DATA_FORBIDDEN/
    );
    assert.equal(
      await fs
        .stat(path.join(path.dirname(dataDraft), "raw.json"))
        .then(() => true, () => false),
      false,
      "Direct Job CWD output must not persist beside its definition"
    );
    assert.equal(
      await fs
        .stat(path.join(path.dirname(dataDraft), "beside.json"))
        .then(() => true, () => false),
      false,
      "Direct Job __file__ output must resolve inside disposable scratch rather than beside its definition"
    );
    assert.deepEqual(
      await fs.readdir(scratchRoot),
      [],
      "Direct Job scratch must be removed even when file output is rejected"
    );

    const invalidDraft = path.join(
      draftRoot,
      "direct-lib",
      "broken",
      "broken.py"
    );
    await fs.mkdir(path.dirname(invalidDraft), { recursive: true });
    await fs.writeFile(invalidDraft, "def broken(:\n", "utf8");
    const invalid = await validate({ path: invalidDraft });
    assert.equal(invalid.structuredContent?.data?.valid, false);
    assert.equal(invalid.structuredContent?.data?.execution_mode, "direct");
    assert.match(
      (invalid.structuredContent?.data?.diagnostics ?? []).join("\n"),
      /syntax validation failed/i
    );

    const target = path.join(
      libraryRoot,
      "fixture-direct",
      "fixture-direct.py"
    );
    const promote = callbacks.get("job_promote_draft");
    assert.equal(typeof promote, "function");
    const promoted = await promote({
      draft_path: directDraft,
      target_path: target,
      library_id: "direct-lib",
      relative_path: "fixture-direct/fixture-direct.py",
      metadata: {
        id: "fixture-direct",
        title: "Fixture Direct",
        class_name: "workflow.user",
        subclass: "direct",
        tags: ["fixture", "direct"],
        summary: "Direct Job fixture",
        status: "active",
        risk: "medium",
      },
      overwrite: false,
      test_evidence: "fixture direct Job syntax/test path passed",
      final_validation_evidence: "fixture output contract verified",
      user_accepted: true,
    });
    assert.equal(
      promoted.structuredContent?.data?.execution_mode,
      "direct",
      JSON.stringify(promoted)
    );
    assert.equal(promoted.structuredContent?.data?.registry_id, "fixture-direct");
    assert.equal(
      await fs.readFile(target, "utf8"),
      await fs.readFile(directDraft, "utf8")
    );

    const reservedTarget = path.join(libraryRoot, "reserved", "reserved.py");
    const reserved = await promote({
      draft_path: directDraft,
      target_path: reservedTarget,
      library_id: "direct-lib",
      relative_path: "reserved/reserved.py",
      metadata: {
        id: "tbh",
        title: "Reserved TBH Override",
        class_name: "workflow.user",
        subclass: "direct",
        tags: ["reserved"],
        summary: "Must be rejected because tbh is an Internal Job id.",
        status: "active",
        risk: "medium",
      },
      overwrite: false,
      test_evidence: "fixture",
      final_validation_evidence: "fixture",
      user_accepted: true,
    });
    assert.equal(reserved.isError, true, JSON.stringify(reserved));
    assert.match(
      JSON.stringify(reserved),
      /INTERNAL_JOB_ID_RESERVED/
    );

    const registry = JSON.parse(
      await fs.readFile(path.join(registryRoot, "capabilities.json"), "utf8")
    );
    const entry = registry.entries.find((item) => item.id === "fixture-direct");
    assert.equal(entry?.relative_path, "fixture-direct/fixture-direct.py");
    assert.equal(entry?.execution_mode, "direct");

    const reasoningDraft = path.join(
      draftRoot,
      "direct-lib",
      "reasoning",
      "JOB.md"
    );
    await fs.mkdir(path.dirname(reasoningDraft), { recursive: true });
    await fs.writeFile(
      reasoningDraft,
      [
        "# Job: Reasoning Fixture",
        "## Goal",
        "Test",
        "## Preconditions",
        "Ready",
        "## Step 1",
        "available_tools: job_list",
        "success_criteria: listed",
        "failure_handling: stop",
        "output: list",
        "## Validation",
        "Verify list",
        "",
      ].join("\n"),
      "utf8"
    );
    const reasoning = await validate({ path: reasoningDraft });
    assert.equal(
      reasoning.structuredContent?.data?.valid,
      true,
      JSON.stringify(reasoning)
    );
    assert.equal(
      reasoning.structuredContent?.data?.execution_mode,
      "reasoning"
    );
  } finally {
    if (previousRoot === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previousRoot;
    if (previousPython === undefined) delete process.env.CAD_MCP_PYTHON;
    else process.env.CAD_MCP_PYTHON = previousPython;
    if (previousSecret === undefined) {
      delete process.env.CADGPT_DIRECT_JOB_TEST_SECRET;
    } else {
      process.env.CADGPT_DIRECT_JOB_TEST_SECRET = previousSecret;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
