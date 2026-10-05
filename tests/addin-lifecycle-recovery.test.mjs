import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const sessionManager = await fs.readFile(
  new URL(
    "../src/cadgpt/lib/mcp-session-manager.ts",
    import.meta.url
  ),
  "utf8"
);
const indexSource = await fs.readFile(
  new URL(
    "../src/index.ts",
    import.meta.url
  ),
  "utf8"
);
const tray = await fs.readFile(
  new URL(
    "../cadgpt-tray.ps1",
    import.meta.url
  ),
  "utf8"
);

test("active add-in logical sessions are pinned outside MCP TTL cleanup", () => {
  assert.match(
    sessionManager,
    /isLogicalSessionPinned/
  );
  assert.match(
    sessionManager,
    /if \(\s*isLogicalSessionPinned\(\s*logicalKey\s*\)\s*\)\s*\{\s*continue;/
  );
  assert.match(
    indexSource,
    /isLogicalSessionPinned:\s*isAddinManagedSession/
  );
});

test("unknown stale MCP transport can cold-bootstrap only from connector conversation identity", () => {
  assert.match(
    sessionManager,
    /logicalConversationKeyFromRequest\(req\)/
  );
  assert.match(
    sessionManager,
    /session_manager_cold_recovery_identity_missing/
  );
  assert.match(
    sessionManager,
    /session_cold_recovered/
  );
  assert.match(
    sessionManager,
    /await build\(\s*id,\s*logicalKey,\s*true\s*\)/
  );
});

test("tray self-heal waits for repeated failures and only stops CadGPT-owned components", () => {
  assert.match(
    tray,
    /RuntimeHealthFailures\s*\+=\s*1/
  );
  assert.match(
    tray,
    /RuntimeHealthFailures\s*-lt\s*3/
  );
  assert.match(
    tray,
    /Stop-OwnedCadGptComponent/
  );
  assert.match(
    tray,
    /Stop-OwnedTunnelComponent/
  );
  assert.match(
    tray,
    /selfHealTimer\.Interval\s*=\s*15000/
  );
  assert.doesNotMatch(
    tray,
    /Stop-Process[^\n]*acad/i
  );
});
