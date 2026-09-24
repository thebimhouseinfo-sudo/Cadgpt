import path from "node:path";

const chains = new Map<string, Promise<void>>();

function keyFor(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function withOneLock<T>(
  resource: string,
  callback: () => Promise<T>
): Promise<T> {
  const key = keyFor(resource);
  const previous = chains.get(key) ?? Promise.resolve();

  let resultPromise!: Promise<T>;
  resultPromise = previous
    .catch(() => undefined)
    .then(callback);

  const sentinel = resultPromise.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, sentinel);

  try {
    return await resultPromise;
  } finally {
    if (chains.get(key) === sentinel) chains.delete(key);
  }
}

/**
 * Serialize mutations touching the same physical resources inside this CadGPT
 * process. Multi-resource mutations acquire sorted canonical keys to prevent
 * lock-order deadlocks.
 *
 * Cross-process writers still require optimistic hash/version checks; this
 * scheduler intentionally does not pretend to be a machine-wide lock.
 */
export async function withFileMutationLocks<T>(
  resources: string[],
  callback: () => Promise<T>
): Promise<T> {
  const ordered = [...new Set(resources.map(keyFor))].sort();
  const acquire = (index: number): Promise<T> => {
    if (index >= ordered.length) return callback();
    return withOneLock(ordered[index], () => acquire(index + 1));
  };
  return acquire(0);
}

