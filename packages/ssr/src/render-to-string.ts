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
import { RESOURCE_SCRIPT_ID, serializeResourceScriptPayload } from './resource-script.ts';

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
  /**
   * When true, return `{ body, head }` so the caller can splice the
   * `head()`-collected HTML into the document `<head>` section of their
   * shell template. The `body` field is identical to the legacy string
   * return; only the return shape changes. Default false — apps that
   * don't call `head()` keep the simpler string return. ADR 0008.
   */
  extractHead?: boolean;
  /**
   * The incoming HTTP `Request` that triggered this render. Exposed to
   * components via `getRequest()` so they can read URL / headers /
   * method / cookies and branch SSR output per-request. Standard Web
   * Platform `Request` — works on Node 18+, Bun, Deno, Cloudflare
   * Workers, and Vercel Edge. Omit for ad-hoc renders that don't
   * correspond to a real request (static pre-render, tests). ADR 0009.
   */
  request?: Request;
  /**
   * Cancel an in-flight render. When the signal aborts (caller hung up,
   * HTTP client disconnected, fastify request closed, …) the next race
   * loses immediately and the returned promise rejects with the
   * signal's `reason` (an `AbortError` `DOMException` when none was
   * supplied to `AbortController.abort()`). Without this, a render
   * that's blocked on a slow fetcher keeps awaiting up to `timeout`ms
   * even though no one is listening — burning CPU / open sockets on
   * the server. Mirrors `renderToStream`'s `signal` option.
   *
   * Late-arriving fetches that win the race after the abort still
   * write to the shared resolved-data cache for their resource, but
   * the renderToString promise has already rejected — those writes
   * are harmless since the shared cache is GC-rooted only through the
   * pending promises themselves.
   */
  signal?: AbortSignal;
}

/** Return shape for {@link renderToString} when `extractHead: true`. */
export interface RenderToStringWithHead {
  body: string;
  head: string;
}

const DEFAULT_TIMEOUT = 5000;
const MAX_PASSES = 10;

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
export function renderToString(
  component: () => unknown,
  options: RenderToStringOptions & { extractHead: true },
): Promise<RenderToStringWithHead>;
export function renderToString(
  component: () => unknown,
  options?: RenderToStringOptions,
): Promise<string>;
export async function renderToString(
  component: () => unknown,
  options: RenderToStringOptions = {},
): Promise<string | RenderToStringWithHead> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const serialize = options.serializeResources ?? true;
  const prefix = options.doctype ?? '';
  const nonce = options.nonce;
  const extractHead = options.extractHead === true;
  const request = options.request;
  const signal = options.signal;
  // Fail fast if the caller is already gone — no point pushing a context
  // or invoking the user component. Mirrors fetch's pre-flight abort
  // check. `signal.reason` defaults to a DOMException('…','AbortError')
  // when AbortController.abort() is called without an argument.
  if (signal?.aborted) {
    throw abortReason(signal);
  }
  if (nonce !== undefined && !NONCE_PATTERN.test(nonce)) {
    throw new Error(
      `[Purity] renderToString: invalid CSP nonce. Must match ` +
        `${NONCE_PATTERN.source} (base64 / URL-safe characters).`,
    );
  }
  // doctype is concatenated verbatim into the response prefix. The only
  // legitimate shapes are the HTML5 doctype and legacy XHTML/HTML4
  // variants — anything else would emit attacker-controlled markup
  // before the document. Reject anything that isn't a `<!doctype …>`
  // declaration (case-insensitive on the keyword) with no embedded `<`
  // — which would otherwise let `<!doctype><script>...</script>` slip
  // through.
  if (prefix !== '' && !DOCTYPE_PATTERN.test(prefix)) {
    throw new Error(
      `[Purity] renderToString: invalid doctype option. ` +
        `Must be a single <!DOCTYPE …> declaration with no embedded markup.`,
    );
  }
  const start = Date.now();

  const resolvedData: unknown[] = [];
  const resolvedErrors: unknown[] = [];
  // Null-prototype: `key in resolvedDataByKey` and writes like
  // `resolvedDataByKey['__proto__'] = ...` can't traverse / mutate
  // Object.prototype for a user-supplied resource `key`.
  const resolvedDataByKey: Record<string, unknown> = Object.create(null);
  const resolvedErrorsByKey: Record<string, unknown> = Object.create(null);
  // Boundary tracking — shared across passes so deadlines and timed-out
  // marks survive the render loop. ADR 0006 Phase 2.
  const boundaryStartTimes = new Map<number, number>();
  const boundaryDeadlines = new Map<number, number>();
  const timedOutBoundaries = new Set<number>();
  // head() collector. Reset per pass so later passes don't double-count;
  // we capture the final pass's value when the render becomes quiescent.
  let lastHead: string[] | undefined;

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
      islandCounter: 0,
      boundaryStartTimes,
      boundaryDeadlines,
      timedOutBoundaries,
      head: [],
      request,
    };
    pushSSRRenderContext(ctx);
    try {
      html = valueToHtml(component());
    } finally {
      // Pop in a finally so a synchronous throw inside the user component
      // doesn't escape the pass boundary with the context still on the
      // stack — that would leak into the next renderToString call on the
      // same event loop turn and crash with stale `resolvedData`.
      popSSRRenderContext();
    }
    lastHead = ctx.head;

    // Abort observed mid-render (a sibling fetch triggered the signal
    // while the synchronous render was running). Bail before we award
    // resources to a render no one is listening for.
    if (signal?.aborted) {
      throw abortReason(signal);
    }

    if (ctx.pendingPromises.length === 0) {
      // Quiescent — no pending fetches triggered during this pass.
      const cache = serialize ? buildResourceScript(resolvedData, resolvedDataByKey, nonce) : '';
      const body = prefix + html + cache;
      if (extractHead) {
        return { body, head: (lastHead ?? []).join('') };
      }
      return body;
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

    // Each race branch resolves with its own discriminator so the winning
    // value is captured by the await. Mutating a shared `let` from inside
    // the inner promises bypasses TS's flow narrowing across the await.
    type RaceResult = 'settled' | 'boundary' | 'global' | 'aborted';
    // Capture the timer so we can clear it when the promises win the race.
    // Otherwise a ref'd timer stays armed for the full `waitMs` after the
    // render already finished — on every pass, accumulating under load and
    // keeping the event loop alive (notably on serverless/edge).
    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let raceResult: RaceResult;
    try {
      // Defensive `.catch`: resource()'s SSR branch wraps the user fetcher
      // in a Promise.resolve(...).then(ok, err) handler that *never*
      // rejects — both success and failure write back to the resolved-
      // data/error caches and resolve `undefined`. But anything else a
      // user might push onto `ctx.pendingPromises` (a custom directive,
      // a future primitive) could reject. We can't let that reject the
      // outer race promise: a rejection would escape the await as a throw
      // and bypass the `boundary`/`global` discriminator logic, *and*
      // surface as an unhandled rejection on the race's loser branch.
      // Treat any rejection as "settled" — the next pass renders against
      // whatever state the failing promise left in the cache.
      const settledPromise = Promise.all(ctx.pendingPromises).then(
        () => 'settled' as const,
        () => 'settled' as const,
      );
      const racers: Promise<RaceResult>[] = [
        settledPromise,
        new Promise<RaceResult>((resolve) => {
          raceTimer = setTimeout(() => {
            resolve(waitMs >= remaining ? 'global' : 'boundary');
          }, waitMs);
        }),
      ];
      if (signal) {
        // The caller can yank us out of the await as soon as they
        // give up — no need to wait for the next boundary deadline or
        // the global timeout. Without this, an aborted HTTP request
        // still holds onto its server-side render slot for up to
        // `timeout`ms while fetches it triggered keep running.
        racers.push(
          new Promise<RaceResult>((resolve) => {
            onAbort = () => resolve('aborted');
            signal.addEventListener('abort', onAbort, { once: true });
          }),
        );
      }
      raceResult = await Promise.race<RaceResult>(racers);
    } finally {
      // The cycle-4 fix cleared the timer on the happy path only; if
      // Promise.all rejected (a user fetcher errored), the await threw
      // and the post-await clear was skipped. The timer then stayed
      // armed for the full `waitMs` — exactly the "ref'd timer keeps
      // the event loop alive on serverless/edge" hazard cycle 4 was
      // meant to close. try/finally guarantees cleanup on every path.
      clearTimeout(raceTimer);
      // Detach the abort listener so the AbortSignal doesn't retain a
      // reference to this render's closure once we move on. Listeners
      // registered with `{ once: true }` self-detach on fire, but a
      // race that wins via the resources/timer never fires the abort
      // branch — and a leaked listener pins the SSRRenderContext for
      // every still-living AbortSignal in the process.
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }

    if (raceResult === 'aborted') {
      throw abortReason(signal as AbortSignal);
    }
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

// Normalise the AbortSignal's reason into something throwable. Modern
// runtimes (Node 18+, Bun, Deno, browsers) populate `signal.reason` with
// a `DOMException('…','AbortError')` when `AbortController.abort()` is
// called without an argument, or whatever value the caller passed. If
// `reason` is missing (very old runtimes) we synthesise one so the
// rejection still has `name === 'AbortError'` for the standard
// `err.name === 'AbortError'` consumer pattern.
function abortReason(signal: AbortSignal): unknown {
  const reason = signal.reason;
  if (reason !== undefined) return reason;
  // Synthesised fallback.
  if (typeof DOMException === 'function') {
    return new DOMException('renderToString aborted', 'AbortError');
  }
  const err = new Error('renderToString aborted');
  (err as Error & { name: string }).name = 'AbortError';
  return err;
}

// CSP nonces in HTTP headers are base64 (RFC 4648) and frequently URL-safe
// (RFC 4648 \u00a75). Restrict to that alphabet so a hostile / mistyped value
// can't break out of the attribute. Length is left to the caller.
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

// Accept a single `<!doctype \u2026>` declaration (case-insensitive on the
// keyword) with no embedded `<` inside the body, so a hostile string
// like `<!doctype html><script>alert(1)</script>` is rejected before
// it can be concatenated into the response prefix. Optional internal
// subset (`[\u2026]`) is excluded \u2014 apps shipping a DTD subset are vanishing
// rare and can pre-stringify their shell.
const DOCTYPE_PATTERN = /^<!(?:doctype|DOCTYPE)\s[^<>]*>$/;

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
  // `nonce` was validated above (NONCE_PATTERN); safe to splice into the
  // attribute via the shared serializer. Emitted only when supplied so the
  // default output is byte-for-byte unchanged.
  return serializeResourceScriptPayload(payload, RESOURCE_SCRIPT_ID, nonce);
}

export { RESOURCE_SCRIPT_ID };
