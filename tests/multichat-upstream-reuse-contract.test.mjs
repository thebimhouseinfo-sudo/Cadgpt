import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("second chat reuses connected CAD MCP instead of re-activating it", async () => {
  const source = await fs.readFile(new URL("../src/cadgpt/server-factory.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!joinExistingHost \|\| !cadUpstream\.status\(\)\.connected\) \{\s*await cadUpstream\.activate\(\);/);
  assert.match(source, /if \(!cadUpstream\.status\(\)\.connected\) \{\s*await cadUpstream\.activate\(\);\s*\}\s*await validatePrimaryBoundDrawing\(\);/);
  assert.match(source, /attachPrimaryDrawingForExecution\(work\.executionId\)/);
  assert.match(source, /attachVerifiedDrawingMetadataReadOnly\(work\.executionId, attached\)/);
});
