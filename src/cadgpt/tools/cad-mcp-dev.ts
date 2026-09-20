import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getCadMcpRuntimeRoot,
  getRepoRoot,
  isPathInside,
  resolveAbsoluteMutationPath,
} from "../lib/path-security.js";
import {
  currentToolLease,
  executionSupportsCad,
  hasActiveCadCapabilityLease,
  hasOtherActiveCadWork,
  isDevelopmentBuild,
} from "../lib/work-registration.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import { getAppDataPath } from "../lib/appdata.js";

const execFileAsync = promisify(execFile);
const MAX_READ_BYTES = 512 * 1024;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_SNAPSHOT_FILES = 3000;
interface CadMcpDevSnapshot {
  id: string;
  files: Map<string, Buffer>;
  createdAt: string;
  baselineFingerprint: string;
}

interface CadMcpDevRecoveryMetadata {
  snapshot_id: string;
  execution_id: string;
  created_at: string;
  baseline_fingerprint: string;
  file_count: number;
  bytes: number;
}

const snapshots = new Map<string, CadMcpDevSnapshot>();
const validatedFingerprints = new Map<string, string>();
const knownSourceFingerprints = new Map<string, string>();

function recoveryRoot(): string {
  return getAppDataPath("state", "cad-mcp-dev-recovery");
}

function recoveryKey(executionId: string): string {
  return createHash("sha256").update(executionId).digest("hex").slice(0, 24);
}

function recoveryDir(executionId: string): string {
  return path.join(recoveryRoot(), recoveryKey(executionId));
}

function recoveryFilesDir(executionId: string): string {
  return path.join(recoveryDir(executionId), "files");
}

function recoveryMetadataPath(executionId: string): string {
  return path.join(recoveryDir(executionId), "metadata.json");
}

async function listRecoveryMetadata(): Promise<CadMcpDevRecoveryMetadata[]> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(recoveryRoot(), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const result: CadMcpDevRecoveryMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) {
      await fs.rm(path.join(recoveryRoot(), entry.name), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
      continue;
    }
    try {
      const parsed = JSON.parse(
        await fs.readFile(
          path.join(recoveryRoot(), entry.name, "metadata.json"),
          "utf8"
        )
      ) as CadMcpDevRecoveryMetadata;
      if (
        typeof parsed.snapshot_id !== "string" ||
        !parsed.snapshot_id ||
        typeof parsed.execution_id !== "string" ||
        !parsed.execution_id ||
        typeof parsed.created_at !== "string" ||
        !parsed.created_at ||
        typeof parsed.baseline_fingerprint !== "string" ||
        !/^[a-f0-9]{64}$/i.test(parsed.baseline_fingerprint) ||
        !Number.isInteger(parsed.file_count) ||
        parsed.file_count < 0 ||
        !Number.isInteger(parsed.bytes) ||
        parsed.bytes < 0
      ) {
        throw new Error("invalid recovery metadata schema");
      }
      result.push(parsed);
    } catch (error) {
      throw new Error(
        `CAD_MCP_DEV_RECOVERY_CORRUPT: cannot read recovery metadata under ${path.join(recoveryRoot(), entry.name)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return result.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function assertNoForeignRecovery(executionId: string): Promise<void> {
  const pending = await listRecoveryMetadata();
  const foreign = pending.find((item) => item.execution_id !== executionId);
  if (foreign) {
    throw new Error(
      `CAD_MCP_DEV_RECOVERY_REQUIRED: pending baseline ${foreign.snapshot_id} from ${foreign.execution_id} must be recovered before new CAD MCP mutations.`
    );
  }
}

async function assertDevMode(
  options: { allowRecovery?: boolean } = {}
): Promise<void> {
  if (!isDevelopmentBuild()) {
    throw new Error("DEVELOPMENT_ONLY: cad-mcp-dev is unavailable in production builds.");
  }
  const lease = currentToolLease();
  if (lease.ownerId !== "cad-mcp-dev") {
    throw new Error("CAD_MCP_DEV_REQUIRED: current work owner must be cad-mcp-dev.");
  }
  if (!options.allowRecovery) {
    await assertNoForeignRecovery(lease.workId);
  }
}

function assertNotGeneratedManifest(target: string): void {
  const manifest = path.resolve(runtimeRoot(), "tool-manifest.json");
  if (path.resolve(target) === manifest) {
    throw new Error(
      "GENERATED_ARTIFACT: tool-manifest.json must be regenerated through cad_mcp_dev_validate(action=manifest|all), not edited directly."
    );
  }
}

async function prepareDevMutation(): Promise<string> {
  await assertDevMode();
  const lease = currentToolLease();
  const { assertCadCandidateSourceMutationAllowed } = await import("../runtime/cad-candidate.js");
  assertCadCandidateSourceMutationAllowed(lease.workId);
  validatedFingerprints.delete(lease.workId);
  return lease.workId;
}

async function prepareDevSourceMutation(): Promise<string> {
  const workId = await prepareDevMutation();
  const { assertCadDevSourceAccess } = await import(
    "../runtime/cad-dev-source-transaction.js"
  );
  assertCadDevSourceAccess(workId);
  if (!snapshots.has(workId)) {
    throw new Error(
      "CAD_MCP_DEV_SNAPSHOT_REQUIRED: create cad_mcp_dev_snapshot before the first source/environment mutation."
    );
  }
  await assertKnownSourceState(workId);
  return workId;
}

function runtimeRoot(): string {
  return getCadMcpRuntimeRoot();
}

function devReadRoots(): string[] {
  return [
    runtimeRoot(),
    path.join(getRepoRoot(), "src", "cadgpt"),
    path.join(getRepoRoot(), "knowledge"),
    path.join(getRepoRoot(), "registry"),
    path.join(getRepoRoot(), "IMPLEMENTATION_PLAN.md"),
    path.join(getRepoRoot(), "README.md"),
    path.join(getRepoRoot(), "scripts", "generate-cad-tool-manifest.py"),
  ].map((item) => path.resolve(item));
}

function isApprovedDevReadTarget(target: string): boolean {
  return devReadRoots().some((root) => {
    if (root === target) return true;
    return isPathInside(target, root);
  });
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function assertDevReadPath(input: string): Promise<string> {
  if (!path.isAbsolute(input)) {
    throw new Error("ABSOLUTE_PATH_REQUIRED: CAD MCP developer paths must be absolute.");
  }
  const target = await fs.realpath(path.resolve(input));
  if (!isApprovedDevReadTarget(target)) {
    throw new Error(
      "CAD_MCP_DEV_SCOPE: read target is outside the CAD MCP runtime and approved read-only supporting contract roots"
    );
  }
  return target;
}

async function walk(
  root: string,
  current: string,
  out: string[],
  limit = 3000
): Promise<void> {
  if (out.length >= limit) return;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= limit) break;
    if (entry.name === "__pycache__") continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(root, full, out, limit);
    else if (entry.isFile() && !entry.name.endsWith(".pyc")) out.push(full);
  }
}

async function atomicWrite(target: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temp, content);
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

function fingerprintFileMap(files: Map<string, Buffer>): string {
  const hash = createHash("sha256");
  const entries = [...files.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );
  for (const [relativeRaw, data] of entries) {
    const relative = relativeRaw.replaceAll("\\", "/");
    hash.update(relative);
    hash.update("\0");
    hash.update(sha256(data));
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function restoreSnapshotFiles(
  snapshot: CadMcpDevSnapshot
): Promise<void> {
  const current: string[] = [];
  await walk(runtimeRoot(), runtimeRoot(), current, MAX_SNAPSHOT_FILES + 1);
  if (current.length > MAX_SNAPSHOT_FILES) {
    throw new Error("Rollback exceeds file-count safety limit");
  }

  for (const file of current) {
    const rel = path.relative(runtimeRoot(), file);
    if (!snapshot.files.has(rel)) await fs.rm(file, { force: true });
  }

  for (const [rel, data] of snapshot.files) {
    const target = path.resolve(runtimeRoot(), rel);
    if (!isPathInside(target, runtimeRoot())) {
      throw new Error("Snapshot contains an invalid runtime path");
    }
    await atomicWrite(target, data);
  }
}

async function persistSnapshot(
  executionId: string,
  snapshot: CadMcpDevSnapshot
): Promise<void> {
  const root = recoveryRoot();
  const targetDir = recoveryDir(executionId);
  const tempDir = path.join(
    root,
    `.${recoveryKey(executionId)}.${randomUUID()}.tmp`
  );
  const tempFiles = path.join(tempDir, "files");

  await fs.mkdir(root, { recursive: true });
  try {
    await fs.lstat(targetDir);
    throw new Error(
      `CAD_MCP_DEV_RECOVERY_EXISTS: persistent baseline already exists for ${executionId}`
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await fs.mkdir(tempFiles, { recursive: true });
  try {
    for (const [rel, data] of snapshot.files) {
      const target = path.resolve(tempFiles, rel);
      if (!isPathInside(target, tempFiles)) {
        throw new Error("Snapshot contains an invalid recovery relative path");
      }
      await atomicWrite(target, data);
    }

    const metadata: CadMcpDevRecoveryMetadata = {
      snapshot_id: snapshot.id,
      execution_id: executionId,
      created_at: snapshot.createdAt,
      baseline_fingerprint: snapshot.baselineFingerprint,
      file_count: snapshot.files.size,
      bytes: [...snapshot.files.values()].reduce(
        (total, data) => total + data.length,
        0
      ),
    };
    await atomicWrite(
      path.join(tempDir, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`
    );
    await fs.rename(tempDir, targetDir);
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function removePersistedSnapshot(executionId: string): Promise<void> {
  await fs.rm(recoveryDir(executionId), {
    recursive: true,
    force: true,
  });
}

async function loadPersistedSnapshot(
  executionId: string
): Promise<CadMcpDevSnapshot | null> {
  let metadata: CadMcpDevRecoveryMetadata;
  try {
    metadata = JSON.parse(
      await fs.readFile(recoveryMetadataPath(executionId), "utf8")
    ) as CadMcpDevRecoveryMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  if (
    !metadata.snapshot_id ||
    metadata.execution_id !== executionId ||
    !metadata.created_at
  ) {
    throw new Error(
      `CAD_MCP_DEV_RECOVERY_CORRUPT: invalid metadata for ${executionId}`
    );
  }

  const filesRoot = recoveryFilesDir(executionId);
  const files: string[] = [];
  await walk(filesRoot, filesRoot, files, MAX_SNAPSHOT_FILES + 1);
  if (files.length > MAX_SNAPSHOT_FILES) {
    throw new Error("Persistent recovery snapshot exceeds file-count safety limit");
  }

  const captured = new Map<string, Buffer>();
  let bytes = 0;
  for (const file of files) {
    const rel = path.relative(filesRoot, file);
    const data = await fs.readFile(file);
    bytes += data.length;
    if (bytes > MAX_SNAPSHOT_BYTES) {
      throw new Error("Persistent recovery snapshot exceeds byte-size safety limit");
    }
    captured.set(rel, data);
  }

  if (captured.size !== metadata.file_count || bytes !== metadata.bytes) {
    throw new Error(
      `CAD_MCP_DEV_RECOVERY_CORRUPT: snapshot size/count mismatch for ${executionId}`
    );
  }
  const fingerprint = fingerprintFileMap(captured);
  if (fingerprint !== metadata.baseline_fingerprint) {
    throw new Error(
      `CAD_MCP_DEV_RECOVERY_CORRUPT: baseline fingerprint mismatch for ${executionId}`
    );
  }

  return {
    id: metadata.snapshot_id,
    files: captured,
    createdAt: metadata.created_at,
    baselineFingerprint: fingerprint,
  };
}

async function findPersistedSnapshotById(
  snapshotId: string
): Promise<{ executionId: string; snapshot: CadMcpDevSnapshot } | null> {
  const pending = await listRecoveryMetadata();
  const metadata = pending.find((item) => item.snapshot_id === snapshotId);
  if (!metadata) return null;
  const snapshot = await loadPersistedSnapshot(metadata.execution_id);
  if (!snapshot) return null;
  return { executionId: metadata.execution_id, snapshot };
}

async function runPython(args: string[], cwd = runtimeRoot()) {
  const configured =
    process.env.CAD_MCP_PYTHON ||
    path.join(".venv-cad", "Scripts", "python.exe");
  const python = path.isAbsolute(configured)
    ? configured
    : path.resolve(getRepoRoot(), configured);
  const result = await execFileAsync(python, args, {
    cwd,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

async function validateLockedRequirements(): Promise<{
  path: string;
  packages: number;
}> {
  const requirements = path.join(runtimeRoot(), "requirements.lock.txt");
  const text = await fs.readFile(requirements, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const safePin = /^[A-Za-z0-9_.-]+==[A-Za-z0-9_.+!-]+$/;
  for (const line of lines) {
    if (!safePin.test(line)) {
      throw new Error(
        `UNSAFE_DEPENDENCY_LOCK: only exact package==version pins are allowed in requirements.lock.txt; rejected '${line}'`
      );
    }
  }

  return { path: requirements, packages: lines.length };
}

async function runtimeFingerprint(): Promise<string> {
  const files: string[] = [];
  await walk(runtimeRoot(), runtimeRoot(), files, MAX_SNAPSHOT_FILES + 1);
  if (files.length > MAX_SNAPSHOT_FILES) {
    throw new Error("Runtime fingerprint exceeds file-count safety limit");
  }
  const captured = new Map<string, Buffer>();
  for (const file of files) {
    captured.set(path.relative(runtimeRoot(), file), await fs.readFile(file));
  }
  return fingerprintFileMap(captured);
}

async function assertKnownSourceState(workId: string): Promise<void> {
  const expected = knownSourceFingerprints.get(workId);
  if (!expected) return;
  const current = await runtimeFingerprint();
  if (current !== expected) {
    throw new Error(
      "CAD_MCP_DEV_EXTERNAL_CHANGE: runtime source changed outside the active CadGPT source transaction. Automatic mutation/rollback is blocked; inspect and use confirmed recovery if baseline restoration is intended."
    );
  }
}

async function recordKnownSourceState(workId: string): Promise<string> {
  const current = await runtimeFingerprint();
  knownSourceFingerprints.set(workId, current);
  return current;
}

async function refreshManifest(): Promise<Record<string, unknown>> {
  const script = path.join(getRepoRoot(), "scripts", "generate-cad-tool-manifest.py");
  const result = await runPython([script], getRepoRoot());
  const manifest = path.join(runtimeRoot(), "tool-manifest.json");
  const parsed = JSON.parse(await fs.readFile(manifest, "utf8")) as {
    version?: number;
    tools?: Array<{ name?: string }>;
  };
  return {
    manifest_path: manifest,
    version: parsed.version ?? null,
    tool_count: parsed.tools?.length ?? 0,
    tools: (parsed.tools ?? []).map((item) => item.name).filter(Boolean),
    ...result,
  };
}

export function registerCadMcpDevTools(server: McpServer): void {
  if (!isDevelopmentBuild()) return;

  server.registerTool(
    "cad_mcp_dev_root",
    {
      title: "CAD MCP Developer Root",
      description:
        "Return the only source tree writable by the development-only cad-mcp-dev Skill.",
      inputSchema: {},
    },
    async () => {
      try {
        await assertDevMode();
        return toolResult("cad_mcp_dev_root", {
          absolute_root: runtimeRoot(),
          write_scope: "runtimes/cad-mcp/** only",
          read_only_support_roots: devReadRoots().filter((item) => item !== runtimeRoot()),
          git_authority: false,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_root", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_list",
    {
      title: "List CAD MCP Runtime Files",
      description: "List files under the CAD MCP runtime or approved read-only supporting roots. path must be absolute. Only runtimes/cad-mcp/** is writable.",
      inputSchema: {
        path: z.string().min(1),
        recursive: z.boolean().optional().default(false),
        max_entries: z.number().int().min(1).max(3000).optional().default(500),
      },
    },
    async ({ path: input, recursive, max_entries }) => {
      try {
        await assertDevMode();
        const target = await assertDevReadPath(input);
        const stat = await fs.stat(target);
        if (stat.isFile()) {
          return toolResult("cad_mcp_dev_list", {
            entries: [{ absolute_path: target, type: "file" }],
          });
        }
        if (!recursive) {
          const entries = await fs.readdir(target, { withFileTypes: true });
          return toolResult("cad_mcp_dev_list", {
            entries: entries.slice(0, max_entries).map((entry) => ({
              absolute_path: path.join(target, entry.name),
              type: entry.isDirectory() ? "directory" : "file",
            })),
            truncated: entries.length > max_entries,
          });
        }
        const files: string[] = [];
        await walk(target, target, files, max_entries + 1);
        return toolResult("cad_mcp_dev_list", {
          entries: files.slice(0, max_entries).map((item) => ({
            absolute_path: item,
            type: "file",
          })),
          truncated: files.length > max_entries,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_list", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_read",
    {
      title: "Read CAD MCP Runtime File",
      description:
        "Read one CAD MCP runtime/supporting contract file by absolute path and return sha256. Supporting roots are read-only.",
      inputSchema: {
        path: z.string().min(1),
        max_bytes: z
          .number()
          .int()
          .min(1)
          .max(MAX_READ_BYTES)
          .optional()
          .default(200_000),
      },
    },
    async ({ path: input, max_bytes }) => {
      try {
        await assertDevMode();
        const target = await assertDevReadPath(input);
        const stat = await fs.stat(target);
        if (!stat.isFile()) throw new Error("Read target must be a file");
        const data = await fs.readFile(target);
        return toolResult("cad_mcp_dev_read", {
          absolute_path: target,
          sha256: sha256(data),
          bytes: data.length,
          truncated: data.length > max_bytes,
          content: data.subarray(0, max_bytes).toString("utf8"),
        });
      } catch (error) {
        return toolError("cad_mcp_dev_read", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_search",
    {
      title: "Search CAD MCP Runtime Source",
      description: "Search text within CAD MCP runtime or approved read-only supporting contract roots.",
      inputSchema: {
        query: z.string().min(1),
        path: z.string().min(1),
        case_sensitive: z.boolean().optional().default(false),
        max_results: z.number().int().min(1).max(500).optional().default(100),
      },
    },
    async ({ query, path: input, case_sensitive, max_results }) => {
      try {
        await assertDevMode();
        const target = await assertDevReadPath(input);
        const stat = await fs.stat(target);
        const candidates: string[] = [];
        if (stat.isFile()) candidates.push(target);
        else await walk(target, target, candidates, 3000);
        const needle = case_sensitive ? query : query.toLowerCase();
        const results: Array<{ absolute_path: string; line: number; text: string }> = [];
        for (const file of candidates) {
          if (results.length >= max_results) break;
          let text: string;
          try {
            text = await fs.readFile(file, "utf8");
          } catch {
            continue;
          }
          for (const [index, line] of text.split(/\r?\n/).entries()) {
            const comparable = case_sensitive ? line : line.toLowerCase();
            if (comparable.includes(needle)) {
              results.push({ absolute_path: file, line: index + 1, text: line.trim() });
              if (results.length >= max_results) break;
            }
          }
        }
        return toolResult("cad_mcp_dev_search", { results, count: results.length });
      } catch (error) {
        return toolError("cad_mcp_dev_search", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_create",
    {
      title: "Create CAD MCP Runtime File",
      description:
        "Create a source file. path MUST be an absolute path under runtimes/cad-mcp/**.",
      inputSchema: { path: z.string().min(1), content: z.string() },
    },
    async ({ path: input, content }) => {
      try {
        const workId = await prepareDevSourceMutation();
        const target = await resolveAbsoluteMutationPath(input, {
          allowedRoots: [runtimeRoot()],
          forCreate: true,
          label: "CAD MCP developer",
        });
        assertNotGeneratedManifest(target);
        await fs.mkdir(path.dirname(target), { recursive: true });
        try {
          await fs.writeFile(target, content, {
            encoding: "utf8",
            flag: "wx",
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error(`Target already exists: ${target}`);
          }
          throw error;
        }
        const sourceFingerprint = await recordKnownSourceState(workId);
        return toolResult("cad_mcp_dev_create", {
          absolute_path: target,
          sha256: sha256(content),
          bytes: Buffer.byteLength(content),
          source_fingerprint: sourceFingerprint,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_create", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_edit",
    {
      title: "Edit CAD MCP Runtime File",
      description:
        "Conflict-safe exact text edit. path MUST be absolute and expected_sha256 must match the current file.",
      inputSchema: {
        path: z.string().min(1),
        expected_sha256: z.string().length(64),
        old_text: z.string(),
        new_text: z.string(),
        replace_all: z.boolean().optional().default(false),
      },
    },
    async ({ path: input, expected_sha256, old_text, new_text, replace_all }) => {
      try {
        const workId = await prepareDevSourceMutation();
        const target = await resolveAbsoluteMutationPath(input, {
          allowedRoots: [runtimeRoot()],
          label: "CAD MCP developer",
        });
        assertNotGeneratedManifest(target);
        const original = await fs.readFile(target, "utf8");
        const currentHash = sha256(original);
        if (currentHash !== expected_sha256) {
          throw new Error(
            `RESOURCE_CONFLICT: expected sha256 ${expected_sha256}, current ${currentHash}`
          );
        }
        if (!original.includes(old_text)) {
          throw new Error("old_text not found; reread the file and use an exact match");
        }
        const updated = replace_all
          ? original.split(old_text).join(new_text)
          : original.replace(old_text, new_text);
        const latest = await fs.readFile(target, "utf8");
        if (sha256(latest) !== currentHash) {
          throw new Error(
            "RESOURCE_CONFLICT: file changed during edit preparation"
          );
        }
        await atomicWrite(target, updated);
        const sourceFingerprint = await recordKnownSourceState(workId);
        return toolResult("cad_mcp_dev_edit", {
          absolute_path: target,
          sha256_before: currentHash,
          sha256_after: sha256(updated),
          changed: updated !== original,
          source_fingerprint: sourceFingerprint,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_edit", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_delete",
    {
      title: "Delete CAD MCP Runtime File",
      description:
        "Delete one runtime file with sha256 conflict protection. Directories are not accepted.",
      inputSchema: {
        path: z.string().min(1),
        expected_sha256: z.string().length(64),
      },
    },
    async ({ path: input, expected_sha256 }) => {
      try {
        const workId = await prepareDevSourceMutation();
        const target = await resolveAbsoluteMutationPath(input, {
          allowedRoots: [runtimeRoot()],
          label: "CAD MCP developer",
        });
        assertNotGeneratedManifest(target);
        const stat = await fs.stat(target);
        if (!stat.isFile()) throw new Error("Delete target must be a file");
        const data = await fs.readFile(target);
        const currentHash = sha256(data);
        if (currentHash !== expected_sha256) {
          throw new Error("RESOURCE_CONFLICT: file changed after it was read");
        }
        const latest = await fs.readFile(target);
        if (sha256(latest) !== currentHash) {
          throw new Error(
            "RESOURCE_CONFLICT: file changed during delete preparation"
          );
        }
        await fs.rm(target);
        const sourceFingerprint = await recordKnownSourceState(workId);
        return toolResult("cad_mcp_dev_delete", {
          absolute_path: target,
          deleted: true,
          sha256: currentHash,
          source_fingerprint: sourceFingerprint,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_delete", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_move",
    {
      title: "Move CAD MCP Runtime File",
      description:
        "Move/rename one runtime file. source and destination MUST be absolute paths under the CAD MCP runtime.",
      inputSchema: {
        source: z.string().min(1),
        destination: z.string().min(1),
        expected_sha256: z.string().length(64),
      },
    },
    async ({ source, destination, expected_sha256 }) => {
      try {
        const workId = await prepareDevSourceMutation();
        const from = await resolveAbsoluteMutationPath(source, {
          allowedRoots: [runtimeRoot()],
          label: "CAD MCP developer",
        });
        const to = await resolveAbsoluteMutationPath(destination, {
          allowedRoots: [runtimeRoot()],
          forCreate: true,
          label: "CAD MCP developer",
        });
        assertNotGeneratedManifest(from);
        assertNotGeneratedManifest(to);
        const data = await fs.readFile(from);
        if (sha256(data) !== expected_sha256) {
          throw new Error("RESOURCE_CONFLICT: source changed after it was read");
        }
        await fs.mkdir(path.dirname(to), { recursive: true });
        try {
          await fs.writeFile(to, data, { flag: "wx" });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error(`Destination already exists: ${to}`);
          }
          throw error;
        }

        const latest = await fs.readFile(from);
        if (sha256(latest) !== expected_sha256) {
          await fs.rm(to, { force: true }).catch(() => undefined);
          throw new Error(
            "RESOURCE_CONFLICT: source changed during move preparation"
          );
        }

        try {
          await fs.rm(from);
        } catch (error) {
          await fs.rm(to, { force: true }).catch(() => undefined);
          throw error;
        }

        const sourceFingerprint = await recordKnownSourceState(workId);
        return toolResult("cad_mcp_dev_move", {
          source: from,
          destination: to,
          moved: true,
          source_fingerprint: sourceFingerprint,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_move", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_recovery_status",
    {
      title: "CAD MCP Development Recovery Status",
      description:
        "Read-only crash-recovery status. Shows persistent unaccepted baselines that block new CAD MCP mutations.",
      inputSchema: {},
    },
    async () => {
      try {
        await assertDevMode({ allowRecovery: true });
        const pending = await listRecoveryMetadata();
        return toolResult("cad_mcp_dev_recovery_status", {
          blocked: pending.some(
            (item) => item.execution_id !== currentToolLease().workId
          ),
          pending,
          count: pending.length,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_recovery_status", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_recover",
    {
      title: "Recover CAD MCP Source Baseline",
      description:
        "Restore one persistent unaccepted CAD MCP baseline after a crash/failed cleanup. This is the only mutation allowed while a foreign recovery baseline is pending.",
      inputSchema: {
        snapshot_id: z.string().min(1),
        confirmed: z.literal(true),
      },
    },
    async ({ snapshot_id, confirmed }) => {
      try {
        await assertDevMode({ allowRecovery: true });
        if (!confirmed) throw new Error("Explicit confirmation is required");

        const found = await findPersistedSnapshotById(snapshot_id);
        if (!found) {
          throw new Error(
            `CAD_MCP_DEV_RECOVERY_NOT_FOUND: ${snapshot_id}`
          );
        }
        if (found.executionId === currentToolLease().workId) {
          throw new Error(
            "CAD_MCP_DEV_USE_ROLLBACK: this baseline belongs to the current active execution; use cad_mcp_dev_rollback instead of crash recovery."
          );
        }

        try {
          const { cadUpstream } = await import("../runtime/cad-upstream.js");
          if (cadUpstream.status().enabled || cadUpstream.status().connected) {
            await cadUpstream.deactivate();
          }
        } catch {
          // Source recovery proceeds even if the backend was already absent.
        }

        await restoreSnapshotFiles(found.snapshot);
        await removePersistedSnapshot(found.executionId);
        snapshots.delete(found.executionId);
        validatedFingerprints.delete(found.executionId);
        knownSourceFingerprints.delete(found.executionId);
        const { forceClearCadDevSourceTransaction } = await import(
          "../runtime/cad-dev-source-transaction.js"
        );
        forceClearCadDevSourceTransaction(found.executionId);

        const { hasCadProxySurface, syncCadBusinessProxies } = await import("./cad-proxy.js");
        const proxySurface = hasCadProxySurface(server)
          ? { refreshed: true, tools: syncCadBusinessProxies(server) }
          : { refreshed: false };

        return toolResult("cad_mcp_dev_recover", {
          recovered: true,
          snapshot_id,
          recovered_execution_id: found.executionId,
          files: found.snapshot.files.size,
          proxy_surface: proxySurface,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_recover", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_snapshot",
    {
      title: "Snapshot CAD MCP Runtime Source",
      description:
        "Capture an immutable crash-safe source baseline for rollback under CadGPT AppData state. Git is not used.",
      inputSchema: {},
    },
    async () => {
      try {
        const workId = await prepareDevMutation();
        const lease = currentToolLease();
        if (lease.workId !== workId) throw new Error("CAD_MCP_DEV_WORK_CHANGED");
        const existingSnapshot = snapshots.get(lease.workId);
        if (existingSnapshot) {
          throw new Error(
            `CAD_MCP_DEV_SNAPSHOT_EXISTS: baseline ${existingSnapshot.id} already exists for this work execution; accept/rollback/stop before starting a new baseline.`
          );
        }
        if (hasOtherActiveCadWork(lease.workId)) {
          throw new Error(
            "CAD_MCP_DEV_SOURCE_BUSY: finish other CAD/hybrid work before starting a mutable CAD MCP source transaction."
          );
        }
        if (hasActiveCadCapabilityLease()) {
          throw new Error(
            "CAD_MCP_DEV_SOURCE_BUSY: wait for all in-flight CAD/Observator ToolLeases to finish before snapshot."
          );
        }

        const snapshotId = `snapshot_${randomUUID()}`;
        const { beginCadDevSourceTransaction, forceClearCadDevSourceTransaction } =
          await import("../runtime/cad-dev-source-transaction.js");
        beginCadDevSourceTransaction({
          ownerExecutionId: lease.workId,
          snapshotId,
        });

        try {
          const { cadUpstream } = await import("../runtime/cad-upstream.js");
          if (cadUpstream.status().enabled || cadUpstream.status().connected) {
            await cadUpstream.deactivate();
          }

          const beforeCapture = await runtimeFingerprint();
          const files: string[] = [];
          await walk(runtimeRoot(), runtimeRoot(), files, MAX_SNAPSHOT_FILES + 1);
          if (files.length > MAX_SNAPSHOT_FILES) {
            throw new Error("Snapshot exceeds file-count safety limit");
          }

          const captured = new Map<string, Buffer>();
          let bytes = 0;
          for (const file of files) {
            const data = await fs.readFile(file);
            bytes += data.length;
            if (bytes > MAX_SNAPSHOT_BYTES) {
              throw new Error("Snapshot exceeds byte-size safety limit");
            }
            captured.set(path.relative(runtimeRoot(), file), data);
          }

          const baselineFingerprint = fingerprintFileMap(captured);
          const afterCapture = await runtimeFingerprint();
          if (
            beforeCapture !== baselineFingerprint ||
            afterCapture !== baselineFingerprint
          ) {
            throw new Error(
              "CAD_MCP_DEV_EXTERNAL_CHANGE: runtime source changed while the crash-safe baseline was being captured."
            );
          }

          const snapshot: CadMcpDevSnapshot = {
            id: snapshotId,
            files: captured,
            createdAt: new Date().toISOString(),
            baselineFingerprint,
          };
          await persistSnapshot(lease.workId, snapshot);
          snapshots.set(lease.workId, snapshot);
          knownSourceFingerprints.set(
            lease.workId,
            snapshot.baselineFingerprint
          );
          return toolResult("cad_mcp_dev_snapshot", {
            snapshot_id: snapshot.id,
            files: captured.size,
            bytes,
            created_at: snapshot.createdAt,
            baseline_fingerprint: snapshot.baselineFingerprint,
            crash_safe: true,
            cad_runtime_reserved: true,
          });
        } catch (error) {
          forceClearCadDevSourceTransaction(lease.workId);
          throw error;
        }
      } catch (error) {
        return toolError("cad_mcp_dev_snapshot", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_rollback",
    {
      title: "Rollback CAD MCP Runtime Source",
      description:
        "Restore the current cad-mcp-dev work execution's in-memory source snapshot. No Git operation is used.",
      inputSchema: { snapshot_id: z.string().min(1) },
    },
    async ({ snapshot_id }) => {
      try {
        await assertDevMode();
        const lease = currentToolLease();
        const snapshot = snapshots.get(lease.workId);
        if (!snapshot || snapshot.id !== snapshot_id) {
          throw new Error("Snapshot not found for this work execution");
        }

        const { abortCadCandidate } = await import("../runtime/cad-candidate.js");
        await abortCadCandidate(lease.workId).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("NO_CAD_CANDIDATE")) throw error;
        });
        validatedFingerprints.delete(lease.workId);
        await assertKnownSourceState(lease.workId);

        await restoreSnapshotFiles(snapshot);
        await removePersistedSnapshot(lease.workId);
        snapshots.delete(lease.workId);
        knownSourceFingerprints.delete(lease.workId);
        const { endCadDevSourceTransaction } = await import(
          "../runtime/cad-dev-source-transaction.js"
        );
        endCadDevSourceTransaction(lease.workId);

        const { hasCadProxySurface, syncCadBusinessProxies } = await import("./cad-proxy.js");
        const proxySurface = hasCadProxySurface(server)
          ? { refreshed: true, tools: syncCadBusinessProxies(server) }
          : { refreshed: false };

        return toolResult("cad_mcp_dev_rollback", {
          snapshot_id,
          restored: true,
          files: snapshot.files.size,
          proxy_surface: proxySurface,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_rollback", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_validate",
    {
      title: "Validate CAD MCP Candidate Source",
      description:
        "Run named safe validations without raw shell access. manifest regenerates the CAD MCP Internal Registry artifact.",
      inputSchema: {
        action: z.enum(["compile", "runtime_import", "manifest", "all"]),
      },
    },
    async ({ action }) => {
      try {
        await assertDevMode();
        const lease = currentToolLease();
        if (action === "manifest" || action === "all") {
          if (!snapshots.has(lease.workId)) {
            throw new Error(
              "CAD_MCP_DEV_SNAPSHOT_REQUIRED: create cad_mcp_dev_snapshot before regenerating the CAD MCP manifest."
            );
          }
          await assertKnownSourceState(lease.workId);
          const { assertCadCandidateSourceMutationAllowed } = await import("../runtime/cad-candidate.js");
          assertCadCandidateSourceMutationAllowed(lease.workId);
          validatedFingerprints.delete(lease.workId);
        }
        const results: Record<string, unknown> = {};
        if (action === "all") {
          results.dependency_lock = await validateLockedRequirements();
        }
        if (action === "compile" || action === "all") {
          results.compile = await runPython(["-m", "compileall", "-q", runtimeRoot()]);
        }
        if (action === "runtime_import" || action === "all") {
          const runtimePathLiteral = JSON.stringify(runtimeRoot());
          const code =
            "import sys; sys.path.insert(0, " +
            runtimePathLiteral +
            "); import main; print('cad-mcp import ok')";
          results.runtime_import = await runPython(["-c", code], runtimeRoot());
        }
        if (action === "manifest" || action === "all") {
          results.manifest = await refreshManifest();
          results.source_fingerprint = await recordKnownSourceState(
            lease.workId
          );
          const { hasCadProxySurface, syncCadBusinessProxies } = await import("./cad-proxy.js");
          results.proxy_surface = hasCadProxySurface(server)
            ? {
                tools: syncCadBusinessProxies(server),
                refreshed: true,
              }
            : {
                refreshed: false,
                reason:
                  "CAD family is not loaded in this MCP session; regenerated manifest will be used on first CAD family load.",
              };
        }

        let validatedFingerprint: string | null = null;
        if (action === "all") {
          validatedFingerprint =
            knownSourceFingerprints.get(lease.workId) ??
            (await recordKnownSourceState(lease.workId));
          validatedFingerprints.set(lease.workId, validatedFingerprint);
        }

        return toolResult("cad_mcp_dev_validate", {
          action,
          results,
          validated_fingerprint: validatedFingerprint,
          live_candidate_ready: action === "all",
          git_used: false,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_validate", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_accept_local",
    {
      title: "Accept Validated CAD MCP Local Source",
      description:
        "Accept the validated local CAD MCP source without live AutoCAD candidate testing when live CAD validation is not required. Requires cad_mcp_dev_validate(action=all), unchanged source fingerprint, and explicit confirmation.",
      inputSchema: {
        confirmed: z.literal(true),
      },
    },
    async ({ confirmed }) => {
      try {
        await assertDevMode();
        if (!confirmed) throw new Error("Explicit confirmation is required");
        const lease = currentToolLease();
        const { candidateStatus } = await import("../runtime/cad-candidate.js");
        if (candidateStatus()) {
          throw new Error(
            "CAD_CANDIDATE_ACTIVE: accept or rollback the live candidate instead of using local-only acceptance."
          );
        }

        if (!snapshots.has(lease.workId)) {
          throw new Error(
            "CAD_MCP_DEV_SNAPSHOT_REQUIRED: create a source snapshot before editing so unaccepted work can roll back safely."
          );
        }

        const validatedFingerprint = validatedFingerprints.get(lease.workId);
        if (!validatedFingerprint) {
          throw new Error(
            "CAD_MCP_DEV_NOT_VALIDATED: run cad_mcp_dev_validate with action=all after the final source edit."
          );
        }
        const currentFingerprint = await runtimeFingerprint();
        if (currentFingerprint !== validatedFingerprint) {
          throw new Error(
            "CAD_MCP_DEV_SOURCE_CHANGED: source changed after validation; validate action=all again."
          );
        }

        await removePersistedSnapshot(lease.workId);
        snapshots.delete(lease.workId);
        validatedFingerprints.delete(lease.workId);
        knownSourceFingerprints.delete(lease.workId);
        const { endCadDevSourceTransaction } = await import(
          "../runtime/cad-dev-source-transaction.js"
        );
        endCadDevSourceTransaction(lease.workId);
        return toolResult("cad_mcp_dev_accept_local", {
          accepted: true,
          source_fingerprint: currentFingerprint,
          live_cad_tested: false,
          git_used: false,
          note:
            "Local CAD MCP source is accepted for this development cycle. No Git action was performed.",
        });
      } catch (error) {
        return toolError("cad_mcp_dev_accept_local", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_candidate_status",
    {
      title: "CAD MCP Candidate Runtime Status",
      description:
        "Report the live candidate generation owned by this cad-mcp-dev execution, if any.",
      inputSchema: {},
    },
    async () => {
      try {
        await assertDevMode();
        const lease = currentToolLease();
        const { candidateStatus } = await import("../runtime/cad-candidate.js");
        const state = candidateStatus();
        return toolResult("cad_mcp_dev_candidate_status", {
          active: Boolean(state),
          owned_by_this_execution: Boolean(state && state.ownerExecutionId === lease.workId),
          candidate: state,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_candidate_status", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_candidate_start",
    {
      title: "Start Exclusive CAD MCP Candidate Generation",
      description:
        "After snapshot + cad_mcp_dev_validate(action=all), reserve CAD MCP exclusively for this execution and restart it from the validated candidate source on the next CAD call. Requires HYBRID/CAD work and explicit confirmation.",
      inputSchema: {
        snapshot_id: z.string().min(1),
        confirmed: z.literal(true),
      },
    },
    async ({ snapshot_id, confirmed }) => {
      try {
        await assertDevMode();
        if (!confirmed) throw new Error("Explicit confirmation is required");
        const lease = currentToolLease();
        if (!executionSupportsCad(lease.workId)) {
          throw new Error(
            "CAD_CANDIDATE_REQUIRES_HYBRID_WORK: start cad-mcp-dev with execution_path=hybrid for live AutoCAD validation."
          );
        }

        const snapshot = snapshots.get(lease.workId);
        if (!snapshot || snapshot.id !== snapshot_id) {
          throw new Error("Candidate start requires this execution's current source snapshot");
        }
        const { cadDevSourceTransactionStatus } = await import(
          "../runtime/cad-dev-source-transaction.js"
        );
        const sourceTransaction = cadDevSourceTransactionStatus();
        if (
          !sourceTransaction ||
          sourceTransaction.ownerExecutionId !== lease.workId ||
          sourceTransaction.snapshotId !== snapshot.id
        ) {
          throw new Error(
            "CAD_MCP_DEV_SOURCE_TRANSACTION_REQUIRED: candidate must use the currently reserved source transaction and its exact baseline snapshot."
          );
        }

        const validatedFingerprint = validatedFingerprints.get(lease.workId);
        if (!validatedFingerprint) {
          throw new Error(
            "CAD_CANDIDATE_NOT_VALIDATED: run cad_mcp_dev_validate with action=all after the final source edit."
          );
        }
        const currentFingerprint = await runtimeFingerprint();
        if (currentFingerprint !== validatedFingerprint) {
          throw new Error(
            "CAD_CANDIDATE_SOURCE_CHANGED: runtime source changed after validation; validate action=all again."
          );
        }

        const { beginCadCandidate } = await import("../runtime/cad-candidate.js");
        const candidate = await beginCadCandidate({
          ownerExecutionId: lease.workId,
          snapshotId: snapshot.id,
          sourceFingerprint: currentFingerprint,
        });

        return toolResult("cad_mcp_dev_candidate_start", {
          candidate,
          cad_backend_started: false,
          next:
            "Use the normal CAD path with an explicitly approved drawing. The first CAD call starts a fresh candidate CAD MCP process; other CAD executions are blocked until accept or rollback.",
        });
      } catch (error) {
        return toolError("cad_mcp_dev_candidate_start", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_candidate_accept",
    {
      title: "Accept CAD MCP Candidate Generation",
      description:
        "End exclusive candidate mode after successful live validation. Source remains as the accepted local runtime; the candidate CAD MCP process is stopped so later work starts cleanly.",
      inputSchema: {
        validated_tool: z.string().min(1).describe("A CAD tool name that succeeded during this candidate generation, e.g. cad__cad_list_layers"),
        confirmed: z.literal(true),
      },
    },
    async ({ validated_tool, confirmed }) => {
      try {
        await assertDevMode();
        if (!confirmed) throw new Error("Explicit confirmation is required");
        const lease = currentToolLease();
        const { candidateStatus, acceptCadCandidate } = await import("../runtime/cad-candidate.js");
        const active = candidateStatus();
        if (!active || active.ownerExecutionId !== lease.workId) {
          throw new Error("NO_CAD_CANDIDATE: this execution does not own an active candidate.");
        }
        const currentFingerprint = await runtimeFingerprint();
        if (currentFingerprint !== active.sourceFingerprint) {
          throw new Error(
            "CAD_CANDIDATE_SOURCE_CHANGED: local runtime source changed after candidate validation; rollback and validate a new candidate."
          );
        }
        const snapshot = snapshots.get(lease.workId);
        if (!snapshot) {
          throw new Error("CAD_MCP_DEV_SNAPSHOT_REQUIRED: candidate baseline is missing.");
        }

        const candidate = await acceptCadCandidate(lease.workId, validated_tool);
        try {
          await removePersistedSnapshot(lease.workId);
        } catch (error) {
          await restoreSnapshotFiles(snapshot).catch(() => undefined);
          throw error;
        }
        snapshots.delete(lease.workId);
        validatedFingerprints.delete(lease.workId);
        knownSourceFingerprints.delete(lease.workId);
        const { endCadDevSourceTransaction } = await import(
          "../runtime/cad-dev-source-transaction.js"
        );
        endCadDevSourceTransaction(lease.workId);
        return toolResult("cad_mcp_dev_candidate_accept", {
          accepted: true,
          candidate,
          git_used: false,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_candidate_accept", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_sync_env",
    {
      title: "Sync CAD MCP Python Environment",
      description:
        "Named privileged development action. Reinstall the CAD MCP venv from the runtime lock file. Requires explicit confirmation; no arbitrary command is accepted.",
      inputSchema: { confirmed: z.literal(true) },
    },
    async ({ confirmed }) => {
      try {
        if (!confirmed) throw new Error("Explicit confirmation is required");
        const workId = await prepareDevSourceMutation();
        const lease = currentToolLease();
        if (lease.workId !== workId) throw new Error("CAD_MCP_DEV_WORK_CHANGED");
        const lock = await validateLockedRequirements();
        const result = await runPython(["-m", "pip", "install", "-r", lock.path], getRepoRoot());
        return toolResult("cad_mcp_dev_sync_env", {
          synced: true,
          requirements: lock.path,
          packages: lock.packages,
          ...result,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_sync_env", error);
      }
    }
  );
}

export async function rollbackUnacceptedCadMcpDevStateForExecution(
  executionId: string
): Promise<{ restored: boolean }> {
  const snapshot =
    snapshots.get(executionId) ??
    (await loadPersistedSnapshot(executionId));
  if (!snapshot) {
    validatedFingerprints.delete(executionId);
    knownSourceFingerprints.delete(executionId);
    return { restored: false };
  }

  const expected = knownSourceFingerprints.get(executionId);
  if (expected) {
    const current = await runtimeFingerprint();
    if (current !== expected) {
      throw new Error(
        "CAD_MCP_DEV_EXTERNAL_CHANGE: automatic rollback refused because runtime source changed outside CadGPT; persistent baseline retained for confirmed recovery."
      );
    }
  }

  await restoreSnapshotFiles(snapshot);
  await removePersistedSnapshot(executionId);
  snapshots.delete(executionId);
  validatedFingerprints.delete(executionId);
  knownSourceFingerprints.delete(executionId);
  const { forceClearCadDevSourceTransaction } = await import(
    "../runtime/cad-dev-source-transaction.js"
  );
  forceClearCadDevSourceTransaction(executionId);
  return { restored: true };
}
