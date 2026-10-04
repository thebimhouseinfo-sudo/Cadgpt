import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("cad-mcp-dev Python compile validator uses valid multiline syntax", async () => {
  const source = await fs.readFile(
    new URL("../src/cadgpt/tools/cad-mcp-dev.ts", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /"for p in files:",\s*"    compile\(p\.read_text\(encoding='utf-8'\), str\(p\), 'exec'\)",[\s\S]*?\.join\("\\n"\)/
  );

  assert.doesNotMatch(
    source,
    /for p in files: compile\([^\n]+\)[\s\S]{0,120}\.join\("; "\)/
  );
});
