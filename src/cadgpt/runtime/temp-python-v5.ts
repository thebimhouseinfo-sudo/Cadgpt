import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getOwnedTempPython } from "./temp-job-v5.js";
import { ownedSourceRoot } from "../lib/owned-source.js";
import { pythonExecutable } from "../tools/job-system-helper.js";

const runExecutable = promisify(execFile);
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/**
 * A file-only runner for trusted, exact owned Temp Python source.
 *
 * This does NOT constitute an OS sandbox. The code is trusted Builder code;
 * untrusted downloaded programs or CAD COM automation must not be run here.
 * There is no shell command surface, arbitrary argv or Job SYSTEM lease.
 */
export async function runOwnedTempPython(input: {
  id: string;
  execution: string;
  session: string;
  relativeFile: string;
  expectedSha256: string;
  inputJson: string;
}) {
  const { id, execution, session, relativeFile, expectedSha256, inputJson } = input;
  const source = await getOwnedTempPython(id, execution, session, relativeFile);
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new Error("TEMP_PYTHON_SHA256_REQUIRED");
  if (Buffer.byteLength(inputJson) > 2 * 1024 * 1024) throw new Error("TEMP_PYTHON_INPUT_TOO_LARGE");
  JSON.parse(inputJson);
  const bytes = await fs.readFile(source);
  if (sha256(bytes) !== expectedSha256.toLowerCase()) throw new Error("TEMP_PYTHON_SOURCE_CONFLICT");

  const root = ownedSourceRoot({ kind: "temp-job", id });
  const realRoot = await fs.realpath(root);
  const runFolder = path.join(realRoot, "runtime");
  await fs.mkdir(runFolder, { recursive: true });
  const canonicalRuntime = await fs.realpath(runFolder);
  if (path.dirname(canonicalRuntime) !== realRoot) throw new Error("TEMP_PYTHON_RUNTIME_ESCAPE");

  const unique = randomUUID();
  const snapshot = path.join(canonicalRuntime, ".temp-python-" + unique + ".py");
  const data = path.join(canonicalRuntime, ".temp-python-" + unique + ".json");
  try {
    await fs.writeFile(snapshot, bytes, { flag: "wx" });
    await fs.writeFile(data, inputJson, { flag: "wx" });
    if (sha256(await fs.readFile(snapshot)) !== expectedSha256.toLowerCase()) {
      throw new Error("TEMP_PYTHON_SNAPSHOT_CONFLICT");
    }
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SYSTEMROOT: process.env.SYSTEMROOT,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      PYTHONNOUSERSITE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      CADGPT_TEMP_JOB_ROOT: realRoot,
      CADGPT_TEMP_RUNTIME_ROOT: canonicalRuntime,
      CADGPT_TEMP_FILE_ONLY: "1",
    };
    const { stdout, stderr } = await runExecutable(
      pythonExecutable(), ["-I", "-X", "utf8", snapshot, data], {
        cwd: canonicalRuntime,
        env,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 256 * 1024,
      }
    );
    return { id, source, sha256: expectedSha256.toLowerCase(), stdout, stderr, exit_code: 0 };
  } finally {
    await fs.rm(snapshot, { force: true }).catch(() => undefined);
    await fs.rm(data, { force: true }).catch(() => undefined);
  }
}
