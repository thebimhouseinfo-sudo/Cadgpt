import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/cadgpt/tools/filesystem.ts"), "utf8");

test("V5 Job Work never regains generic workspace/data write permission after runtime finish", () => {
  const section = source.slice(source.indexOf("function currentWritableRoots()"), source.indexOf("export function assertNotGenericJobResultMutation"));
  assert.match(section, /currentWork\?\.executionId === lease\.workId && currentWork\.ownerType === "job"/);
  assert.match(section, /return \[\.\.\.new Set\(jobRoots\)\]/);
  assert.ok(section.indexOf('currentWork.ownerType === "job"') < section.indexOf("...getWritableRoots()"));
});
