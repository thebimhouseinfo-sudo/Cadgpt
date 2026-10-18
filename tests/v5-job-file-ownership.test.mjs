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

test("V5 generic FILE writes fail closed when Work lease is stale or closing", () => {
  const section = source.slice(source.indexOf("function currentWritableRoots()"), source.indexOf("export function assertNotGenericJobResultMutation"));
  assert.match(section, /!currentWork \|\| currentWork\.executionId !== lease\.workId \|\| currentWork\.closing/);
  assert.ok(section.indexOf("currentWork.closing") < section.indexOf("...getWritableRoots()"));
});

test("V5 protects every user-named Job result, not just legacy -result suffix", () => {
  const section = source.slice(source.indexOf("export function assertNotGenericJobResultMutation"),
    source.indexOf("async function assertNotManagedHvacKnowledgeMutation"));
  assert.match(section, /parts\[1\]\.toLowerCase\(\) !== "jobs"/);
  assert.doesNotMatch(section, /endsWith\("-result"\)/);
  assert.match(section, /jobRuntimeWritableRootsForExecution\(currentToolLease\(\)\.workId\)/);
});

test("V5 retains Job runtime owner context until filesystem cleanup succeeds", () => {
  const runtime = fs.readFileSync(path.resolve(import.meta.dirname, "../src/cadgpt/runtime/job-runtime.ts"), "utf8");
  const segment = runtime.slice(runtime.indexOf("export async function cleanupJobRuntimeForExecution("), runtime.indexOf("export async function prepareJobRuntimeForExecution("));
  assert.ok(segment.indexOf("await cleanupJobRuntimeContext(context, executionId, options)") < segment.indexOf("contextsByExecution.delete(executionId)"));
  assert.match(segment, /contextsByExecution\.get\(executionId\) === context/);
});
