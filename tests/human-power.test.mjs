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

  const upstreamSource = await fs.readFile(
    new URL("../src/cadgpt/runtime/cad-upstream.ts", import.meta.url),
    "utf8"
  );
  assert.match(upstreamSource, /connectedExecutionId/);
  assert.match(upstreamSource, /connectedHumanPower/);
  assert.match(upstreamSource, /contextChanged/);
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


test("Human Power control is reachable through the stable cadgpt_admission surface", async () => {
  const {
    parseHumanPowerControl,
    registerAdmissionTool,
  } = await import(
    "../dist/cadgpt/tools/admission.js"
  );

  assert.equal(
    parseHumanPowerControl("human power on"),
    "start"
  );
  assert.equal(
    parseHumanPowerControl("bật Human Power"),
    "start"
  );
  assert.equal(
    parseHumanPowerControl("human power off"),
    "stop"
  );
  assert.equal(
    parseHumanPowerControl("trạng thái human power"),
    "status"
  );
  assert.equal(
    parseHumanPowerControl("normal CAD task"),
    null
  );

  const callbacks = new Map();
  registerAdmissionTool(
    {
      registerTool(name, _config, callback) {
        callbacks.set(name, callback);
        return { remove() {} };
      },
    },
    {
      sessionKey:
        "human-power-admission-test",
      onActive: async () => ({}),
      onHumanPowerControl: async ({
        action,
      }) => ({
        action,
        active: action === "start",
      }),
    }
  );

  const admission = callbacks.get(
    "cadgpt_admission"
  );
  assert.equal(typeof admission, "function");

  await admission({
    user_turn: "@cg",
    invocation_source: "mention",
  });
  const result = await admission({
    user_turn: "human power on",
    invocation_source: "mention",
  });
  assert.equal(
    result.structuredContent?.data
      ?.human_power_control?.action,
    "start",
    JSON.stringify(result)
  );
  assert.equal(
    result.structuredContent?.data
      ?.human_power_control?.active,
    true
  );

  const serverFactorySource =
    await fs.readFile(
      new URL(
        "../src/cadgpt/server-factory.ts",
        import.meta.url
      ),
      "utf8"
    );
  assert.match(
    serverFactorySource,
    /onHumanPowerControl/
  );
  assert.match(
    serverFactorySource,
    /activateHumanPowerForExecution/
  );
  assert.match(
    serverFactorySource,
    /HUMAN POWER CONTROL ROUTING/
  );

  const workSource = await fs.readFile(
    new URL(
      "../src/cadgpt/lib/work-registration.ts",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(
    workSource,
    /activateHumanPowerForExecution/
  );
  assert.match(
    workSource,
    /deactivateHumanPowerForExecution/
  );
});
