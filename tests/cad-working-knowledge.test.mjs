import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

test("active CadGPT drawing intent defaults draw requests to bound AutoCAD drawing", async () => {
  const source = await fs.readFile(
    path.join(repoRoot, "src", "cadgpt", "server-factory.ts"),
    "utf8"
  );

  assert.match(source, /ACTIVE_CAD_DRAWING_INTENT_POLICY/);
  assert.match(source, /BOUND AUTOCAD DRAWING/);
  assert.match(source, /Do NOT route such requests to image generation/i);
  assert.match(source, /user explicitly asks for a standalone image\/render\/illustration/i);
});

test("curated CAD working knowledge is loaded into MCP instructions", async () => {
  const source = await fs.readFile(
    path.join(repoRoot, "src", "cadgpt", "server-factory.ts"),
    "utf8"
  );
  const knowledge = await fs.readFile(
    path.join(repoRoot, "knowledge", "cad", "WORKING_KNOWLEDGE.md"),
    "utf8"
  );
  const errorLog = await fs.readFile(
    path.join(repoRoot, "diagnostics", "cad", "ERROR_LOG.md"),
    "utf8"
  );

  assert.match(source, /loadCadWorkingKnowledge/);
  assert.match(source, /WORKING_KNOWLEDGE\.md/);
  assert.match(source, /CADGPT CURATED WORKING KNOWLEDGE/);
  assert.match(knowledge, /Intent routing inside an active CAD workspace/);
  assert.match(knowledge, /Perform the requested work through CadGPT CAD tools/);
  assert.match(errorLog, /raw product evidence/i);
  assert.match(errorLog, /do not change ChatGPT behavior automatically/i);
});
