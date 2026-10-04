import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("human workflow bypass is logged, flagged, surfaced, and explicitly cleared", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-human-bypass-")
  );
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const callbacks = new Map();
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
      return { remove() {} };
    },
  };

  try {
    const { registerJobAuthoringTools } = await import(
      "../dist/cadgpt/tools/jobs.js"
    );
    registerJobAuthoringTools(fakeServer);

    const draft = path.join(
      tempRoot,
      "workspace",
      "job-draft",
      "test-lib",
      "test-job",
      "JOB.md"
    );
    await fs.mkdir(path.dirname(draft), { recursive: true });
    await fs.writeFile(
      draft,
      [
        "# Job: Test Human Bypass",
        "",
        "## Goal",
        "Exercise the bypass lifecycle.",
        "",
        "## Preconditions",
        "A managed draft exists.",
        "",
        "## Step 1",
        "Instruction: run one test step.",
        "Success criteria: evidence exists.",
        "Failure handling: stop and report.",
        "Preferred tools: test tool.",
        "Output: test evidence.",
        "",
        "## Validation",
        "Confirm the result.",
        "",
      ].join("\n"),
      "utf8"
    );

    const record = callbacks.get("job_human_bypass_record");
    const clear = callbacks.get("job_human_bypass_clear");
    const validate = callbacks.get("job_draft_validate");
    assert.ok(record);
    assert.ok(clear);
    assert.ok(validate);

    const recorded = await record({
      draft_path: draft,
      job_id: "test-human-bypass",
      workflow_gate: "J5",
      reason: "The workflow gate is temporarily stricter than the real capability.",
      observed_behavior: "The Job is blocked by a workflow contract.",
      expected_behavior: "Human-approved temporary continuation is allowed and recorded.",
      error_evidence: "TEST_WORKFLOW_GATE_BLOCK",
      workaround: "Continue only around J5.",
      human_approved: true,
    });
    assert.equal(recorded.isError, undefined, JSON.stringify(recorded));
    assert.equal(
      recorded.structuredContent?.data?.workflow_bypass,
      true
    );

    const sidecar = path.join(
      path.dirname(draft),
      ".cadgpt-workflow-bypass.json"
    );
    const bypass = JSON.parse(await fs.readFile(sidecar, "utf8"));
    assert.equal(bypass.status, "ACTIVE");
    assert.equal(bypass.workflow_gate, "J5");

    const validationWhileActive = await validate({ path: draft });
    assert.equal(
      validationWhileActive.structuredContent?.data?.workflow_bypass,
      true
    );
    assert.equal(
      validationWhileActive.structuredContent?.data?.workflow_bypass_status,
      "ACTIVE"
    );

    const cleared = await clear({
      draft_path: draft,
      bypass_id: bypass.bypass_id,
      workflow_fix_evidence: "Platform workflow updated.",
      final_validation_evidence: "Job passed normal validation without bypass.",
      human_approved: true,
    });
    assert.equal(cleared.isError, undefined, JSON.stringify(cleared));
    const clearedSidecar = JSON.parse(
      await fs.readFile(sidecar, "utf8")
    );
    assert.equal(clearedSidecar.status, "CLEARED");
    assert.equal(clearedSidecar.bypass_id, bypass.bypass_id);
    assert.match(
      clearedSidecar.workflow_fix_evidence,
      /Platform workflow updated/
    );

    const validationAfterClear = await validate({ path: draft });
    assert.equal(
      validationAfterClear.structuredContent?.data?.workflow_bypass,
      false
    );
    assert.equal(
      validationAfterClear.structuredContent?.data
        ?.workflow_bypass_status,
      "CLEARED"
    );

    const logPath = path.join(
      tempRoot,
      "logs",
      "workflow-bypass.jsonl"
    );
    const logLines = (await fs.readFile(logPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(logLines.length, 2);
    assert.equal(logLines[0].event, "HUMAN_BYPASS_ACTIVATED");
    assert.equal(logLines[1].event, "HUMAN_BYPASS_CLEARED");
    assert.equal(logLines[0].bypass_id, logLines[1].bypass_id);
  } finally {
    if (previous === undefined) {
      delete process.env.CADGPT_APPDATA_ROOT;
    } else {
      process.env.CADGPT_APPDATA_ROOT = previous;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
