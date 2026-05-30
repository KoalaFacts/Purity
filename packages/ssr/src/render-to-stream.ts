// ---------------------------------------------------------------------------
// renderToStream — progressive SSR via Suspense boundaries (ADR 0006 Phase 3).
//
// Returns a `ReadableStream<Uint8Array>` that emits, in order:
//
//   1. Optional doctype prefix.
//   2. The shell — the full SSR HTML with each `suspense()` boundary's
//      fallback inline (markers `<!--s:N--><!--/s:N-->` wrap the fallback).
//      Top-level resources still block the shell via the existing multi-pass
//      loop; only suspense-wrapped views are deferred. The shell ends with
//      a single inline `<script>` containing `__purity_swap` so subsequent
//      chunks can splice resolved boundaries in.
//   3. One chunk per deferred boundary (in declaration order):
//      `<template id="purity-s-N">RESOLVED_HTML</template>
//       <script>__purity_swap(N)</script>`
//      Each boundary renders in its own SSRRenderContext + multi-pass loop,
//      with its own `{ timeout }` budget if the user supplied one.
//   4. Optional `<script id="__purity_resources__">…</script>` cache prime
//      (top-level + already-resolved entries; per-boundary resource emit is
//      Phase 6 second-half, deferred per the ADR).
//
// The buffered `renderToString` stays unchanged — apps that don't need
// progressive flush keep using it.
// ---------------------------------------------------------------------------

import {
  PURITY_SWAP_SOURCE,
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '@purityjs/core';
import { valueToHtml } from '@purityjs/core/compiler';

const RESOURCE_SCRIPT_ID = '__purity_resources__';
const DEFAULT_TIMEOUT = 5000;
const MAX_PASSES = 10;
// Restrict CSP nonces to base64 / URL-safe characters so a hostile or
// mistyped value can't escape the attribute. Same pattern as renderToString.
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

export interface RenderToStreamOptions {
  /**
   * Maximum ms to wait for any single boundary's resources before falling
   * back to its `fallback()` HTML. Distinct from the global response
   * budget — each boundary gets its own clock so a slow boundary can't
   * stall siblings. Default 5000.
   */
  timeout?: number;
  /**
   * Inline a JSON snapshot of resolved resources from the shell into the
   * output. Per-boundary resource entries are NOT serialised here — that
   * lands in Phase 6 second-half (per ADR 0006 plan).
   */
  serializeResources?: boolean;
  /** Optional doctype prefix (e.g. `'<!doctype html>'`). */
  doctype?: string;
  /**
   * Strict-CSP nonce. Emitted as `nonce="…"` on every inline `<script>` we
   * write — the swap helper, each per-boundary swap call, and the
   * resource-cache priming payload. Same alphabet rule as renderToString:
   * `[A-Za-z0-9+/=_-]+`.
   */
  nonce?: string;
  /**
   * Cancel mid-stream. When the signal fires we close the controller and
   * drop any in-flight boundary renders. Useful for client-disconnect
   * cleanup at the adapter layer.
   */
  signal?: AbortSignal;
  /**
   * The incoming HTTP `Request` that triggered this render. Exposed to
   * shell + per-boundary components via `getRequest()` so they can read
   * URL / headers / method / cookies and branch SSR output per-request.
   * Standard Web Platform `Request` — works on Node 18+, Bun, Deno,
   * Cloudflare Workers, and Vercel Edge. ADR 0009.
   */
  request?: Request;
}

/**
 * Render a Purity component to a streaming HTTP response.
 *
 * @example
 * ```ts
 * const stream = renderToStream(App, { doctype: '<!doctype html>' });
 * return new Response(stream, { headers: { 'content-type': 'text/html' } });
 * ```
 */
export function renderToStream(
  component: () => unknown,
  options: RenderToStreamOptions = {},
): ReadableStream<Uint8Array> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const serialize = options.serializeResources ?? true;
  const prefix = options.doctype ?? '';
  const nonce = options.nonce;
  if (nonce !== undefined && !NONCE_PATTERN.test(nonce)) {
    throw new Error(
      `[Purity] renderToStream: invalid CSP nonce. Must match ` +
        `${NONCE_PATTERN.source} (base64 / URL-safe characters).`,
    );
  }
  const signal = options.signal;
  const request = options.request;

  const encoder = new TextEncoder();
  // Mutable cancellation flag shared between start() and cancel(). Lets the
  // boundary loop short-circuit when the consumer disconnects WITHOUT an
  // external AbortSignal — previously cancel() was a no-op and the loop
  // happily awaited every slow boundary, calling enqueue() into a closed
  // controller each time (silently caught downstream, but the work still
  // burned CPU / kept timers + fetches alive until they all settled).
  const state = { cancelled: false };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const onAbort = (): void => {
        state.cancelled = true;
        try {
          controller.close();
        } catch {
          // Already closed — ignore.
        }
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const isAborted = (): boolean => state.cancelled || signal?.aborted === true;

      const enqueue = (s: string): void => {
        if (isAborted()) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          // Controller already closed (e.g. consumer cancelled mid-flush).
          // Flip the cancel flag so subsequent boundary work bails out.
          state.cancelled = true;
        }
      };

      try {
        // ----- Shell render --------------------------------------------------
        // Multi-pass loop for top-level resources; suspense() defers its
        // view via streamingBoundaries instead of awaiting inline.
        const shell = await renderShell(component, timeout, request);
        if (isAborted()) return;

        let head = prefix + shell.html;
        if (serialize) {
          const cache = buildResourceScript(shell.resolvedData, shell.resolvedDataByKey, nonce);
          head += cache;
        }
        // Inject __purity_swap inline, exactly once, immediately after the
        // shell. Subsequent boundary chunks invoke it.
        if (shell.boundaries.size > 0) {
          head += scriptTag(PURITY_SWAP_SOURCE, nonce);
        }
        enqueue(head);

        // ----- Boundary chunks ----------------------------------------------
        for (const [id, boundary] of shell.boundaries) {
          if (isAborted()) break;
          // Defense-in-depth: even though `id` is typed as `number` from the
          // Map, validate it's a finite non-negative integer before
          // interpolating it into an inline `<script>__purity_swap(${id})`
          // body. If a future refactor lets a non-numeric id slip in, this
          // prevents code injection through the swap call site.
          if (!Number.isSafeInteger(id) || id < 0) {
            console.error(
              `[Purity] renderToStream: refusing to emit chunk for non-integer boundary id ${String(
                id,
              )}; skipping.`,
            );
            continue;
          }
          const result = await renderBoundary(id, boundary, timeout, request);
          if (isAborted()) break;
          // null signals "boundary couldn't produce content; leave the
          // shell-rendered fallback in place." Without this skip, an
          // empty <template> + __purity_swap(N) chunk wiped the rendered
          // fallback DOM (the swap replaces everything between the
          // markers with the template content — empty content = blank).
          if (result === null) continue;
          // Defense-in-depth: branded SSR HTML is supposed to never contain
          // `</template>` (escHtml escapes `<` in user input, and the
          // codegen doesn't emit raw `</template>`), but if a future
          // compiler bug or hand-crafted markSSRHtml() value smuggled one
          // in, it would break out of the `<template id="purity-s-N">`
          // wrapper and execute as live markup before the swap script
          // runs. Refuse to emit such a chunk and leave the shell
          // fallback in place.
          if (containsTemplateClose(result.html)) {
            console.error(
              `[Purity] renderToStream: boundary ${id} HTML contained </template>; ` +
                'refusing to emit chunk to prevent <template> breakout. Leaving shell fallback in place.',
            );
            continue;
          }
          let chunk = `<template id="purity-s-${id}">${result.html}</template>`;
          // Per-boundary resource cache prime (ADR 0006 Phase 6 second-half).
          // Only the keyed map is meaningful across boundaries — the
          // positional `ordered` array would collide with the shell's index
          // space, so we drop it and document keyed resources as the
          // recommended pattern inside `suspense(view)`. When there's
          // nothing keyed, skip the script entirely.
          if (serialize) {
            const cache = buildBoundaryResourceScript(id, result.resolvedDataByKey, nonce);
            if (cache) chunk += cache;
          }
          chunk += scriptTag(`__purity_swap(${id});`, nonce);
          enqueue(chunk);
        }

        try {
          controller.close();
        } catch {
          // Already closed by cancel() / signal abort — ignore.
        }
      } catch (err) {
        // Don't error a stream the consumer already cancelled — calling
        // controller.error() after close() throws, which would mask the
        // original cause in unhandled-rejection logs.
        if (!isAborted()) {
          try {
            controller.error(err);
          } catch {
            // Already errored — ignore.
          }
        }
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    },
    cancel() {
      // Consumer disconnected. Flip the shared cancel flag so the boundary
      // loop in start() short-circuits on its next `isAborted()` check
      // instead of awaiting every remaining slow boundary. Without this,
      // a single suspense() with a 30s fetch would keep the renderer
      // (and its timers + AbortSignals) alive even after the client gave
      // up.
      state.cancelled = true;
    },
  });
}

// Pre-compiled regex: case-insensitive `</template` followed by `>` or
// whitespace (per HTML spec — `</template foo>` is still a closing tag).
const TEMPLATE_CLOSE_RE = /<\/template[\s>/]/i;

function containsTemplateClose(s: string): boolean {
  return TEMPLATE_CLOSE_RE.test(s);
}

interface ShellResult {
  html: string;
  resolvedData: unknown[];
  resolvedDataByKey: Record<string, unknown>;
  boundaries: Map<
    number,
    {
      view: () => unknown;
      fallback: () => unknown;
      onError?: (err: unknown, info: { boundaryId: number; phase: string }) => void;
    }
  >;
}

async function renderShell(
  component: () => unknown,
  timeout: number,
  request: Request | undefined,
): Promise<ShellResult> {
  const start = Date.now();
  const resolvedData: unknown[] = [];
  const resolvedErrors: unknown[] = [];
  // Null-prototype: see render-to-string.ts for rationale.
  const resolvedDataByKey: Record<string, unknown> = Object.create(null);
  const resolvedErrorsByKey: Record<string, unknown> = Object.create(null);
  const boundaryStartTimes = new Map<number, number>();
  const boundaryDeadlines = new Map<number, number>();
  const timedOutBoundaries = new Set<number>();
  const streamingBoundaries: ShellResult['boundaries'] = new Map();

  let html = '';
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // Reset the registered boundary set on each pass — only the LAST pass's
    // suspense() registrations describe the true wire order. (Earlier-pass
    // registrations come from the same suspense() calls and would just
    // duplicate entries.)
    streamingBoundaries.clear();

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
      streamingMode: true,
      streamingBoundaries,
      request,
    };
    pushSSRRenderContext(ctx);
    try {
      html = valueToHtml(component());
    } finally {
      popSSRRenderContext();
    }

    if (ctx.pendingPromises.length === 0) {
      return { html, resolvedData, resolvedDataByKey, boundaries: streamingBoundaries };
    }

    const remaining = timeout - (Date.now() - start);
    if (remaining <= 0) {
      throw new Error(
        `[Purity] renderToStream shell timed out after ${timeout}ms with ` +
          `${ctx.pendingPromises.length} pending top-level resource(s). ` +
          'Wrap slow data in suspense() to keep the shell streaming.',
      );
    }

    let timedOut = false;
    // Clear the loser timer so it doesn't stay armed (and keep the event
    // loop alive) for `remaining` ms after the resources already settled.
    // try/finally so the clear happens even when Promise.all rejects —
    // the post-await clear was previously skipped on the throw path.
    let shellTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(ctx.pendingPromises),
        new Promise<void>((resolve) => {
          shellTimer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, remaining);
        }),
      ]);
    } finally {
      clearTimeout(shellTimer);
    }
    if (timedOut) {
      throw new Error(
        `[Purity] renderToStream shell timed out after ${timeout}ms while ` +
          'awaiting top-level resources.',
      );
    }
  }

  throw new Error(
    `[Purity] renderToStream shell did not converge within ${MAX_PASSES} passes — ` +
      'a top-level resource is likely creating new resources on every pass.',
  );
}

interface BoundaryResult {
  html: string;
  resolvedData: unknown[];
  resolvedDataByKey: Record<string, unknown>;
}

async function renderBoundary(
  boundaryId: number,
  boundary: ShellResult['boundaries'] extends Map<number, infer V> ? V : never,
  timeout: number,
  request: Request | undefined,
): Promise<BoundaryResult | null> {
  const start = Date.now();
  const resolvedData: unknown[] = [];
  const resolvedErrors: unknown[] = [];
  const resolvedDataByKey: Record<string, unknown> = Object.create(null);
  const resolvedErrorsByKey: Record<string, unknown> = Object.create(null);
  // Per-boundary deadline is just the supplied timeout — boundary timing
  // started the moment the shell registered it; we reuse that wall clock.
  const boundaryStartTimes = new Map<number, number>();
  const boundaryDeadlines = new Map<number, number>();
  const timedOutBoundaries = new Set<number>();

  const reportError = (err: unknown, phase: string): void => {
    if (boundary.onError) {
      try {
        boundary.onError(err, { boundaryId, phase });
      } catch (hookErr) {
        console.error(
          `[Purity] suspense() onError hook threw (boundary ${boundaryId}, phase ${phase}):`,
          hookErr,
        );
      }
    }
  };

  let html = '';
  let viewTimedOut = false;
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
      request,
      // Streaming mode is OFF inside a boundary render — nested suspense()
      // calls inside the view render inline. Phase 3 MVP intentionally
      // doesn't recursively stream sub-boundaries; that's a follow-up.
    };
    pushSSRRenderContext(ctx);
    let viewThrewAndExhausted = false;
    let viewThrewNeedsRetry = false;
    try {
      html = valueToHtml(viewTimedOut ? boundary.fallback() : boundary.view());
    } catch (err) {
      reportError(err, viewTimedOut ? 'fallback' : 'view');
      if (viewTimedOut) {
        // Fallback also threw inside the boundary. Return null so the
        // streaming loop skips this boundary's chunk — the shell already
        // rendered (its own pass-1 call to) the fallback, and replacing
        // it with empty content would wipe what the user can see.
        console.error(
          `[Purity] renderToStream: boundary ${boundaryId} fallback threw; ` +
            'leaving the shell fallback in place.',
          err,
        );
        viewThrewAndExhausted = true;
      } else {
        console.error(
          `[Purity] renderToStream: boundary ${boundaryId} view threw; ` +
            'rendering fallback for this boundary.',
          err,
        );
        viewTimedOut = true;
        viewThrewNeedsRetry = true;
      }
    } finally {
      // Single pop point. The previous code popped inside the catch
      // before `return null` / `continue`, AND popped again in finally —
      // a double-pop on every boundary throw. SSRRenderContext is a
      // single-slot module-global, so a double-pop nulled the outer
      // render's slot (or, with a future fix to stack-ify it, would
      // pop the parent's frame off too).
      popSSRRenderContext();
    }
    if (viewThrewAndExhausted) return null;
    if (viewThrewNeedsRetry) continue;

    if (ctx.pendingPromises.length === 0) {
      return { html, resolvedData, resolvedDataByKey };
    }

    const remaining = timeout - (Date.now() - start);
    if (remaining <= 0) {
      if (viewTimedOut) {
        // Fallback's resources timed out too. Same reasoning as the
        // catch-block null return above — leave the shell fallback in
        // place rather than wipe it with an empty swap.
        return null;
      }
      reportError(undefined, 'timeout');
      viewTimedOut = true;
      continue;
    }

    let raceTimedOut = false;
    let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(ctx.pendingPromises),
        new Promise<void>((resolve) => {
          boundaryTimer = setTimeout(() => {
            raceTimedOut = true;
            resolve();
          }, remaining);
        }),
      ]);
    } finally {
      // try/finally so the clear runs even when Promise.all rejects.
      clearTimeout(boundaryTimer);
    }
    if (raceTimedOut) {
      // viewTimedOut means we're already in the fallback pass and IT
      // timed out too — return null so the loop skips the chunk and the
      // shell fallback survives.
      if (viewTimedOut) return null;
      reportError(undefined, 'timeout');
      viewTimedOut = true;
    }
  }

  // Didn't converge — give up gracefully and leave the shell fallback in
  // place. Returning null tells the streaming loop to skip this
  // boundary's chunk entirely so the swap can't wipe what the shell
  // already rendered.
  console.error(
    `[Purity] renderToStream: boundary ${boundaryId} did not converge within ${MAX_PASSES} passes; ` +
      'leaving shell fallback in place.',
  );
  return null;
}

// Per-boundary cache prime — only emitted when at least one keyed resource
// resolved during the boundary's render. The script id is
// `__purity_resources_N__` where N matches the boundary's `<!--s:N-->`
// marker; the client merges all such scripts into the global keyed cache
// during `hydrate()` priming.
function buildBoundaryResourceScript(
  boundaryId: number,
  keyed: Record<string, unknown>,
  nonce: string | undefined,
): string {
  const keys = Object.keys(keyed);
  if (keys.length === 0) return '';
  const json = JSON.stringify({ keyed })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<script type="application/json" id="__purity_resources_${boundaryId}__"${nonceAttr}>${json}</script>`;
}

function scriptTag(body: string, nonce: string | undefined): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<script${nonceAttr}>${body}</script>`;
}

function buildResourceScript(
  ordered: unknown[],
  keyed: Record<string, unknown>,
  nonce: string | undefined,
): string {
  const hasOrdered = ordered.length > 0;
  const hasKeyed = Object.keys(keyed).length > 0;
  if (!hasOrdered && !hasKeyed) return '';
  const payload = hasKeyed ? { ordered, keyed } : ordered;
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<script type="application/json" id="${RESOURCE_SCRIPT_ID}"${nonceAttr}>${json}</script>`;
}
