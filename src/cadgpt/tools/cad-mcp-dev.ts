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
import { currentToolLease, executionSupportsCad, isDevelopmentBuild } from "../lib/work-registration.js";
import { toolError, toolResult } from "../lib/tool-result.js";

const execFileAsync = promisify(execFile);
const MAX_READ_BYTES = 512 * 1024;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_SNAPSHOT_FILES = 3000;
const snapshots = new Map<
  string,
  { id: string; files: Map<string, Buffer>; createdAt: string }
>();
const validatedFingerprints = new Map<string, string>();

function assertDevMode(): void {
  if (!isDevelopmentBuild()) {
    throw new Error("DEVELOPMENT_ONLY: cad-mcp-dev is unavailable in production builds.");
  }
  const lease = currentToolLease();
  if (lease.ownerId !== "cad-mcp-dev") {
    throw new Error("CAD_MCP_DEV_REQUIRED: current work owner must be cad-mcp-dev.");
  }
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
    if (entry.name === "__pycache__" || entry.name.startsWith(".")) continue;
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

async function runPython(args: string[], cwd = runtimeRoot()) {
  const python =
    process.env.CAD_MCP_PYTHON ||
    path.join(getRepoRoot(), ".venv-cad", "Scripts", "python.exe");
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

async function runtimeFingerprint(): Promise<string> {
  const files: string[] = [];
  await walk(runtimeRoot(), runtimeRoot(), files, MAX_SNAPSHOT_FILES + 1);
  if (files.length > MAX_SNAPSHOT_FILES) {
    throw new Error("Runtime fingerprint exceeds file-count safety limit");
  }
  files.sort((a, b) => a.localeCompare(b));
  const hash = createHash("sha256");
  for (const file of files) {
    const relative = path.relative(runtimeRoot(), file).replaceAll("\\", "/");
    const data = await fs.readFile(file);
    hash.update(relative);
    hash.update("\0");
    hash.update(sha256(data));
    hash.update("\n");
  }
  return hash.digest("hex");
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
        assertDevMode();
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
        assertDevMode();
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
        assertDevMode();
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
        assertDevMode();
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
        assertDevMode();
        const target = await resolveAbsoluteMutationPath(input, {
          allowedRoots: [runtimeRoot()],
          forCreate: true,
          label: "CAD MCP developer",
        });
        try {
          await fs.lstat(target);
          throw new Error(`Target already exists: ${target}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await atomicWrite(target, content);
        return toolResult("cad_mcp_dev_create", {
          absolute_path: target,
          sha256: sha256(content),
          bytes: Buffer.byteLength(content),
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
        assertDevMode();
        const target = await resolveAbsoluteMutationPath(input, {
          allowedRoots: [runtimeRoot()],
          label: "CAD MCP developer",
        });
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
        await atomicWrite(target, updated);
        return toolResult("cad_mcp_dev_edit", {
          absolute_path: target,
          sha256_before: currentHash,
          sha256_after: sha256(updated),
          changed: updated !== original,
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
        assertDevMode();
        const target = await resolveAbsoluteMutationPath(input, {
          allowedRoots: [runtimeRoot()],
          label: "CAD MCP developer",
        });
        const stat = await fs.stat(target);
        if (!stat.isFile()) throw new Error("Delete target must be a file");
        const data = await fs.readFile(target);
        const currentHash = sha256(data);
        if (currentHash !== expected_sha256) {
          throw new Error("RESOURCE_CONFLICT: file changed after it was read");
        }
        await fs.rm(target);
        return toolResult("cad_mcp_dev_delete", {
          absolute_path: target,
          deleted: true,
          sha256: currentHash,
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
        assertDevMode();
        const from = await resolveAbsoluteMutationPath(source, {
          allowedRoots: [runtimeRoot()],
          label: "CAD MCP developer",
        });
        const to = await resolveAbsoluteMutationPath(destination, {
          allowedRoots: [runtimeRoot()],
          forCreate: true,
          label: "CAD MCP developer",
        });
        const data = await fs.readFile(from);
        if (sha256(data) !== expected_sha256) {
          throw new Error("RESOURCE_CONFLICT: source changed after it was read");
        }
        try {
          await fs.lstat(to);
          throw new Error(`Destination already exists: ${to}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to);
        return toolResult("cad_mcp_dev_move", {
          source: from,
          destination: to,
          moved: true,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_move", error);
      }
    }
  );

  server.registerTool(
    "cad_mcp_dev_snapshot",
    {
      title: "Snapshot CAD MCP Runtime Source",
      description:
        "Capture an in-memory source baseline for rollback. Git is not used.",
      inputSchema: {},
    },
    async () => {
      try {
        assertDevMode();
        const lease = currentToolLease();
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
        const snapshot = {
          id: `snapshot_${randomUUID()}`,
          files: captured,
          createdAt: new Date().toISOString(),
        };
        snapshots.set(lease.workId, snapshot);
        return toolResult("cad_mcp_dev_snapshot", {
          snapshot_id: snapshot.id,
          files: captured.size,
          bytes,
          created_at: snapshot.createdAt,
        });
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
        assertDevMode();
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

        const current: string[] = [];
        await walk(runtimeRoot(), runtimeRoot(), current, MAX_SNAPSHOT_FILES + 1);
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
        return toolResult("cad_mcp_dev_rollback", {
          snapshot_id,
          restored: true,
          files: snapshot.files.size,
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
        assertDevMode();
        const results: Record<string, unknown> = {};
        if (action === "compile" || action === "all") {
          results.compile = await runPython(["-m", "compileall", "-q", runtimeRoot()]);
        }
        if (action === "runtime_import" || action === "all") {
          const code =
            "import sys; sys.path.insert(0, r'" +
            runtimeRoot().replaceAll("\\", "\\\\") +
            "'); import main; print('cad-mcp import ok')";
          results.runtime_import = await runPython(["-c", code], runtimeRoot());
        }
        if (action === "manifest" || action === "all") {
          results.manifest = await refreshManifest();
          const { syncCadBusinessProxies } = await import("./cad-proxy.js");
          results.proxy_surface = {
            tools: syncCadBusinessProxies(server),
            refreshed: true,
          };
        }

        let validatedFingerprint: string | null = null;
        if (action === "all") {
          const lease = currentToolLease();
          validatedFingerprint = await runtimeFingerprint();
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
    "cad_mcp_dev_candidate_status",
    {
      title: "CAD MCP Candidate Runtime Status",
      description:
        "Report the live candidate generation owned by this cad-mcp-dev execution, if any.",
      inputSchema: {},
    },
    async () => {
      try {
        assertDevMode();
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
        assertDevMode();
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
      inputSchema: { confirmed: z.literal(true) },
    },
    async ({ confirmed }) => {
      try {
        assertDevMode();
        if (!confirmed) throw new Error("Explicit confirmation is required");
        const lease = currentToolLease();
        const { acceptCadCandidate } = await import("../runtime/cad-candidate.js");
        const candidate = await acceptCadCandidate(lease.workId);
        snapshots.delete(lease.workId);
        validatedFingerprints.delete(lease.workId);
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
        assertDevMode();
        if (!confirmed) throw new Error("Explicit confirmation is required");
        const lease = currentToolLease();
        validatedFingerprints.delete(lease.workId);
        const requirements = path.join(runtimeRoot(), "requirements.lock.txt");
        const result = await runPython(["-m", "pip", "install", "-r", requirements], getRepoRoot());
        return toolResult("cad_mcp_dev_sync_env", {
          synced: true,
          requirements,
          ...result,
        });
      } catch (error) {
        return toolError("cad_mcp_dev_sync_env", error);
      }
    }
  );
}

export function clearCadMcpDevStateForExecution(executionId: string): void {
  snapshots.delete(executionId);
  validatedFingerprints.delete(executionId);
}
