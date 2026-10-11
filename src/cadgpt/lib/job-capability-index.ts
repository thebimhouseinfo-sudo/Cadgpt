import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getAppDataPath, getUserCapabilitiesPath } from "./appdata.js";
import { resolveRegisteredAssetPath } from "../tools/user-assets.js";
import { inspectJobBundle } from "./job-bundle.js";
import { validateLispSource } from "../tools/lisp-harness.js";

export interface ExportedJobCapability {
  kind: "tool";
  registry: "user";
  class: "job.exported.lisp";
  id: string;
  name: string;
  job_id: string;
  command: string;
  relative_path: string;
  source_sha256: string;
  source_bundle_sha256: string;
  required_work: "hybrid";
  callable: true;
  prepare_tool: "job_capability_prepare";
  run_tool: "cad__cad_run_lisp_command";
  summary: string;
}

export interface JobCapabilityIndex {
  version: 1;
  job_id: string;
  signature: string;
  bundle_sha256: string;
  scanned_at: string;
  capabilities: ExportedJobCapability[];
  unavailable: Array<{ file: string; reason: string }>;
}

interface StandaloneLispManifest {
  version: 1;
  exports: Array<{
    command: string;
    source: string;
    standalone: true;
    input: { args: [] };
    output: "cad_tool_result";
    effect: "cad-readonly" | "cad-write";
    dependencies: [];
  }>;
}

/** No implicit export of C: commands: every callable has a reviewed contract. */
async function readStandaloneManifest(root: string): Promise<StandaloneLispManifest | null> {
  const filename = path.join(root, "tools", "capabilities.json");
  let bytes: string;
  try {
    bytes = await fs.readFile(filename, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (bytes.length > 100_000) throw new Error("JOB_CAPABILITY_MANIFEST_TOO_LARGE");
  const parsed = JSON.parse(bytes) as Partial<StandaloneLispManifest>;
  if (parsed.version !== 1 || !Array.isArray(parsed.exports) || parsed.exports.length > 100)
    throw new Error("JOB_CAPABILITY_MANIFEST_INVALID");
  return parsed as StandaloneLispManifest;
}

interface JobRegistration {
  kind: "job";
  id: string;
  library_id: string;
  relative_path: string;
}

const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const indexRoot = () => getAppDataPath("state", "job-capabilities");
const indexPath = (jobId: string) =>
  path.join(indexRoot(), digest(jobId.trim().toLowerCase()) + ".json");

function safePath(root: string, rel: string): string {
  const resolved = path.resolve(root, rel);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("JOB_CAPABILITY_SCOPE: asset escapes registered Job package");
  return resolved;
}

async function registeredJob(jobId: string): Promise<{
  source: string;
  job: JobRegistration;
}> {
  const registry = JSON.parse(await fs.readFile(getUserCapabilitiesPath(), "utf8")) as {
    entries?: JobRegistration[];
  };
  const found = (registry.entries ?? []).filter((entry) =>
    entry.kind === "job" && entry.id?.toLowerCase() === jobId.trim().toLowerCase()
  );
  if (found.length !== 1) throw new Error("JOB_CAPABILITY_UNKNOWN_JOB: " + jobId);
  const job = found[0];
  const source = await resolveRegisteredAssetPath(
    "job", job.library_id, job.relative_path
  );
  return { source, job };
}

/** Stat-only change detection. No source reads on an unchanged re-invocation. */
async function signatureFor(source: string): Promise<string> {
  const root = path.dirname(source);
  const records: string[] = [];
  async function walk(target: string, relative: string): Promise<void> {
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error("JOB_CAPABILITY_SYMLINK_BLOCKED");
    records.push(relative + ":" + stat.size + ":" + stat.mtimeMs);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(target)).sort()) {
        await walk(path.join(target, name), relative + "/" + name);
      }
    }
  }
  await walk(source, path.basename(source));
  for (const name of ["lisp", "dynamic-lisp", "tools"]) {
    await walk(path.join(root, name), name);
  }
  return digest(records.join("\n"));
}

async function readIndex(jobId: string): Promise<JobCapabilityIndex | null> {
  try {
    const value = JSON.parse(await fs.readFile(indexPath(jobId), "utf8")) as JobCapabilityIndex;
    return value.version === 1 && value.job_id.toLowerCase() === jobId.toLowerCase()
      ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null; // corrupted cache is repaired by a fresh scan, never executed
  }
}

async function saveIndex(value: JobCapabilityIndex): Promise<void> {
  await fs.mkdir(indexRoot(), { recursive: true });
  const target = indexPath(value.job_id);
  const pending = target + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(pending, JSON.stringify(value, null, 2) + "\n", "utf8");
    await fs.rename(pending, target);
  } finally {
    await fs.rm(pending, { force: true }).catch(() => undefined);
  }
}

export async function ensureJobCapabilityIndex(jobId: string): Promise<JobCapabilityIndex> {
  const { source, job } = await registeredJob(jobId);
  const signature = await signatureFor(source);
  const cached = await readIndex(job.id);
  if (cached && cached.signature === signature) return cached;

  const bundle = await inspectJobBundle(source);
  if (!bundle.exists || !bundle.sha256)
    throw new Error("JOB_CAPABILITY_BUNDLE_MISSING: " + job.id);

  const capabilities: ExportedJobCapability[] = [];
  const unavailable: JobCapabilityIndex["unavailable"] = [];
  const root = path.dirname(source);
  const manifest = await readStandaloneManifest(root);
  if (!manifest) {
    unavailable.push({
      file: "tools/capabilities.json",
      reason: "No reviewed standalone export contract; C: commands remain private helpers",
    });
  }
  const commands = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of manifest?.exports ?? []) {
    const relative = typeof entry.source === "string"
      ? entry.source.replaceAll("\\", "/") : "";
    const command = typeof entry.command === "string"
      ? entry.command.trim().toUpperCase() : "";
    if (!/^(?:lisp|dynamic-lisp)\/[A-Za-z0-9_./-]+\.lsp$/i.test(relative) ||
        relative.includes("..") || !bundle.files.includes(relative) ||
        !/^[A-Z0-9_-]{1,80}$/.test(command) ||
        entry.standalone !== true || !entry.input ||
        !Array.isArray(entry.input.args) || entry.input.args.length !== 0 ||
        entry.output !== "cad_tool_result" ||
        !["cad-readonly", "cad-write"].includes(entry.effect) ||
        !Array.isArray(entry.dependencies) || entry.dependencies.length !== 0) {
      unavailable.push({ file: relative || "manifest", reason: "Missing or invalid independent input/output/effect/dependency contract" });
      continue;
    }
    if (commands.has(command)) {
      duplicates.add(command);
      unavailable.push({ file: relative, reason: "Duplicate exported command: " + command });
      continue;
    }
    commands.add(command);
    const absolute = safePath(root, relative);
    const sourceText = await fs.readFile(absolute, "utf8");
    const result = validateLispSource(sourceText, [command], {
      profile: "syntax", fileName: path.basename(absolute),
    });
    if (!result.valid || !result.commands.includes(command)) {
      unavailable.push({ file: relative, reason: "Export source or declared C:command failed validation" });
      continue;
    }
    capabilities.push({
      kind: "tool",
      registry: "user",
      class: "job.exported.lisp",
      id: "custom:" + job.id + ":" + command,
      name: command,
      job_id: job.id,
      command,
      relative_path: relative,
      source_sha256: result.sha256,
      source_bundle_sha256: bundle.sha256,
      required_work: "hybrid",
      callable: true,
      prepare_tool: "job_capability_prepare",
      run_tool: "cad__cad_run_lisp_command",
      summary: "Reviewed standalone AutoLISP (" + entry.effect + ", no positional arguments); prepare and invoke via bound CAD tools.",
    });
  }
  for (const command of duplicates) {
    for (const match of capabilities.filter((item) => item.command === command))
      unavailable.push({ file: match.relative_path, reason: "Duplicate exported command: " + command });
  }
  const index: JobCapabilityIndex = {
    version: 1,
    job_id: job.id,
    signature,
    bundle_sha256: bundle.sha256,
    scanned_at: new Date().toISOString(),
    capabilities: capabilities.filter((item) => !duplicates.has(item.command)),
    unavailable,
  };
  await saveIndex(index);
  return index;
}

export async function getVerifiedJobCapability(
  capabilityId: string
): Promise<{ capability: ExportedJobCapability; absolute_path: string }> {
  const parts = /^custom:([^:]+):([^:]+)$/i.exec(capabilityId);
  if (!parts) throw new Error("JOB_CAPABILITY_ID_REQUIRED");
  const index = await ensureJobCapabilityIndex(parts[1]);
  const capability = index.capabilities.find(
    (entry) => entry.id.toLowerCase() === capabilityId.trim().toLowerCase()
  );
  if (!capability) throw new Error("JOB_CAPABILITY_NOT_CALLABLE: " + capabilityId);
  const { source } = await registeredJob(index.job_id);
  const absolute = safePath(path.dirname(source), capability.relative_path);
  const bytes = await fs.readFile(absolute);
  if (digest(bytes) !== capability.source_sha256)
    throw new Error("RESOURCE_CONFLICT: Job capability source changed before invocation");
  return { capability, absolute_path: absolute };
}

/** Cheap discovery: never scans the library just to render registry_list. */
export async function listStoredJobCapabilities(): Promise<ExportedJobCapability[]> {
  const names = await fs.readdir(indexRoot()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  const raw = await fs.readFile(getUserCapabilitiesPath(), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return '{"entries":[]}';
    throw error;
  });
  const parsed = JSON.parse(raw) as { entries?: Array<{ kind?: string; id?: string }> };
  const activeIds = new Set((parsed.entries ?? [])
    .filter((item) => item.kind === "job" && typeof item.id === "string")
    .map((item) => item.id!.toLowerCase()));
  const result: ExportedJobCapability[] = [];
  for (const file of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    try {
      const index = JSON.parse(await fs.readFile(path.join(indexRoot(), file), "utf8")) as JobCapabilityIndex;
      if (index.version === 1 && activeIds.has(index.job_id.toLowerCase()) && Array.isArray(index.capabilities))
        result.push(...index.capabilities);
    } catch {
      // Invalid indexes are ignored; next Job invocation will rebuild them.
    }
  }
  return result;
}
