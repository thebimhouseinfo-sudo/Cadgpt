import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

test("strict Custom Job execution harness stays generic and limited to established workflows", async () => {
  const harness = await fs.readFile(
    path.join(root, "knowledge", "cad", "WORKFLOW_EXECUTION_HARNESS.md"),
    "utf8"
  );
  assert.match(harness, /only while executing a registered Custom Job/i);
  assert.match(harness, /current promoted Job workflow/i);
  assert.match(harness, /Execute; do not redesign/i);
  assert.match(harness, /only checks explicitly required by the selected workflow/i);
  assert.match(harness, /does not require a separate post-action check/i);
  assert.match(harness, /tool-reported failure/i);
  assert.match(harness, /platform safety/i);
  assert.doesNotMatch(harness, /CLG|peno|grille|drawn-map|300x300/i);
  assert.doesNotMatch(harness, /Apply it to an already selected Custom Job branch, approved Temp Job/i);
});

test("strict Custom Job execution harness is loaded into MCP instructions with scope precedence", async () => {
  const source = await fs.readFile(
    path.join(root, "src", "cadgpt", "server-factory.ts"),
    "utf8"
  );
  assert.match(source, /function loadStrictCustomJobHarness\(\)/);
  assert.match(source, /WORKFLOW_EXECUTION_HARNESS\.md/);
  assert.match(source, /const strictCustomJobHarness = loadStrictCustomJobHarness\(\)/);
  assert.match(source, /STRICT CUSTOM JOB EXECUTION — highest priority/);
  assert.match(source, /Once the workflow branch is established, STRICT CUSTOM JOB EXECUTION has precedence/);
  assert.doesNotMatch(source, /Re-plan\/review later stages from the new drawing state/);
  assert.doesNotMatch(source, /For normal HVAC design, tagging, grouping and Job reasoning, consult relevant persisted HVAC knowledge using knowledge_list\/read \(global plus the exact bound drawing when available\) before relying on a convention/);
});

test("strict execution scope does not alter Custom Job compatibility fingerprint inputs", async () => {
  const source = await fs.readFile(
    path.join(root, "src", "cadgpt", "lib", "job-local-compat.ts"),
    "utf8"
  );
  assert.match(source, /JOB_LOCAL_COMPAT_EPOCH = 2/);
  assert.doesNotMatch(source, /WORKFLOW_EXECUTION_HARNESS\.md/);
});
