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

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const onAbort = (): void => {
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

      const enqueue = (s: string): void => {
        if (signal?.aborted) return;
        controller.enqueue(encoder.encode(s));
      };

      try {
        // ----- Shell render --------------------------------------------------
        // Multi-pass loop for top-level resources; suspense() defers its
        // view via streamingBoundaries instead of awaiting inline.
        const shell = await renderShell(component, timeout);

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
          if (signal?.aborted) break;
          const html = await renderBoundary(id, boundary, timeout);
          enqueue(
            `<template id="purity-s-${id}">${html}</template>` +
              scriptTag(`__purity_swap(${id});`, nonce),
          );
        }

        controller.close();
      } catch (err) {
        try {
          controller.error(err);
        } catch {
          // Already errored — ignore.
        }
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    },
    cancel() {
      // Consumer disconnected. Nothing async to release here — the start()
      // promise completes on its own; subsequent enqueue() guards on
      // `signal?.aborted` inside the closure (when an external signal is
      // wired up). For pure cancel-without-signal, we rely on enqueue
      // throwing once the controller is closed.
    },
  });
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

async function renderShell(component: () => unknown, timeout: number): Promise<ShellResult> {
  const start = Date.now();
  const resolvedData: unknown[] = [];
  const resolvedErrors: unknown[] = [];
  const resolvedDataByKey: Record<string, unknown> = {};
  const resolvedErrorsByKey: Record<string, unknown> = {};
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
      boundaryStartTimes,
      boundaryDeadlines,
      timedOutBoundaries,
      streamingMode: true,
      streamingBoundaries,
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
    await Promise.race([
      Promise.all(ctx.pendingPromises),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, remaining);
      }),
    ]);
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

async function renderBoundary(
  boundaryId: number,
  boundary: ShellResult['boundaries'] extends Map<number, infer V> ? V : never,
  timeout: number,
): Promise<string> {
  const start = Date.now();
  const resolvedData: unknown[] = [];
  const resolvedErrors: unknown[] = [];
  const resolvedDataByKey: Record<string, unknown> = {};
  const resolvedErrorsByKey: Record<string, unknown> = {};
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
      boundaryStartTimes,
      boundaryDeadlines,
      timedOutBoundaries,
      // Streaming mode is OFF inside a boundary render — nested suspense()
      // calls inside the view render inline. Phase 3 MVP intentionally
      // doesn't recursively stream sub-boundaries; that's a follow-up.
    };
    pushSSRRenderContext(ctx);
    try {
      html = valueToHtml(viewTimedOut ? boundary.fallback() : boundary.view());
    } catch (err) {
      reportError(err, viewTimedOut ? 'fallback' : 'view');
      if (viewTimedOut) {
        // Fallback also threw — emit empty resolved chunk; the shell
        // already showed the fallback so the user still sees something.
        console.error(
          `[Purity] renderToStream: boundary ${boundaryId} fallback threw; ` +
            'leaving the shell fallback in place.',
          err,
        );
        popSSRRenderContext();
        return '';
      }
      console.error(
        `[Purity] renderToStream: boundary ${boundaryId} view threw; ` +
          'rendering fallback for this boundary.',
        err,
      );
      viewTimedOut = true;
      popSSRRenderContext();
      continue;
    } finally {
      popSSRRenderContext();
    }

    if (ctx.pendingPromises.length === 0) return html;

    const remaining = timeout - (Date.now() - start);
    if (remaining <= 0) {
      if (viewTimedOut) {
        // Fallback itself timed out — emit empty rather than hanging.
        return '';
      }
      reportError(undefined, 'timeout');
      viewTimedOut = true;
      continue;
    }

    let raceTimedOut = false;
    await Promise.race([
      Promise.all(ctx.pendingPromises),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          raceTimedOut = true;
          resolve();
        }, remaining);
      }),
    ]);
    if (raceTimedOut) {
      if (viewTimedOut) return '';
      reportError(undefined, 'timeout');
      viewTimedOut = true;
    }
  }

  // Didn't converge — give up gracefully and leave the shell fallback.
  console.error(
    `[Purity] renderToStream: boundary ${boundaryId} did not converge within ${MAX_PASSES} passes; ` +
      'leaving shell fallback in place.',
  );
  return '';
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
