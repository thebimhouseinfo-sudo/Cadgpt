import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { getAppDataPath, getDrawingStorageRoot } from "./appdata.js";
import { isPathInside, resolveAbsoluteMutationPath } from "./path-security.js";
import { withFileMutationLocks } from "../runtime/file-scheduler.js";

export type KnowledgeScope = "global" | "drawing";
export type KnowledgeSource = "user_confirmed" | "reference" | "drawing_observation";

const DOCUMENT_KEY = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const DRAWING_ANCHOR = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const INTERNAL_TECHNICAL_CONTENT = [
  /\(\s*defun\b/i,
  /\b(?:AutoLISP|ObjectARX|DXF group codes?|CAD API)\b/i,
  /\b(?:entget|entmod|ssget|vlax-[a-z0-9_-]+|vla-[a-z0-9_-]+)\s*\(/i,
  /\bAutodesk\.AutoCAD\b/i,
  /(?:^|\n)\s*```\s*(?:lisp|autolisp|typescript|csharp|powershell)\b/i,
  /\b(?:cad_mcp_dev_|runtimes\/cad-mcp\/|src\/cadgpt\/)\b/i,
];

export function assertKnowledgeKey(key: string): string {
  if (!DOCUMENT_KEY.test(key)) {
    throw new Error("KNOWLEDGE_KEY_INVALID: use a lowercase slug (a-z, 0-9, _ or -, max 80).");
  }
  return key;
}

export function assertHvacDomain(body: string): void {
  if (!body.trim() || body.length > 80_000) {
    throw new Error("HVAC_KNOWLEDGE_CONTENT_INVALID: nonempty text up to 80000 characters required.");
  }
  if (INTERNAL_TECHNICAL_CONTENT.some((pattern) => pattern.test(body))) {
    throw new Error("HVAC_KNOWLEDGE_SCOPE: CAD API, Lisp authoring and MCP development belong to internal knowledge, not KUG/KUD.");
  }
}

export function getGlobalKnowledgeRoot(): string {
  return getAppDataPath("knowledge");
}

export function getDrawingKnowledgeRoot(drawingRoot: string, anchor: string): string {
  const drawings = path.resolve(getDrawingStorageRoot());
  const selected = path.resolve(drawingRoot);
  if (!DRAWING_ANCHOR.test(anchor) || anchor.length > 180 || anchor === "." || anchor === ".." || path.dirname(selected) !== drawings || path.basename(selected) !== anchor) {
    throw new Error("DRAWING_KNOWLEDGE_SCOPE: expected one exact verified drawings/<drawing_anchor> root.");
  }
  return path.join(selected, "knowledge");
}

/**
 * Refuse symlink/junction redirection of the knowledge namespace. In particular
 * a knowledge folder under drawing A may not point into drawing B.
 */
async function checkedRoot(root: string): Promise<string> {
  const parent = path.dirname(path.resolve(root));
  await fs.mkdir(parent, { recursive: true });
  const actualParent = await fs.realpath(parent);
  try {
    const prior = await fs.lstat(root);
    if (prior.isSymbolicLink()) {
      throw new Error("KNOWLEDGE_PATH_REDIRECT: knowledge root symlink is forbidden.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.mkdir(root, { recursive: true });
  const info = await fs.lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("KNOWLEDGE_PATH_REDIRECT: knowledge root must be a real directory.");
  }
  const actualRoot = await fs.realpath(root);
  if (path.dirname(actualRoot) !== actualParent) {
    throw new Error("KNOWLEDGE_PATH_REDIRECT: knowledge root escaped its parent.");
  }
  return actualRoot;
}

async function safeDocumentPath(root: string, key: string): Promise<string> {
  const canonicalRoot = await checkedRoot(root);
  const requested = path.resolve(root, `${assertKnowledgeKey(key)}.md`);
  const resolved = await resolveAbsoluteMutationPath(requested, {
    forCreate: true,
    allowedRoots: [root],
    label: "HVAC knowledge",
  });
  if (path.dirname(resolved) !== canonicalRoot || !isPathInside(resolved, canonicalRoot)) {
    throw new Error("KNOWLEDGE_PATH_REDIRECT: document is not a direct child of the authorized knowledge folder.");
  }
  try {
    if ((await fs.lstat(requested)).isSymbolicLink()) {
      throw new Error("KNOWLEDGE_PATH_REDIRECT: document symlinks are forbidden.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolved;
}

export function knowledgeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function readKnowledgeEntry(root: string, key: string) {
  const target = await safeDocumentPath(root, key);
  try {
    const content = await fs.readFile(target, "utf8");
    return { key, content, sha256: knowledgeHash(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listKnowledgeEntries(root: string) {
  const canonicalRoot = await checkedRoot(root);
  const entries = await fs.readdir(canonicalRoot, { withFileTypes: true });
  const keys = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.slice(0, -3))
    .filter((key) => DOCUMENT_KEY.test(key))
    .sort();
  const result = [];
  for (const key of keys) {
    const entry = await readKnowledgeEntry(root, key);
    if (entry) result.push({ key, sha256: entry.sha256 });
  }
  return result;
}

export async function upsertKnowledgeEntry(input: {
  root: string;
  scope: KnowledgeScope;
  drawingAnchor?: string;
  key: string;
  title: string;
  body: string;
  source: KnowledgeSource;
  sourceNote: string;
  expectedSha256: string;
}) {
  assertKnowledgeKey(input.key);
  assertHvacDomain(input.body);
  assertHvacDomain(input.title);
  if (!input.title.trim() || input.title.length > 120 || /[\r\n]/.test(input.title)) {
    throw new Error("HVAC_KNOWLEDGE_TITLE_INVALID");
  }
  if (!input.sourceNote.trim() || input.sourceNote.length > 2000) {
    throw new Error("HVAC_KNOWLEDGE_EVIDENCE_REQUIRED");
  }
  if (input.scope === "global" && (input.drawingAnchor || input.source === "drawing_observation")) {
    throw new Error("HVAC_KNOWLEDGE_GLOBAL_PROMOTION: drawing observations cannot silently become global rules.");
  }
  if (input.scope === "drawing" && !input.drawingAnchor) {
    throw new Error("DRAWING_KNOWLEDGE_ANCHOR_REQUIRED");
  }
  const expected = input.expectedSha256.toLowerCase();
  if (expected && !SHA256.test(expected)) throw new Error("KNOWLEDGE_EXPECTED_SHA_INVALID");

  const target = await safeDocumentPath(input.root, input.key);
  return await withFileMutationLocks([target], async () => {
    // Re-resolve inside the mutation lock and fail if the file/root was redirected.
    await safeDocumentPath(input.root, input.key);
    let previous: string | null = null;
    try {
      previous = await fs.readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const existingSha = previous === null ? "" : knowledgeHash(previous);
    if (existingSha !== expected) {
      throw new Error("KNOWLEDGE_REVISION_CONFLICT: read the latest entry and retry with its exact sha256; use empty expected_sha256 only for creation.");
    }
    const updatedAt = new Date().toISOString();
    const formatted = [
      "---",
      "cadgpt_knowledge_domain: hvac",
      `cadgpt_knowledge_scope: ${input.scope}`,
      ...(input.scope === "drawing" ? [`drawing_anchor: ${input.drawingAnchor}`] : []),
      `source_kind: ${input.source}`,
      `source_note: ${JSON.stringify(input.sourceNote.trim())}`,
      `updated_at: ${updatedAt}`,
      "---",
      "",
      `# ${input.title.trim()}`,
      "",
      input.body.trim(),
      "",
    ].join("\n");
    const temporary = path.join(path.dirname(target), `.${input.key}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, formatted, { encoding: "utf8", flag: "wx" });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
    const persisted = await fs.readFile(target, "utf8");
    if (persisted !== formatted) throw new Error("KNOWLEDGE_READBACK_FAILED");
    return {
      key: input.key,
      scope: input.scope,
      ...(input.drawingAnchor ? { drawing_anchor: input.drawingAnchor } : {}),
      operation: previous === null ? "created" : "updated",
      previous_sha256: existingSha || null,
      sha256: knowledgeHash(formatted),
      updated_at: updatedAt,
    };
  });
}
