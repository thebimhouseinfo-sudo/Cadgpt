const hostChains = new Map<string, Promise<void>>();

export async function withCadHostLock<T>(
  hostIdRaw: string,
  callback: () => Promise<T>
): Promise<T> {
  const hostId = hostIdRaw.trim() || "autocad";
  const previous = hostChains.get(hostId) ?? Promise.resolve();

  let resultPromise!: Promise<T>;
  resultPromise = previous
    .catch(() => undefined)
    .then(callback);

  const sentinel = resultPromise.then(
    () => undefined,
    () => undefined
  );
  hostChains.set(hostId, sentinel);

  try {
    return await resultPromise;
  } finally {
    if (hostChains.get(hostId) === sentinel) hostChains.delete(hostId);
  }
}

