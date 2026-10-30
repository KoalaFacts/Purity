import type { SuspenseOptions, SuspenseErrorPhase } from '@purityjs/core';
import {
  cancelSSRBoundary,
  getSSRRenderContext,
  warnDuplicateKey,
} from '@purityjs/core/ssr-bridge';
import {
  escAttr as escapeAttrLocal,
  escHtml as escapeHtmlLocal,
  markSSRHtml,
  valueToHtml,
  type RawTextSpan,
  type SSRHtml,
} from './runtime.ts';

// Encode an arbitrary key into a comment-data-safe string. encodeURIComponent
// escapes everything except `A-Za-z0-9-_.!~*'()`; we additionally rewrite `-`
// to `%2D` so two consecutive dashes can never appear in the encoded form
// (HTML comments forbid `--`). decodeURIComponent inverts both transforms in
// one step, since `%2D` round-trips to `-`. See WHATWG comment grammar.
function encodeRowKey(key: unknown): string {
  return encodeURIComponent(String(key)).replace(/-/g, '%2D');
}

// ---------------------------------------------------------------------------
// SSR variants — return branded HTML strings, no DOM, no watchers.
//
// These are pulled in by @purityjs/ssr's renderToString during server render.
// Each region is bracketed by start + end comment markers so the PR 4
// hydrator can locate control-flow boundaries on the parsed DOM:
//
//   match / when:  <!--m-->...<!--/m-->
//   each:          <!--e-->...<!--/e-->
//   list:          <!--l-->...<!--/l-->
//
// Accessors are called once. Returns from view/map functions are normalized
// via valueToHtml — which handles branded SSR HTML, primitives, arrays, and
// signal accessors transparently.
// ---------------------------------------------------------------------------

/**
 * SSR variant of {@link match}. Renders the matching case once, returns HTML.
 *
 * The boundary marker carries the rendered case key (URL-encoded) so the
 * client-side hydrator can tell whether to adopt the SSR-rendered subtree
 * (when the current key matches what SSR produced) or fall through to a
 * fresh render (data drift between server and client). Encoding follows
 * the same scheme as `eachSSR`'s row markers — see {@link encodeRowKey}.
 */
export function matchSSR<T extends string | number | boolean>(
  sourceFn: () => T,
  cases: Partial<Record<`${T}`, () => unknown>>,
  fallback?: () => unknown,
): SSRHtml {
  const key = String(sourceFn()) as `${T}`;
  const view = cases[key] ?? fallback;
  const prefix = `<!--m:${encodeRowKey(key)}-->`;
  const spans: RawTextSpan[] = [];
  const inner = view ? valueToHtml(view(), spans, prefix.length) : '';
  return markSSRHtml(`${prefix}${inner}<!--/m-->`, spans);
}

/** SSR variant of {@link when}. Picks then/else once, returns HTML. */
export function whenSSR(
  conditionFn: () => boolean,
  thenFn: () => unknown,
  elseFn?: () => unknown,
): SSRHtml {
  return matchSSR(() => Boolean(conditionFn()), { true: thenFn, false: elseFn });
}

/**
 * SSR variant of {@link each}. Maps each item once, concatenates HTML.
 *
 * Each row is wrapped in `<!--er:KEY-->...<!--/er-->` markers so the client-
 * side hydrator can split the SSR output back into individual rows and
 * adopt their DOM in place when keys match the hydration items list. KEY
 * is the result of `keyFn(item, i)` (or the item itself when no keyFn is
 * supplied), encoded via {@link encodeRowKey} so it survives HTML comment
 * data restrictions. See ADR 0005 / `inflateDeferredEach`.
 */
export function eachSSR<T>(
  listAccessor: (() => T[]) | T[],
  mapFn: (item: () => T, index: number) => unknown,
  keyFn?: (item: T, index: number) => unknown,
): SSRHtml {
  const items = (typeof listAccessor === 'function' ? listAccessor() : listAccessor) || [];
  const getKey = keyFn ?? ((item: T, _i: number) => item as unknown);
  let inner = '<!--e-->';
  const spans: RawTextSpan[] = [];
  const seenKeys = new Set<unknown>();
  for (let i = 0; i < items.length; i++) {
    // Pass a frozen accessor so user code that calls `item()` works the same
    // shape as the client. No reactivity — the value is captured at render.
    const value = items[i];
    const key = getKey(value, i);
    // Duplicate key: emit only the first row, matching the client render.
    if (seenKeys.has(key)) {
      warnDuplicateKey(key, i);
      continue;
    }
    seenKeys.add(key);
    const accessor = () => value;
    inner += `<!--er:${encodeRowKey(key)}-->`;
    inner += valueToHtml(mapFn(accessor, i), spans, inner.length) + '<!--/er-->';
  }
  return markSSRHtml(`${inner}<!--/e-->`, spans);
}

interface ListSSROptions<T> {
  text?: (item: T, index: number) => string;
  class?: (item: T, index: number) => string;
  style?: (item: T, index: number) => string;
  attrs?: Record<string, (item: T, index: number) => string>;
  events?: Record<string, (item: T, index: number) => (e: Event) => void>;
  key?: (item: T, index: number) => unknown;
}

/** SSR variant of {@link list}. Builds a flat list of single-tag rows as HTML. */
export function listSSR<T>(
  tag: string,
  listAccessor: (() => T[]) | T[],
  textOrOptions: ((item: T, index: number) => string) | ListSSROptions<T>,
  _keyFn?: (item: T, index: number) => unknown,
): SSRHtml {
  // Validate the tag name. The codegen runs every literal tag through
  // assertSafeName; the cycle-73 fix applied LIST_SAFE_ATTR_NAME to
  // attrs-object keys. The `tag` parameter was the remaining gap —
  // `listSSR(userTag, …)` with `userTag = 'div><script>alert(1)</script><div'`
  // would escape the tag context and inject markup. Same regex shape.
  if (!LIST_SAFE_ATTR_NAME.test(tag)) {
    console.warn(`[Purity] listSSR: invalid tag name ${JSON.stringify(tag)}; emitting empty list.`);
    return markSSRHtml('<!--l--><!--/l-->');
  }
  const items = (typeof listAccessor === 'function' ? listAccessor() : listAccessor) || [];
  // Same key resolution as list(): an options object supplies its own key and
  // ignores the 4th argument.
  const getKey: (item: T, index: number) => unknown =
    typeof textOrOptions === 'function'
      ? (_keyFn ?? ((item: T) => item as unknown))
      : (textOrOptions.key ?? ((item: T) => item as unknown));
  const seenKeys = new Set<unknown>();
  let getText: ((item: T, index: number) => string) | undefined;
  let getClass: ((item: T, index: number) => string) | undefined;
  let getStyle: ((item: T, index: number) => string) | undefined;
  let getAttrs: Record<string, (item: T, index: number) => string> | undefined;

  if (typeof textOrOptions === 'function') {
    getText = textOrOptions;
  } else {
    getText = textOrOptions.text;
    getClass = textOrOptions.class;
    getStyle = textOrOptions.style;
    getAttrs = textOrOptions.attrs;
    // events skipped on the server — listeners attach during client hydration
  }

  let inner = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Duplicate key: emit only the first row, matching the client render.
    const key = getKey(item, i);
    if (seenKeys.has(key)) {
      warnDuplicateKey(key, i, 'listSSR()');
      continue;
    }
    seenKeys.add(key);
    let attrs = '';
    if (getClass) {
      const cls = getClass(item, i);
      if (cls) attrs += ` class="${escapeAttrLocal(cls)}"`;
    }
    if (getStyle) {
      const sty = getStyle(item, i);
      if (sty) attrs += ` style="${escapeAttrLocal(sty)}"`;
    }
    if (getAttrs) {
      for (const k of Object.keys(getAttrs)) {
        // Attribute NAMES are interpolated raw into the opening tag — a
        // hostile name like `foo"><script>...` would close the tag and
        // inject markup. Validate against the same conservative HTML name
        // grammar the codegen uses (assertSafeName); skip invalid keys
        // with a warning rather than silently render unsafe HTML.
        if (!LIST_SAFE_ATTR_NAME.test(k)) {
          console.warn(
            `[Purity] listSSR: dropping attrs key ${JSON.stringify(k)} — not a valid HTML attribute name.`,
          );
          continue;
        }
        const v = getAttrs[k](item, i);
        if (v != null) attrs += ` ${k}="${escapeAttrLocal(v)}"`;
      }
    }
    const text = getText ? escapeHtmlLocal(getText(item, i)) : '';
    inner += `<${tag}${attrs}>${text}</${tag}>`;
  }
  return markSSRHtml(`<!--l-->${inner}<!--/l-->`);
}

// HTML attribute name grammar — letters, digits, hyphen, colon, underscore.
// Matches the conservative set codegen's assertSafeName accepts, plus `:`
// for namespaced attrs (xml:lang, xlink:href). Anything outside this set
// (quotes, angle brackets, whitespace, equals signs, …) could escape the
// tag-attribute context and inject markup.
const LIST_SAFE_ATTR_NAME = /^[A-Za-z_][\w:-]*$/;

export function suspenseSSR<T>(
  view: () => T,
  fallback: () => T,
  options?: SuspenseOptions,
): T | SSRHtml {
  const ssrCtx = getSSRRenderContext();
  if (!ssrCtx) {
    // Client path — render the view; the fallback is forward-compat for
    // Phase 3 streaming where it shows while a streamed boundary is in
    // flight. For now it's unused.
    return view();
  }
  const parentPath = ssrCtx.boundaryPath ?? '';
  const positions = (ssrCtx.boundaryPositions ??= new Map());
  const position = positions.get(parentPath) ?? 0;
  positions.set(parentPath, position + 1);
  const path = `${parentPath}/${position}`;
  const ids = (ssrCtx.boundaryIds ??= new Map());
  let id = ids.get(path);
  if (id === undefined) ids.set(path, (id = ids.size + 1));
  ssrCtx.suspenseCounter = Math.max(ssrCtx.suspenseCounter, id);
  const prefix = `<!--s:${id}-->`;
  const spans: RawTextSpan[] = [];
  const renderFallback = () => {
    spans.length = 0;
    const previousPath = ssrCtx.boundaryPath;
    ssrCtx.boundaryPath = `${path}/fallback`;
    try {
      return valueToHtml(fallback(), spans, prefix.length);
    } finally {
      ssrCtx.boundaryPath = previousPath;
    }
  };

  // Record the first-encounter time so deadlines stay anchored to pass 1
  // even when later passes re-execute view() with resolved data. If a
  // timeout is supplied, register the deadline once.
  if (!ssrCtx.boundaryStartTimes.has(id)) {
    const start = Date.now();
    ssrCtx.boundaryStartTimes.set(id, start);
    if (options?.timeout !== undefined) {
      ssrCtx.boundaryDeadlines.set(id, start + options.timeout);
    }
  }

  // Track the active boundary so any `resource()` invoked inside
  // `view()` can capture this id at fetcher-registration time. If the
  // surrounding boundary later loses its deadline race, the renderer
  // adds the id to the shared `timedOutBoundaries` Set; the resource's
  // settle path observes that membership and short-circuits before
  // mutating `resolvedDataByKey` — which would otherwise corrupt the
  // hydration cache (and, when the late write lands during a sibling
  // boundary's await window in the same render, the rendered HTML
  // too). The stack is re-entrant-safe: nested suspense() boundaries
  // each push their id and pop, so the innermost wraps the resource.
  const idStack = (ssrCtx.boundaryIdStack ??= []);

  const onError = options?.onError;
  const reportError = (err: unknown, phase: SuspenseErrorPhase): void => {
    if (onError) {
      try {
        onError(err, { boundaryId: id, phase });
      } catch (hookErr) {
        // The hook itself threw — log but don't propagate; one bad reporter
        // shouldn't take down the whole render.
        console.error(
          `[Purity] suspense() onError hook threw (boundary ${id}, phase ${phase}):`,
          hookErr,
        );
      }
    }
  };

  const isTimedOut = ssrCtx.timedOutBoundaries.has(id);

  // Streaming branch (ADR 0006 Phase 3) — `renderToStream` flips
  // ssrCtx.streamingMode and provides a streamingBoundaries registry.
  // For each boundary we emit the fallback HTML in the shell and queue
  // the view (+ its fallback for re-render on timeout) for later
  // streaming, so the shell can flush immediately without awaiting the
  // boundary's resources. The marker grammar is identical — only the
  // body is the fallback rather than the resolved view.
  if (ssrCtx.streamingMode && ssrCtx.streamingBoundaries && !ssrCtx.inlineBoundaries?.has(id)) {
    let body: string;
    if (isTimedOut) {
      reportError(undefined, 'timeout');
      try {
        body = renderFallback();
      } catch (fallbackErr) {
        reportError(fallbackErr, 'fallback');
        body = '';
      }
    } else {
      try {
        body = renderFallback();
      } catch (fallbackErr) {
        reportError(fallbackErr, 'fallback');
        console.error(
          `[Purity] suspense() shell fallback threw (boundary ${id}); emitting empty fallback:`,
          fallbackErr,
        );
        body = '';
      }
      // Don't queue boundaries that already timed out — the shell already
      // shows their fallback; there's nothing left to stream.
      ssrCtx.streamingBoundaries.set(id, {
        view: view as () => unknown,
        fallback: fallback as () => unknown,
        deadline: ssrCtx.boundaryDeadlines.get(id),
        // The ssr-context types `phase` as `string` (variance-friendly for
        // the boundary table); our `onError` only ever fires with a
        // `SuspenseErrorPhase` literal at runtime. The cast bridges the
        // narrower → wider contravariance.
        onError: onError as
          | ((err: unknown, info: { boundaryId: number; phase: string }) => void)
          | undefined,
      });
    }
    return markSSRHtml(`${prefix}${body}<!--/s:${id}-->`, body ? spans : undefined);
  }

  let body: string;
  if (isTimedOut) {
    reportError(undefined, 'timeout');
    try {
      body = renderFallback();
    } catch (fallbackErr) {
      reportError(fallbackErr, 'fallback');
      console.error(
        `[Purity] suspense() fallback threw after timeout (boundary ${id}); emitting empty boundary:`,
        fallbackErr,
      );
      body = '';
    }
  } else {
    // Push the boundary id around view() so resources opened inside it
    // capture it; pop in `finally` so a synchronous throw doesn't leak
    // a stale frame onto the stack.
    idStack.push(id);
    const previousPath = ssrCtx.boundaryPath;
    ssrCtx.boundaryPath = `${path}/view`;
    let viewThrew = false;
    try {
      body = valueToHtml(view(), spans, prefix.length);
    } catch (err) {
      viewThrew = true;
      reportError(err, 'view');
      console.error(
        `[Purity] suspense() view threw during SSR (boundary ${id}); rendering fallback:`,
        err,
      );
      // Mark the boundary as cancelled so any resource() registered
      // inside view() before the throw — whose fetcher is still in
      // flight — has its `.then()` short-circuit instead of writing
      // into the shared `resolvedDataByKey` after we've already
      // committed to the fallback. Same semantic guarantee as the
      // timeout path in render-to-string.ts; widens the Set's meaning
      // from "boundary that lost its deadline race" to "boundary
      // whose view will not be rendered, so its late writes are stale".
      cancelSSRBoundary(ssrCtx, id, err);
      // The fallback() runs AFTER the finally below pops the boundary
      // id, so its own resources are scoped to the surrounding (outer)
      // boundary, not this failed one. This matches the existing
      // semantics for fallback resources.
      body = '__pending_fallback__';
    } finally {
      ssrCtx.boundaryPath = previousPath;
      if (idStack[idStack.length - 1] === id) idStack.pop();
    }
    if (viewThrew) {
      try {
        body = renderFallback();
      } catch (fallbackErr) {
        reportError(fallbackErr, 'fallback');
        // Fallback also threw — emit an empty boundary rather than blowing
        // up the entire render. The error logs above identify the boundary.
        console.error(
          `[Purity] suspense() fallback also threw (boundary ${id}); emitting empty boundary:`,
          fallbackErr,
        );
        body = '';
      }
    }
  }
  return markSSRHtml(`${prefix}${body}<!--/s:${id}-->`, body ? spans : undefined);
}

export const ssrControlFlow = {
  match: matchSSR,
  when: whenSSR,
  each: eachSSR,
  suspense: suspenseSSR,
};
