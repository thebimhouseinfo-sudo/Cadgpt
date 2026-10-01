import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("repository root has no appdata directory", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "appdata")), false);
});

test("scripts do not fall back to repo-local appdata", () => {
  for (const file of ["openai-tunnel.ps1", "acceptance.ps1", "cadgpt-tray.ps1"]) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /ScriptDir\s+["']appdata\\/i);
    assert.doesNotMatch(source, /else\s*\{\s*["']appdata["']\s*\}/i);
  }
});

test("AppData resolver rejects explicit repo-root appdata overrides", async () => {
  const appdata = await import("../dist/cadgpt/lib/appdata.js");
  const previous = process.env.CADGPT_APPDATA_ROOT;
  try {
    process.env.CADGPT_APPDATA_ROOT = path.join(repoRoot, "appdata", "nested");
    assert.throws(() => appdata.getAppDataRoot(), /CADGPT_APPDATA_ROOT_REPO_LOCAL_FORBIDDEN/);
  } finally {
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
  }
});
