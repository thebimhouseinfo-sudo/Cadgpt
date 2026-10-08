import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const knowledge = await import("../dist/cadgpt/lib/knowledge-storage.js");
const appdata = await import("../dist/cadgpt/lib/appdata.js");

async function tempWorkspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-knowledge-test-"));
  const previous = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function input(root, overrides = {}) {
  return {
    root,
    scope: "global",
    key: "hvac-sa-ra-routing",
    title: "System routing",
    body: "Supply air SA is distinct from return air RA.",
    source: "user_confirmed",
    sourceNote: "Confirmed by the user as a working HVAC convention.",
    expectedSha256: "",
    ...overrides,
  };
}

test("KUG global storage uses external AppData/knowledge, never repo-local appdata", async (t) => {
  const root = await tempWorkspace(t);
  const expectedRoot = path.join(root, "knowledge");
  assert.equal(knowledge.getGlobalKnowledgeRoot(), expectedRoot);
  const created = await knowledge.upsertKnowledgeEntry(input(expectedRoot));
  assert.equal(created.scope, "global");
  assert.equal(created.operation, "created");
  const entry = await knowledge.readKnowledgeEntry(expectedRoot, "hvac-sa-ra-routing");
  assert.ok(entry.content.includes("cadgpt_knowledge_domain: hvac"));
  assert.ok(entry.content.includes("cadgpt_knowledge_scope: global"));
  assert.ok(entry.content.includes("Supply air SA"));
  assert.equal(entry.sha256, created.sha256);
  const entries = await knowledge.listKnowledgeEntries(expectedRoot);
  assert.deepEqual(entries.map((item) => item.key), ["hvac-sa-ra-routing"]);
  assert.equal(await knowledge.readKnowledgeEntry(expectedRoot, "missing"), null);
});

test("knowledge updates require exact revision CAS and preserve original on conflict", async (t) => {
  await tempWorkspace(t);
  const root = knowledge.getGlobalKnowledgeRoot();
  const first = await knowledge.upsertKnowledgeEntry(input(root));
  await assert.rejects(
    knowledge.upsertKnowledgeEntry(input(root, { body: "Overwrite without checking." })),
    /KNOWLEDGE_REVISION_CONFLICT/
  );
  const second = await knowledge.upsertKnowledgeEntry(input(root, {
    body: "SA system serves supply outlets; RA system returns air.",
    expectedSha256: first.sha256,
  }));
  assert.equal(second.operation, "updated");
  assert.equal(second.previous_sha256, first.sha256);
  await assert.rejects(
    knowledge.upsertKnowledgeEntry(input(root, { expectedSha256: first.sha256 })),
    /KNOWLEDGE_REVISION_CONFLICT/
  );
  const persisted = await knowledge.readKnowledgeEntry(root, "hvac-sa-ra-routing");
  assert.equal(persisted.sha256, second.sha256);
  assert.match(persisted.content, /SA system serves supply outlets/);
});

test("KUD isolates same-key entries by exact drawing anchor, including dotted anchors", async (t) => {
  await tempWorkspace(t);
  const drawings = appdata.getDrawingStorageRoot();
  const anchorA = "MAGS-16.07.26-112012-051026-7876585c";
  const anchorB = "HVAC-Level02-2026-a123";
  const rootA = knowledge.getDrawingKnowledgeRoot(path.join(drawings, anchorA), anchorA);
  const rootB = knowledge.getDrawingKnowledgeRoot(path.join(drawings, anchorB), anchorB);
  const a = await knowledge.upsertKnowledgeEntry(input(rootA, {
    scope: "drawing", drawingAnchor: anchorA, source: "drawing_observation",
    body: "FCU-FT-1 is connected to SA and RA in this drawing.",
    sourceNote: "Observed in the bound drawing using current CAD data.",
  }));
  const b = await knowledge.upsertKnowledgeEntry(input(rootB, {
    scope: "drawing", drawingAnchor: anchorB, source: "drawing_observation",
    body: "OAF-MP-4 has an OA segment in this drawing.",
    sourceNote: "Observed in the other bound drawing using current CAD data.",
  }));
  assert.notEqual(a.sha256, b.sha256);
  assert.match((await knowledge.readKnowledgeEntry(rootA, "hvac-sa-ra-routing")).content, /FCU-FT-1/);
  assert.match((await knowledge.readKnowledgeEntry(rootB, "hvac-sa-ra-routing")).content, /OAF-MP-4/);
  assert.throws(
    () => knowledge.getDrawingKnowledgeRoot(path.join(drawings, anchorB), anchorA),
    /DRAWING_KNOWLEDGE_SCOPE/
  );
  assert.throws(
    () => knowledge.getDrawingKnowledgeRoot(path.join(drawings, "..", "elsewhere"), anchorA),
    /DRAWING_KNOWLEDGE_SCOPE/
  );
});

test("KUG rejects raw drawing-observation promotion and API/LISP knowledge", async (t) => {
  await tempWorkspace(t);
  const root = knowledge.getGlobalKnowledgeRoot();
  await assert.rejects(
    knowledge.upsertKnowledgeEntry(input(root, {
      source: "drawing_observation",
      body: "This drawing uses an FCU.",
    })),
    /HVAC_KNOWLEDGE_GLOBAL_PROMOTION/
  );
  for (const body of [
    "(defun c:TEST () (princ))",
    "A tutorial explaining AutoLISP development.",
    "Use CAD API ObjectARX for geometry.",
    "```lisp\n(setq x 1)\n```",
  ]) {
    await assert.rejects(
      knowledge.upsertKnowledgeEntry(input(root, { body })),
      /HVAC_KNOWLEDGE_SCOPE/
    );
  }
  await assert.rejects(
    knowledge.upsertKnowledgeEntry(input(root, { key: "../../drawings/different/knowledge" })),
    /KNOWLEDGE_KEY_INVALID/
  );
  await assert.rejects(
    knowledge.upsertKnowledgeEntry(input(root, { expectedSha256: "incorrect" })),
    /KNOWLEDGE_EXPECTED_SHA_INVALID/
  );
});

test("knowledge folder redirection is blocked before write", async (t) => {
  const dir = await tempWorkspace(t);
  const outside = path.join(dir, "external");
  await fs.mkdir(outside);
  const link = path.join(dir, "knowledge");
  try {
    await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip("Platform does not permit symlink creation");
      return;
    }
    throw error;
  }
  await assert.rejects(
    knowledge.upsertKnowledgeEntry(input(link)),
    /KNOWLEDGE_PATH_REDIRECT/
  );
  assert.deepEqual(await fs.readdir(outside), []);
});

test("generic file tools must not claim ownership of managed HVAC knowledge", async (t) => {
  const root = await tempWorkspace(t);
  const p = knowledge.isHvacKnowledgePath;
  assert.equal(p(path.join(root, "knowledge", "duct-rules.md"), root), true);
  assert.equal(p(path.join(root, "drawings", "A.1", "knowledge", "system.md"), root), true);
  assert.equal(p(path.join(root, "drawings", "A.1", "jobs", "result.md"), root), false);
  assert.equal(p(path.join(root, "workspace", "knowledge", "scratch.md"), root), false);
  const fileTools = await fs.readFile(path.join(repoRoot, "src", "cadgpt", "tools", "filesystem.ts"), "utf8");
  assert.match(fileTools, /KNOWLEDGE_UPDATER_REQUIRED/);
  const current = fileTools.match(/await assertNotManagedHvacKnowledgeMutation\(target\)/g) || [];
  assert.equal(current.length, 3, "create/edit/delete must each check managed knowledge");
  const policy = await import("../dist/cadgpt/lib/tool-policy.js");
  assert.equal(policy.toolFamily("knowledge_upsert"), "knowledge");
});


test("KUG tool works in FILE-only mode, needs human approval, and unbound KUD does not wake CAD", async (t) => {
  await tempWorkspace(t);
  const { checkAdmission, revokeSessionAdmissions } = await import("../dist/cadgpt/lib/admission.js");
  const { createWorkRegistration, acquireToolLease, runWithToolLease } =
    await import("../dist/cadgpt/lib/work-registration.js");
  const { registerKnowledgeTools } = await import("../dist/cadgpt/tools/knowledge.js");
  const { cadUpstream } = await import("../dist/cadgpt/runtime/cad-upstream.js");

  const callbacks = new Map();
  registerKnowledgeTools({ registerTool(name, _config, callback) { callbacks.set(name, callback); } });
  const sessionKey = "knowledge-file-only-integration";
  checkAdmission(sessionKey, "@cg", "mention");
  const work = createWorkRegistration({
    sessionKey, ownerType: "file", ownerId: "knowledge-updater-global", executionPath: "file",
  });
  async function call(name, args) {
    const lease = acquireToolLease({
      tool: name, family: "knowledge", sessionKey,
      executionId: work.executionId, authorityToken: work.authorityToken,
    });
    return await runWithToolLease(lease, () => callbacks.get(name)(args));
  }
  try {
    const before = cadUpstream.status();
    const list = await call("knowledge_list", { scope: "global" });
    assert.equal(list.structuredContent.ok, true);
    assert.deepEqual(list.structuredContent.data.entries, []);

    const payload = {
      scope: "global", key: "system-rules", title: "HVAC system rules",
      body: "SA supply and RA return have separate system labels.",
      source: "user_confirmed", source_note: "User approved a domain rule.",
      expected_sha256: "",
    };
    const denied = await call("knowledge_upsert", { ...payload, human_approved: false });
    assert.equal(denied.isError, true);
    assert.match(denied.structuredContent.data.error, /KNOWLEDGE_HUMAN_APPROVAL_REQUIRED/);

    const created = await call("knowledge_upsert", { ...payload, human_approved: true });
    assert.equal(created.structuredContent.ok, true);
    assert.equal(created.structuredContent.data.operation, "created");

    const readback = await call("knowledge_read", { scope: "global", key: "system-rules" });
    assert.equal(readback.structuredContent.ok, true);
    assert.match(readback.structuredContent.data.entry.content, /SA supply/);

    const invalidKud = await call("knowledge_list", { scope: "drawing" });
    assert.equal(invalidKud.isError, true);
    assert.match(invalidKud.structuredContent.data.error, /DRAWING|BOUND|CONTEXT/i);
    const after = cadUpstream.status();
    assert.equal(after.enabled, before.enabled, "unbound KUD must not activate CAD");
    assert.equal(after.connected, before.connected, "unbound KUD must not connect CAD");
  } finally {
    revokeSessionAdmissions(sessionKey);
  }
});

test("menu and MCP surface register both workflow selectors and knowledge tools", async () => {
  const { CADGPT_ROOT_MENU, CADGPT_HELP } = await import("../dist/cadgpt/lib/quickstart.js");
  for (const command of ["cg/kug", "cg/kud"]) {
    assert.ok(CADGPT_ROOT_MENU.includes(command));
    assert.ok(CADGPT_HELP.includes(command));
  }
  const source = await fs.readFile(path.join(repoRoot, "src", "cadgpt", "server-factory.ts"), "utf8");
  assert.match(source, /registerKnowledgeTools\(server\)/);
  const control = await fs.readFile(path.join(repoRoot, "src", "cadgpt", "tools", "control.ts"), "utf8");
  assert.match(control, /surface === "kug" \|\| surface === "kud"/);
  const registry = await fs.readFile(path.join(repoRoot, "src", "cadgpt", "tools", "registry.ts"), "utf8");
  for (const name of ["knowledge_list", "knowledge_read", "knowledge_upsert"]) {
    assert.ok(registry.includes(`name: "${name}"`), "Internal Registry must expose " + name);
  }
  const skill = await fs.readFile(path.join(repoRoot, "skills", "knowledge-updater", "SKILL.md"), "utf8");
  assert.match(skill, /AutoLISP syntax\/authoring\/debugging/);
  assert.match(skill, /drawing observations to global|per-drawing observations/i);
});
