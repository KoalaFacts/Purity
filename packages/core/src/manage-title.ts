// ---------------------------------------------------------------------------
// manageTitle(fn) — reactive <title> sync (ADR 0030).
//
// Server: emit `<title>${escapedTitle}</title>` into the SSR head accumulator
//         via the existing `head()` plumbing (ADR 0008).
// Client: watch `fn` and write the result to `document.title` on every
//         dependency change. Returns the watch teardown.
//
// Isomorphic — apps call `manageTitle(() => …)` once and get correct
// behavior on both runtimes. Composes with currentPath(), loaderData(),
// and any user signal: subscribers track as they would inside a template
// binding.
// ---------------------------------------------------------------------------

import { escHtml, markSSRHtml } from './compiler/ssr-runtime.ts';
import { head } from './head.ts';
import { watch } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

/**
 * Reactive `<title>` synchronisation (ADR 0030).
 *
 * - **Server.** Emits `<title>${fn()}</title>` once into the SSR head
 *   accumulator. Returns a no-op teardown.
 * - **Client.** Watches `fn` and writes its result to `document.title`
 *   on every dependency change. Returns the watch teardown.
 *
 * @example
 * ```ts
 * import { currentPath, manageTitle, loaderData } from '@purityjs/core';
 *
 * function App() {
 *   manageTitle(() => {
 *     const data = loaderData<{ title?: string }>();
 *     return data?.title ?? currentPath();
 *   });
 * }
 * ```
 */
export function manageTitle(fn: () => string): () => void {
  if (getSSRRenderContext() !== null) {
    // SSR: emit once. The `head()` helper handles the head accumulator.
    // Isolate throws so a single broken `manageTitle` call site never
    // poisons the whole renderToString pass — matches head()'s own
    // thunk-error isolation. String() coerces non-string returns
    // defensively so `escHtml`'s `.replace` never sees a non-string
    // (e.g. a count signal accidentally passed as the title).
    let raw: unknown;
    try {
      raw = fn();
    } catch (err) {
      console.error('[purity] manageTitle() fn threw during SSR — entry skipped:', err);
      return () => {};
    }
    head(markSSRHtml(`<title>${escHtml(String(raw ?? ''))}</title>`));
    return () => {};
  }
  if (typeof document === 'undefined') {
    // Non-browser non-SSR context (e.g. a test runner without jsdom).
    // Watch the signal and stash the result on a local var so subscribers
    // still track, but no DOM write happens. Per-run throws are isolated
    // by the watch flush, but the initial synchronous run is not — wrap
    // it so a throw can't escape the helper and break the caller.
    return watch(() => {
      try {
        void fn();
      } catch (err) {
        console.error('[purity] manageTitle() fn threw — title not updated:', err);
      }
    });
  }
  // Client: track + write to document.title.
  // - Isolate the initial synchronous run (the watch flush isolates
  //   subsequent re-runs, but the eager first run propagates by default
  //   from `_effect`, which would otherwise propagate out of manageTitle
  //   and unwind the surrounding render).
  // - String() coerces so a non-string return (e.g. a number signal)
  //   doesn't land as `"undefined"` / `"[object Object]"` on the tab.
  return watch(() => {
    try {
      document.title = String(fn() ?? '');
    } catch (err) {
      console.error('[purity] manageTitle() fn threw — title not updated:', err);
    }
  });
}
