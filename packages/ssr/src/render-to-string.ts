// ---------------------------------------------------------------------------
// renderToString — convert a Purity component into an HTML string.
//
// PR 2 scope: synchronous render, no resource awaiting, no component DSD.
// The async signature is preserved so PR 5 can add the resource two-pass
// loop without an API break.
// ---------------------------------------------------------------------------

import { valueToHtml } from '@purityjs/core/compiler';

export interface RenderToStringOptions {
  /** Maximum ms to wait for pending resources during render (PR 5). Default 5000. */
  timeout?: number;
  /**
   * Inline a JSON snapshot of resolved resources into the output so the client
   * hydrator can prime its cache (PR 5). Default true.
   */
  serializeResources?: boolean;
  /** Optional doctype prefix (e.g. `'<!doctype html>'`). Caller controls the document shell. */
  doctype?: string;
}

/**
 * Render a Purity component to an HTML string.
 *
 * The component function is invoked once. Its return value is passed through
 * `valueToHtml`, so any of the following shapes is accepted:
 * - branded `SSRHtml` (typical: `() => html\`<div>…</div>\`` from `@purityjs/ssr`)
 * - a string (escaped)
 * - a number / boolean (`true` → `'true'`; `false` / null / undefined → `''`)
 * - an array of any of the above
 * - a signal accessor returning any of the above
 *
 * Components that depend on async resources or Custom Elements with Shadow
 * DOM are not yet supported in this MVP slice — see PRs 3 and 5.
 */
export async function renderToString(
  component: () => unknown,
  options: RenderToStringOptions = {},
): Promise<string> {
  const body = valueToHtml(component());
  const prefix = options.doctype ?? '';
  return prefix + body;
}
