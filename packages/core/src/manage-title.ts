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
    head(markSSRHtml(`<title>${escHtml(fn())}</title>`));
    return () => {};
  }
  if (typeof document === 'undefined') {
    // Non-browser non-SSR context (e.g. a test runner without jsdom).
    // Watch the signal and stash the result on a local var so subscribers
    // still track, but no DOM write happens.
    return watch(() => {
      void fn();
    });
  }
  // Client: track + write to document.title.
  return watch(() => {
    document.title = fn();
  });
}
