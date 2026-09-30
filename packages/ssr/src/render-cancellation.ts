// One render owns its cancellation and forwards both external sources across
// realms. Detach on every exit so reusable Request signals do not retain renders.
export function renderCancellation(
  request?: Request,
  external?: AbortSignal,
): {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  finish: () => void;
} {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  const detach = () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
  for (const source of new Set([request?.signal, external])) {
    if (!source) continue;
    const forward = () => {
      detach();
      controller.abort(source.reason);
    };
    source.addEventListener('abort', forward, { once: true });
    cleanups.push(() => source.removeEventListener('abort', forward));
    if (source.aborted) {
      forward();
      break;
    }
  }
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    finish: () => {
      detach();
      controller.abort(new DOMException('SSR render ended', 'AbortError'));
    },
  };
}
