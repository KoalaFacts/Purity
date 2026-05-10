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
  const resolvedDataByKey: Record<string, unknown> = {};
  const resolvedErrorsByKey: Record<string, unknown> = {};
  // Boundary tracking — shared across passes so deadlines and timed-out
  // marks survive the render loop. ADR 0006 Phase 2.
  const boundaryStartTimes = new Map<number, number>();
  const boundaryDeadlines = new Map<number, number>();
  const timedOutBoundaries = new Set<number>();

  let html = '';
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const ctx: SSRRenderContext = {
      pendingPromises: [],
      resolvedData,
      resolvedErrors,
      resolvedDataByKey,
      resolvedErrorsByKey,
      resourceCounter: 0,
      suspenseCounter: 0,
      boundaryStartTimes,
      boundaryDeadlines,
      timedOutBoundaries,
    };
    pushSSRRenderContext(ctx);
    try {
      html = valueToHtml(component());
    } finally {
      popSSRRenderContext();
    }

    if (ctx.pendingPromises.length === 0) {
      // Quiescent — no pending fetches triggered during this pass.
      const cache = serialize ? buildResourceScript(resolvedData, resolvedDataByKey, nonce) : '';
      return prefix + html + cache;
    }

    const remaining = timeout - (Date.now() - start);
    if (remaining <= 0) {
      throw new Error(
        `[Purity] renderToString timed out after ${timeout}ms with ` +
          `${ctx.pendingPromises.length} pending resource(s).`,
      );
    }

    // Find the soonest live boundary deadline. If it falls inside the
    // remaining global budget, we race against it and mark the boundary
    // timed-out when it fires — letting the next pass render its
    // fallback while the rest of the page keeps progressing.
    const now = Date.now();
    let nearestId = -1;
    let nearestDeadline = Number.POSITIVE_INFINITY;
    for (const [id, deadline] of boundaryDeadlines) {
      if (timedOutBoundaries.has(id)) continue;
      if (deadline < nearestDeadline) {
        nearestDeadline = deadline;
        nearestId = id;
      }
    }
    const boundaryWaitMs = nearestId >= 0 ? Math.max(0, nearestDeadline - now) : Infinity;
    const waitMs = Math.min(remaining, boundaryWaitMs);

    let raceResult: 'settled' | 'boundary' | 'global' = 'settled';
    await Promise.race([
      Promise.all(ctx.pendingPromises).then(() => {
        raceResult = 'settled';
      }),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          raceResult = waitMs >= remaining ? 'global' : 'boundary';
          resolve();
        }, waitMs);
      }),
    ]);

    if (raceResult === 'global') {
      throw new Error(
        `[Purity] renderToString timed out after ${timeout}ms while ` +
          'awaiting pending resources.',
      );
    }
    if (raceResult === 'boundary' && nearestId >= 0) {
      timedOutBoundaries.add(nearestId);
      // The next pass will render this boundary's fallback. The pending
      // promise it owns is left running; resources have their own
      // AbortControllers but we don't have a per-boundary handle to
      // cancel them, so they finish in the background and the resolved
      // values are simply ignored.
    }
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

function buildResourceScript(
  ordered: unknown[],
  keyed: Record<string, unknown>,
  nonce: string | undefined,
): string {
  const hasOrdered = ordered.length > 0;
  const hasKeyed = Object.keys(keyed).length > 0;
  if (!hasOrdered && !hasKeyed) return '';
  // Backward-compat: when no resource opts into a key, emit the legacy
  // array shape so existing caches and external consumers reading the
  // payload format don't break. The new `{ ordered, keyed }` shape kicks
  // in only when at least one keyed resource exists.
  const payload = hasKeyed ? { ordered, keyed } : ordered;
  // JSON-encode then defang sequences that would close the script tag early.
  // Mirrors the standard SSR-payload escaping used by React, Vue, etc.
  const json = JSON.stringify(payload)
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
