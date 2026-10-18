/** A shared limit prevents nested token/path searches from flooding a public RPC. */
export function limiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try { return await work(); }
    finally { const next = queue.shift(); if (next) next(); else active--; }
  };
}

export async function mapConcurrent<T, R>(
  values: readonly T[], limit: number, work: (value: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      signal?.throwIfAborted();
      const index = next++;
      results[index] = await work(values[index]!, index);
    }
  }));
  return results;
}

export const quoteLimit = limiter(12);
export const indexerLimit = limiter(3);
