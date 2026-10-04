import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("Human Power is execution-scoped and replaces Job-level bypass", async () => {
  const workSource = await fs.readFile(
    new URL("../src/cadgpt/lib/work-registration.ts", import.meta.url),
    "utf8"
  );
  const jobSource = await fs.readFile(
    new URL("../src/cadgpt/tools/jobs.ts", import.meta.url),
    "utf8"
  );
  const hpSource = await fs.readFile(
    new URL("../src/cadgpt/tools/human-power.ts", import.meta.url),
    "utf8"
  );
  const fileSource = await fs.readFile(
    new URL("../src/cadgpt/tools/filesystem.ts", import.meta.url),
    "utf8"
  );

  assert.match(workSource, /interface HumanPowerGrant/);
  assert.match(workSource, /humanPower\?: HumanPowerGrant/);
  assert.match(workSource, /activateHumanPower/);
  assert.match(workSource, /deactivateHumanPower/);
  assert.match(workSource, /consumeHumanPowerCleanup/);
  assert.match(workSource, /humanPowerCleanupPending/);
  assert.match(workSource, /if \(work\.humanPower\) return/);
  assert.match(workSource, /previous\.humanPower/);

  assert.match(hpSource, /"human_power_start"/);
  assert.match(hpSource, /"human_power_status"/);
  assert.match(hpSource, /"human_power_stop"/);

  assert.doesNotMatch(jobSource, /job_human_bypass_record/);
  assert.doesNotMatch(jobSource, /job_human_bypass_clear/);
  assert.doesNotMatch(jobSource, /workflow_bypass/);

  assert.match(fileSource, /human_power_fix/);
  assert.match(fileSource, /auditHumanPowerSourceMutation/);
  assert.match(fileSource, /reloadCadMcpChildIfNeeded/);
});

test("CAD MCP loader has explicit Human Power scope override", async () => {
  const source = await fs.readFile(
    new URL(
      "../runtimes/cad-mcp/services/lisp_service.py",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(source, /def _human_power_enabled/);
  assert.match(source, /CADGPT_HUMAN_POWER/);
  assert.match(source, /virtual_prefix = "human-power"/);
});
