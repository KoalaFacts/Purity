// ---------------------------------------------------------------------------
// renderToString — convert a Purity component into an HTML string.
//
// Renders are async because PR 5 introduced the resource-awaiting two-pass
// loop:
//   1. push an SSRRenderContext, run the component, capture pending promises
//      created by `resource()` calls.
//   2. if any are pending, await them, increment a pass counter, repeat
//      until the render produces no new pending promises (quiescent) or
//      `timeout` ms elapse.
//   3. serialize resolved resource values into a `<script id="…">` JSON
//      payload appended to the output so the client hydrator can prime its
//      cache and skip the first refetch.
// ---------------------------------------------------------------------------

import { popSSRRenderContext, pushSSRRenderContext, type SSRRenderContext } from '@purityjs/core';
import { valueToHtml } from '@purityjs/core/compiler';

export interface RenderToStringOptions {
  /** Maximum ms to wait for pending resources during render. Default 5000. */
  timeout?: number;
  /**
   * Inline a JSON snapshot of resolved resources into the output so the
   * client hydrator can prime its cache. Default true. The script tag is
   * `<script type="application/json" id="__purity_resources__">…</script>`.
   */
  serializeResources?: boolean;
  /** Optional doctype prefix (e.g. `'<!doctype html>'`). */
  doctype?: string;
  /**
   * Strict-CSP nonce. Emitted as `nonce="…"` on the
   * `<script id="__purity_resources__">` tag so a `Content-Security-
   * Policy: script-src 'nonce-…'` header lets the cache-priming payload
   * execute under strict CSP. Generate per-request and put the same
   * value in your CSP header. Validated against `[A-Za-z0-9+/=_-]+`
   * (base64 + URL-safe characters) so it can't escape the attribute.
   */
  nonce?: string;
}

const DEFAULT_TIMEOUT = 5000;
const MAX_PASSES = 10;

const RESOURCE_SCRIPT_ID = '__purity_resources__';

/**
 * Render a Purity component to an HTML string, awaiting any in-flight
 * resources up to the configured timeout.
 *
 * @example
 * ```ts
 * import { renderToString, html } from '@purityjs/ssr';
 *
 * const out = await renderToString(() => html`<h1>Hi</h1>`, {
 *   doctype: '<!doctype html>',
 * });
 * ```
 */
export async function renderToString(
  component: () => unknown,
  options: RenderToStringOptions = {},
): Promise<string> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const serialize = options.serializeResources ?? true;
  const prefix = options.doctype ?? '';
  const nonce = options.nonce;
  if (nonce !== undefined && !NONCE_PATTERN.test(nonce)) {
    throw new Error(
      `[Purity] renderToString: invalid CSP nonce. Must match ` +
        `${NONCE_PATTERN.source} (base64 / URL-safe characters).`,
    );
  }
  const start = Date.now();

  const resolvedData: unknown[] = [];
  const resolvedErrors: unknown[] = [];

  let html = '';
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const ctx: SSRRenderContext = {
      pendingPromises: [],
      resolvedData,
      resolvedErrors,
      resourceCounter: 0,
      suspenseCounter: 0,
    };
    pushSSRRenderContext(ctx);
    try {
      html = valueToHtml(component());
    } finally {
      popSSRRenderContext();
    }

    if (ctx.pendingPromises.length === 0) {
      // Quiescent — no pending fetches triggered during this pass.
      const cache =
        serialize && resolvedData.length > 0 ? buildResourceScript(resolvedData, nonce) : '';
      return prefix + html + cache;
    }

    const remaining = timeout - (Date.now() - start);
    if (remaining <= 0) {
      throw new Error(
        `[Purity] renderToString timed out after ${timeout}ms with ` +
          `${ctx.pendingPromises.length} pending resource(s).`,
      );
    }

    await Promise.race([
      Promise.all(ctx.pendingPromises),
      new Promise<void>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `[Purity] renderToString timed out after ${timeout}ms while ` +
                  'awaiting pending resources.',
              ),
            ),
          remaining,
        ),
      ),
    ]);
  }

  throw new Error(
    `[Purity] renderToString did not converge within ${MAX_PASSES} passes — ` +
      'a resource is likely creating new resources on every pass.',
  );
}

// CSP nonces in HTTP headers are base64 (RFC 4648) and frequently URL-safe
// (RFC 4648 \u00a75). Restrict to that alphabet so a hostile / mistyped value
// can't break out of the attribute. Length is left to the caller.
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

function buildResourceScript(data: unknown[], nonce: string | undefined): string {
  // JSON-encode then defang sequences that would close the script tag early.
  // Mirrors the standard SSR-payload escaping used by React, Vue, etc.
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  // `nonce` was validated above (NONCE_PATTERN); safe to splice into the
  // attribute. Emitted only when supplied so the default output is byte-
  // for-byte unchanged.
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<script type="application/json" id="${RESOURCE_SCRIPT_ID}"${nonceAttr}>${json}</script>`;
}

export { RESOURCE_SCRIPT_ID };
