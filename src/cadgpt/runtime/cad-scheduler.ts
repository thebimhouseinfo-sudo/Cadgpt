const hostChains = new Map<string, Promise<void>>();

export async function withCadHostLock<T>(
  hostIdRaw: string,
  callback: () => Promise<T>
): Promise<T> {
  const hostId = hostIdRaw.trim() || "autocad";
  const previous = hostChains.get(hostId) ?? Promise.resolve();
  const enqueuedAt = Date.now();

  let resultPromise!: Promise<T>;
  resultPromise = previous
    .catch(() => undefined)
    .then(async () => {
      const waitMs = Date.now() - enqueuedAt;
      if (waitMs >= 1500) {
        // No drawing identifiers, task arguments or payloads in diagnostics.
        console.warn(`[CAD LATENCY] host_queue_wait_ms=${waitMs}`);
      }
      const startedAt = Date.now();
      try {
        return await callback();
      } finally {
        const durationMs = Date.now() - startedAt;
        if (durationMs >= 5000) {
          console.warn(`[CAD LATENCY] host_operation_ms=${durationMs}`);
        }
      }
    });

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
