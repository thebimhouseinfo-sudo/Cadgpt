import fs from "node:fs/promises";
import path from "node:path";

import {
  getAppDataRoot,
  getJobDraftRoot,
  getJobLibrariesRoot,
  getJobRunRoot,
} from "./appdata.js";
import { getRepoRoot, isPathInside } from "./path-security.js";

interface LispRoot {
  root: string;
  virtualPrefix: string;
  jobOwned: boolean;
}

function roots(): LispRoot[] {
  return [
    {
      root: path.resolve(getRepoRoot(), "resources", "cad"),
      virtualPrefix: "resources/cad",
      jobOwned: false,
    },
    {
      root: path.resolve(getAppDataRoot(), "libraries", "lisp"),
      virtualPrefix: "appdata/libraries/lisp",
      jobOwned: false,
    },
    {
      root: path.resolve(getAppDataRoot(), "workspace", "lisp-draft"),
      virtualPrefix: "appdata/workspace/lisp-draft",
      jobOwned: false,
    },
    {
      root: path.resolve(getAppDataRoot(), "runtime", "dynamic-lisp"),
      virtualPrefix: "appdata/runtime/dynamic-lisp",
      jobOwned: false,
    },
    {
      root: path.resolve(getJobDraftRoot()),
      virtualPrefix: "appdata/workspace/job-draft",
      jobOwned: true,
    },
    {
      root: path.resolve(getJobRunRoot()),
      virtualPrefix: "appdata/workspace/job-run",
      jobOwned: true,
    },
    {
      root: path.resolve(getJobLibrariesRoot()),
      virtualPrefix: "appdata/libraries/jobs",
      jobOwned: true,
    },
  ];
}

export function isJobOwnedLispPath(
  candidate: string,
  root: string
): boolean {
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return false;
  }
  const parts = relative
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (parts.length < 2) return false;
  return parts
    .slice(0, -1)
    .some(
      (part) =>
        part === "lisp" ||
        part === "dynamic-lisp"
    );
}

async function canonicalRoot(
  root: string
): Promise<string> {
  try {
    return await fs.realpath(root);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !==
      "ENOENT"
    ) {
      throw error;
    }
    return path.resolve(root);
  }
}

function findRootForVirtualPath(
  normalized: string,
  approved: LispRoot[]
): { entry: LispRoot; suffix: string } | null {
  const lower = normalized.toLowerCase();
  for (const entry of approved) {
    const prefix = `${entry.virtualPrefix}/`;
    if (lower.startsWith(prefix.toLowerCase())) {
      return {
        entry,
        suffix: normalized.slice(prefix.length),
      };
    }
  }
  return null;
}

export async function resolveCadGptLispPath(
  requestedPath: string,
  options: { humanPower?: boolean } = {}
): Promise<string> {
  const raw = requestedPath.trim();
  if (!raw) {
    throw new Error(
      "LISP_COMMAND_SCOPE: Lisp path is required."
    );
  }

  const humanPower = options.humanPower === true;
  const approved = roots();
  let candidate: string;
  if (path.isAbsolute(raw)) {
    candidate = path.resolve(raw);
    const matchedRoot =
      approved.find((entry) =>
        isPathInside(candidate, entry.root)
      ) ?? null;
    if (!matchedRoot && !humanPower) {
      throw new Error(
        "LISP_COMMAND_SCOPE: absolute Lisp path is outside approved Lisp roots."
      );
    }
  } else {
    const normalized = raw
      .replaceAll("\\", "/")
      .replace(/^\.\//, "");
    const resolved = findRootForVirtualPath(
      normalized,
      approved
    );
    if (resolved) {
      candidate = path.resolve(
        resolved.entry.root,
        resolved.suffix
      );
      if (
        !isPathInside(candidate, resolved.entry.root)
      ) {
        throw new Error(
          "LISP_COMMAND_SCOPE: Lisp path escapes its approved root."
        );
      }
    } else if (humanPower) {
      candidate = path.resolve(
        getRepoRoot(),
        normalized
      );
    } else {
      throw new Error(
        "LISP_COMMAND_SCOPE: unsupported Lisp path. Use an approved CadGPT Lisp namespace or an absolute path inside an approved Lisp root."
      );
    }
  }

  const real = await fs.realpath(candidate);
  if (path.extname(real).toLowerCase() !== ".lsp") {
    throw new Error(
      "LISP_COMMAND_SCOPE: only .lsp files are supported."
    );
  }

  const canonicalApproved =
    await Promise.all(
      approved.map(async (entry) => ({
        ...entry,
        canonicalRoot:
          await canonicalRoot(entry.root),
      }))
    );
  const realRoot =
    canonicalApproved.find((entry) =>
      isPathInside(
        real,
        entry.canonicalRoot
      )
    ) ?? null;

  if (!realRoot && !humanPower) {
    throw new Error(
      "LISP_COMMAND_SCOPE: Lisp real path escapes its approved root."
    );
  }

  if (
    realRoot?.jobOwned &&
    !humanPower &&
    !isJobOwnedLispPath(
      real,
      realRoot.canonicalRoot
    )
  ) {
    throw new Error(
      "LISP_COMMAND_SCOPE: Job-owned Lisp is loadable only from a Job lisp/** or dynamic-lisp/** folder."
    );
  }

  return real;
}
