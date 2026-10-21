import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("second chat joins verified Host Anchor without CAD host queue or upstream activation", async () => {
  const source = await fs.readFile(new URL("../src/cadgpt/server-factory.ts", import.meta.url), "utf8");
  const activation = source.slice(source.indexOf("const activateCadWorkspace = async"), source.indexOf("const addinObserverId ="));
  assert.match(activation, /const bound = joinExistingHost/);
  assert.match(activation, /attachPrimaryDrawingForExecution\(work\.executionId\)/);
  assert.match(activation, /attachVerifiedDrawingMetadataReadOnly\(work\.executionId, bound\)/);
  const join = activation.slice(activation.indexOf("const bound = joinExistingHost"), activation.indexOf(": await withCadHostLock", activation.indexOf("const bound = joinExistingHost")));
  assert.doesNotMatch(join, /validatePrimaryBoundDrawing|cadUpstream\.activate/);
  const admission = source.slice(source.indexOf("const { primaryBoundDrawing } =", source.indexOf("registerAdmissionTool(server")), source.indexOf("registerWorkControlTools(server, {"));
  assert.match(admission, /primaryBoundDrawing\(\)/);
  assert.match(admission, /primary\?\.drawing_anchor && primary\.anchor_verified_readback === true/);
  assert.ok(admission.indexOf("const primary = primaryBoundDrawing()") < admission.indexOf("await prepareCadLaunch(sessionKey, {"), "verified join must precede tray probing");
  assert.doesNotMatch(admission, /validatePrimaryBoundDrawing\(/);
});
