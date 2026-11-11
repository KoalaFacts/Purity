// ---------------------------------------------------------------------------
// @purityjs/ssr/concurrency — independent progress for streamed boundaries
// (ADR 0062). Opt-in, so applications that keep declaration order do not ship
// this scheduler in the main `@purityjs/ssr` entry.
// ---------------------------------------------------------------------------

import type { BoundaryScheduler } from './render-to-stream.ts';

export type { BoundaryScheduler } from './render-to-stream.ts';

/**
 * Let up to `limit` deferred `suspense()` views render at once and write each
 * chunk as soon as its view settles, so a fast region is not held behind a
 * slow sibling. New views still start only when the consumer pulls, so at
 * most `limit` rendered chunks wait in memory; `limit` is that bound.
 *
 * @example
 * ```ts
 * import { renderToStream } from '@purityjs/ssr';
 * import { boundaryConcurrency } from '@purityjs/ssr/concurrency';
 *
 * renderToStream(App, { boundaries: boundaryConcurrency(4) });
 * ```
 *
 * @param limit A positive integer, or `Infinity`.
 */
export function boundaryConcurrency(limit: number): BoundaryScheduler {
  // Also rejects NaN and non-numbers: neither is >= 1 and a safe integer.
  if (!(limit >= 1 && (limit === Infinity || Number.isSafeInteger(limit)))) {
    throw new Error('[Purity] boundaryConcurrency: limit must be a positive integer or Infinity.');
  }
  return async function* concurrent<T>(
    jobs: IterableIterator<[number, () => Promise<T>]>,
  ): AsyncGenerator<[number, T]> {
    const active = new Map<number, Promise<[number, T]>>();
    let ended = false;
    try {
      while (true) {
        while (active.size < limit) {
          const job = jobs.next();
          if (job.done) break;
          const [id, start] = job.value;
          const settled = start().then((result): [number, T] => [id, result]);
          // A rejection that wins the race below is rethrown there. One that
          // settles after the stream stopped reading is logged, not unhandled.
          settled.catch((error) => {
            if (ended)
              console.error(
                `[Purity] renderToStream: boundary ${id} failed after the stream ended:`,
                error,
              );
          });
          active.set(id, settled);
        }
        if (active.size === 0) return;
        const next = await Promise.race(active.values());
        active.delete(next[0]);
        yield next;
      }
    } finally {
      ended = true;
    }
  };
}
