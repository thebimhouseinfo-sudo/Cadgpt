import fs from "node:fs/promises";
import path from "node:path";
import {
  createHash,
  randomUUID,
} from "node:crypto";

export const JOB_BUNDLE_ASSET_DIRS = [
  "lisp",
  "dynamic-lisp",
  "tools",
] as const;

export interface JobBundleInspection {
  exists: boolean;
  has_assets: boolean;
  sha256: string | null;
  files: string[];
}

export interface JobBundleMutation {
  asset_directories: string[];
  rollback: () => Promise<void>;
  finalize: () => Promise<void>;
}

async function exists(target: string): Promise<boolean> {
  return fs
    .lstat(target)
    .then(() => true)
    .catch((error) => {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    });
}

async function assertNoSymlinkTree(
  target: string,
  relative: string
): Promise<string[]> {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `JOB_BUNDLE_SYMLINK_FORBIDDEN: ${relative}`
    );
  }
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) {
    throw new Error(
      `JOB_BUNDLE_UNSUPPORTED_ASSET: ${relative}`
    );
  }

  const names = (await fs.readdir(target)).sort();
  const files: string[] = [];
  for (const name of names) {
    files.push(
      ...(await assertNoSymlinkTree(
        path.join(target, name),
        `${relative}/${name}`
      ))
    );
  }
  return files;
}

async function bundleFileList(
  jobFile: string
): Promise<string[]> {
  const root = path.dirname(jobFile);
  const files: string[] = [];
  if (await exists(jobFile)) {
    const stat = await fs.lstat(jobFile);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink()
    ) {
      throw new Error(
        "JOB_BUNDLE_PRIMARY_INVALID: Job source must be a regular file."
      );
    }
    files.push(path.basename(jobFile));
  }
  for (const asset of JOB_BUNDLE_ASSET_DIRS) {
    const assetPath = path.join(root, asset);
    if (!(await exists(assetPath))) continue;
    files.push(
      ...(await assertNoSymlinkTree(
        assetPath,
        asset
      ))
    );
  }
  return files.sort();
}

export async function inspectJobBundle(
  jobFile: string
): Promise<JobBundleInspection> {
  const files = await bundleFileList(jobFile);
  const primary = path.basename(jobFile);
  const hasAssets = files.some(
    (file) => file !== primary
  );
  if (!files.length) {
    return {
      exists: false,
      has_assets: false,
      sha256: null,
      files: [],
    };
  }

  const root = path.dirname(jobFile);
  const hash = createHash("sha256");
  for (const relative of files) {
    const absolute =
      relative === primary
        ? jobFile
        : path.join(root, relative);
    const content = await fs.readFile(absolute);
    hash.update(relative.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(
      createHash("sha256")
        .update(content)
        .digest("hex")
    );
    hash.update("\n");
  }

  return {
    exists: true,
    has_assets: hasAssets,
    sha256: hash.digest("hex"),
    files,
  };
}

async function copyAssetDirectory(
  source: string,
  target: string
): Promise<void> {
  await assertNoSymlinkTree(
    source,
    path.basename(source)
  );
  await fs.cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false,
  });
}

export async function replaceJobBundleFromSource(
  sourceJobFile: string,
  targetJobFile: string
): Promise<JobBundleMutation> {
  const sourceRoot = path.dirname(sourceJobFile);
  const targetRoot = path.dirname(targetJobFile);
  const token = randomUUID();
  const stageRoot = path.join(
    path.dirname(targetRoot),
    `.${path.basename(targetRoot)}.cadgpt-stage-${token}`
  );
  const backupRoot = path.join(
    path.dirname(targetRoot),
    `.${path.basename(targetRoot)}.cadgpt-backup-${token}`
  );
  const primaryName = path.basename(targetJobFile);
  const sourcePrimary = await fs.readFile(
    sourceJobFile
  );

  await fs.mkdir(stageRoot, {
    recursive: true,
  });
  await fs.writeFile(
    path.join(stageRoot, primaryName),
    sourcePrimary
  );

  const stagedAssets: string[] = [];
  try {
    for (const asset of JOB_BUNDLE_ASSET_DIRS) {
      const sourceAsset = path.join(
        sourceRoot,
        asset
      );
      if (!(await exists(sourceAsset))) continue;
      await copyAssetDirectory(
        sourceAsset,
        path.join(stageRoot, asset)
      );
      stagedAssets.push(asset);
    }
  } catch (error) {
    await fs.rm(stageRoot, {
      recursive: true,
      force: true,
    });
    throw error;
  }

  await fs.mkdir(targetRoot, {
    recursive: true,
  });
  await fs.mkdir(backupRoot, {
    recursive: true,
  });

  const movedBackups: string[] = [];
  const installed: string[] = [];
  const targetEntries = [
    primaryName,
    ...JOB_BUNDLE_ASSET_DIRS,
  ];

  const rollback = async () => {
    for (const entry of [...installed].reverse()) {
      await fs.rm(path.join(targetRoot, entry), {
        recursive: true,
        force: true,
      });
    }
    for (const entry of [...movedBackups].reverse()) {
      const backup = path.join(
        backupRoot,
        entry
      );
      if (await exists(backup)) {
        await fs.rename(
          backup,
          path.join(targetRoot, entry)
        );
      }
    }
    await fs.rm(stageRoot, {
      recursive: true,
      force: true,
    });
    await fs.rm(backupRoot, {
      recursive: true,
      force: true,
    });
  };

  try {
    for (const entry of targetEntries) {
      const current = path.join(
        targetRoot,
        entry
      );
      if (await exists(current)) {
        await fs.rename(
          current,
          path.join(backupRoot, entry)
        );
        movedBackups.push(entry);
      }
    }

    await fs.rename(
      path.join(stageRoot, primaryName),
      targetJobFile
    );
    installed.push(primaryName);

    for (const asset of stagedAssets) {
      await fs.rename(
        path.join(stageRoot, asset),
        path.join(targetRoot, asset)
      );
      installed.push(asset);
    }
  } catch (error) {
    await rollback();
    throw error;
  }

  return {
    asset_directories: stagedAssets,
    rollback,
    finalize: async () => {
      await fs
        .rm(stageRoot, {
          recursive: true,
          force: true,
        })
        .catch(() => undefined);
      await fs
        .rm(backupRoot, {
          recursive: true,
          force: true,
        })
        .catch(() => undefined);
    },
  };
}

