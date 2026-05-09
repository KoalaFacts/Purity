// Shared async helpers for resource() tests and benchmarks.

export const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()));

/** Drain several microtask rounds — enough for chained .then handlers + flush. */
export const flushAll = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await tick();
};
