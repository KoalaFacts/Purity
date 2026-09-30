// ---------------------------------------------------------------------------
// asyncRoute / asyncNotFound — manifest-driven view composer (ADR 0025).
//
// Wraps the lazyResource + when() + reduceRight pattern from ADRs 0019-0024
// into one call per match. Apps consuming `purity:routes` use these instead
// of hand-rolling the composer.
//
// Structural typing: `entry` matches the shape `@purityjs/vite-plugin`'s
// manifest emits. Helpers live in core (no plugin dependency) so the
// import graph stays one-way.
// ---------------------------------------------------------------------------

import { when } from './control.ts';
import { type LoaderDataToken, popLoaderData, pushLoaderData } from './loader-data.ts';
import { lazyResource } from './resource.ts';
import { getRequest } from './request-context.ts';
import { currentPath } from './router.ts';
import { getSSRRenderContext } from './ssr-context.ts';

const ROUTE_DATA = Symbol.for('@purityjs/core/route-data');

/** HTTP metadata for a rendered route. Use a `Response` to end the request. */
export interface RouteResponseInit {
  status?: number;
  headers?: HeadersInit;
}

/** A loader value accompanied by HTTP metadata for its rendered page. */
export interface RouteData<T> {
  readonly value: T;
  readonly status?: number;
  readonly headers: Headers;
  readonly [ROUTE_DATA]: true;
}

/**
 * Attach a status or headers to loader data while still rendering the page.
 * Layout metadata is applied root to leaf, then page metadata wins. Multiple
 * Set-Cookie values are appended. Redirects and bodyless responses should
 * instead return a Web `Response` from the loader.
 *
 * @example
 * ```ts
 * export function loader({ params }: LoaderContext) {
 *   const post = findPost(params.slug);
 *   return routeData(post, {
 *     status: post ? 200 : 404,
 *     headers: { 'Cache-Control': 'public, max-age=60' },
 *   });
 * }
 * ```
 */
export function routeData<T>(value: T, init: RouteResponseInit = {}): RouteData<T> {
  const status = init.status;
  if (
    status !== undefined &&
    (!Number.isInteger(status) ||
      status < 200 ||
      status > 599 ||
      (status >= 300 && status < 400) ||
      status === 204 ||
      status === 205)
  ) {
    throw new RangeError(
      '[purity] routeData: status must allow an HTML response (200–599, excluding redirects and bodyless statuses).',
    );
  }
  const headers = new Headers(init.headers);
  for (const name of ['content-type', 'content-length', 'transfer-encoding']) {
    if (headers.has(name)) {
      throw new TypeError(`[purity] routeData: ${name} is managed by the HTML server response.`);
    }
  }
  return { [ROUTE_DATA]: true, value, status, headers };
}

function isRouteData(value: unknown): value is RouteData<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    ROUTE_DATA in value &&
    (value as RouteData<unknown>)[ROUTE_DATA] === true
  );
}

interface LoaderOutcome {
  data: unknown;
  status?: number;
  headers?: Headers;
}

function mergeHeaders(target: Headers, source: Headers): void {
  source.forEach((value, key) => {
    if (key !== 'set-cookie') target.set(key, value);
  });
  const cookies =
    typeof source.getSetCookie === 'function'
      ? source.getSetCookie()
      : [source.get('Set-Cookie')].filter((cookie): cookie is string => cookie !== null);
  for (const cookie of cookies) target.append('Set-Cookie', cookie);
}

function applyRouteResponse(status: number | undefined, headers: Headers): void {
  const ctx = getSSRRenderContext();
  if (!ctx || (status === undefined && [...headers].length === 0)) return;
  ctx.routeResponse = { status, headers: new Headers(headers) };
}

function markRouteError(): void {
  const ctx = getSSRRenderContext();
  if (ctx)
    ctx.routeResponse = { status: 500, headers: ctx.routeResponse?.headers ?? new Headers() };
}

/**
 * Loader context passed to a route or layout's `loader()` named export
 * (ADR 0022). The composer constructs this from the call's args.
 */
export interface LoaderContext {
  /** Server-side request (ADR 0009) on the SSR pass; constructed from `window.location` on the client. */
  request: Request;
  /** Route params from `matchRoute()` (ADR 0011). */
  params: Record<string, string>;
  /** Cancels with the request, client disposal, or the owning SSR render/boundary. */
  signal: AbortSignal;
}

/**
 * Module a layout / error-boundary / 404 import resolves to. The default
 * export is the view function; an optional `loader` named export fetches
 * data the view receives positionally.
 */
interface AsyncModule {
  default: (...args: unknown[]) => unknown;
  loader?: (ctx: LoaderContext) => unknown | Promise<unknown>;
}

/** Manifest entry shape consumed by {@link asyncRoute}. */
export interface AsyncRouteEntry {
  pattern: string;
  filePath: string;
  importFn: () => Promise<unknown>;
  layouts: ReadonlyArray<{
    filePath: string;
    importFn: () => Promise<unknown>;
    hasLoader?: true;
  }>;
  errorBoundary?: { filePath: string; importFn: () => Promise<unknown> };
  hasLoader?: true;
}

/** Manifest entry shape consumed by {@link asyncNotFound}. */
export interface AsyncNotFoundEntry {
  filePath: string;
  importFn: () => Promise<unknown>;
  /**
   * Routes-relative directory this 404 covers. `''` for the root entry,
   * a directory path for nested ones (ADR 0028). Optional for single-
   * entry callers; required for `notFoundChain` callers to resolve.
   */
  dir?: string;
}

/** Options shared by {@link asyncRoute} and {@link asyncNotFound}. */
export interface AsyncRouteOptions {
  /**
   * Fallback view rendered while the loader pipeline resolves. Default:
   * undefined — when() renders nothing in the loading state. Pass
   * `() => html\`<p>loading…</p>\`` for a visible spinner.
   */
  fallback?: () => unknown;
  /** Override the lazyResource key prefix. Default `'route:'` / `'notFound:'`. */
  keyPrefix?: string;
  /** Override the request constructor. Default: `getRequest()` then `window.location.href`. */
  request?: () => Request;
}

function defaultRequest(): Request {
  const fromSSR = getRequest();
  if (fromSSR) return fromSSR;
  // Client side — construct from current location. The fallback URL keeps
  // the helper safe in non-browser tests (jsdom always defines window).
  const href =
    typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/';
  return new Request(href);
}

async function callLoader(mod: AsyncModule, ctx: LoaderContext): Promise<LoaderOutcome> {
  ctx.signal.throwIfAborted();
  if (typeof mod.loader !== 'function') return { data: undefined };
  const result: unknown = await mod.loader(ctx);
  ctx.signal.throwIfAborted();
  if (result instanceof Response) throw result;
  if (isRouteData(result)) {
    return { data: result.value, status: result.status, headers: result.headers };
  }
  return { data: result };
}

/**
 * Resolve the route's error-boundary view, surfacing import failures while
 * preserving the original loader/import error. Without this wrapper, an
 * `errorBoundary.importFn()` that itself rejects (network blip, missing
 * chunk, dev-time syntax error) would re-throw a fresh error that masks
 * the underlying loader bug — and the user never sees the root cause.
 * We re-throw an `AggregateError` so observers (Sentry, dev overlay) can
 * walk `.errors` to reach both layers.
 */
async function loadErrorBoundary(
  entry: AsyncRouteEntry,
  originalErr: unknown,
): Promise<((err: unknown) => unknown) | null> {
  if (!entry.errorBoundary) return null;
  let errMod: { default?: (e: unknown) => unknown };
  try {
    errMod = (await entry.errorBoundary.importFn()) as {
      default?: (e: unknown) => unknown;
    };
  } catch (boundaryErr) {
    // Boundary import rejected. We want both errors visible. AggregateError
    // is the standard shape; consumers can `.errors[0]` for the loader
    // failure and `.errors[1]` for the boundary import failure. `cause`
    // also threads the boundary import failure for tools that walk it.
    // eslint-disable-next-line preserve-caught-error -- AggregateError preserves both via `.errors[]` + `.cause`; lint pattern matches only `Error`-shaped constructors.
    const agg = new AggregateError(
      [originalErr, boundaryErr],
      '[purity] asyncRoute: error boundary import failed; original loader error preserved in .errors[0]',
      { cause: boundaryErr },
    );
    throw agg;
  }
  if (typeof errMod?.default !== 'function') {
    // Boundary module loaded but exports nothing usable. Treat as if no
    // boundary were configured — re-throw the ORIGINAL loader error so the
    // consumer's outer fallback path runs. Crucially this is OUTSIDE the
    // try/catch above so we don't wrap the original in an AggregateError
    // with itself.
    throw originalErr;
  }
  return errMod.default;
}

function routeCancellation(resourceSignal: AbortSignal, requestSignal: AbortSignal) {
  // Forward across realms as well: custom Request objects may use a different
  // AbortSignal implementation from the component's browser environment.
  const controller = new AbortController();
  const stop = () => {
    resourceSignal.removeEventListener('abort', onResourceAbort);
    requestSignal.removeEventListener('abort', onRequestAbort);
  };
  const onResourceAbort = () => {
    stop();
    controller.abort(resourceSignal.reason);
  };
  const onRequestAbort = () => {
    stop();
    controller.abort(requestSignal.reason);
  };
  resourceSignal.addEventListener('abort', onResourceAbort, { once: true });
  requestSignal.addEventListener('abort', onRequestAbort, { once: true });
  if (resourceSignal.aborted) onResourceAbort();
  else if (requestSignal.aborted) onRequestAbort();
  return { signal: controller.signal, detach: stop };
}

function waitForRoute<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    // Keep rejection handlers attached even when cancellation wins, so late
    // failures from imports or loaders cannot become unhandled rejections.
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

/** Build the route's view-or-error-boundary factory for lazyResource. */
async function loadStack(
  entry: AsyncRouteEntry,
  params: Record<string, string>,
  request: Request,
  serverRender: boolean,
  resourceSignal: AbortSignal,
): Promise<() => unknown> {
  // Defensive shallow-freeze: loaders are user code, and a loader that
  // mutates `ctx.params` (e.g. assigning `params.id = sanitized`) would
  // race-corrupt the view's positional `routeMod.default(params, …)`
  // read on the same object. Freezing surfaces the bug at the offending
  // call site rather than letting a stale/clobbered slot reach the view.
  // The original `params` object is left untouched — callers can keep
  // mutating their own bag — but the loader sees a sealed snapshot.
  const loaderParams = Object.freeze({ ...params });
  const cancellation = routeCancellation(resourceSignal, request.signal);
  const signal = cancellation.signal;
  // Loader work has a shorter lifetime on failure/HTTP outcomes than the
  // route's error-view pipeline. Stop unfinished peers without canceling the
  // error boundary import or invalidating its resulting view factory.
  const loaderAbort = new AbortController();
  const stopLoaders = (reason: unknown) => {
    signal.removeEventListener('abort', onRouteAbort);
    loaderAbort.abort(reason);
  };
  const onRouteAbort = () => stopLoaders(signal.reason);
  signal.addEventListener('abort', onRouteAbort, { once: true });
  if (signal.aborted) onRouteAbort();
  const ctx: LoaderContext = {
    request,
    params: loaderParams,
    signal: loaderAbort.signal,
  };
  const assertViewActive = () => {
    signal.throwIfAborted();
    // Completed SSR pipelines detach forwarding listeners. A custom request
    // can still end before a later pass invokes the cached view factory.
    request.signal.throwIfAborted();
  };

  try {
    signal.throwIfAborted();
    // Parallel import: route module + every layout module. The plugin's
    // codegen wraps each in a static `() => import(absPath)` so Vite /
    // Rollup code-split per route.
    const [routeMod, ...layoutMods] = (await waitForRoute(
      Promise.all([entry.importFn(), ...entry.layouts.map((l) => l.importFn())]),
      signal,
    )) as [AsyncModule, ...AsyncModule[]];
    signal.throwIfAborted();

    // Loader calls. Routes + layouts that opted in via `hasLoader: true`
    // get their loader awaited in parallel; others resolve to undefined.
    const [routeResult, ...layoutResults] = await waitForRoute(
      Promise.all([
        entry.hasLoader
          ? callLoader(routeMod, ctx)
          : Promise.resolve<LoaderOutcome>({ data: undefined }),
        ...entry.layouts.map((l, i) =>
          l.hasLoader
            ? callLoader(layoutMods[i], ctx)
            : Promise.resolve<LoaderOutcome>({ data: undefined }),
        ),
      ]),
      signal,
    );
    signal.throwIfAborted();
    const pageData = routeResult.data;
    const layoutsData = layoutResults.map((result) => result.data);
    const responseHeaders = new Headers();
    let responseStatus: number | undefined;
    for (const result of [...layoutResults, routeResult]) {
      if (result.status !== undefined) responseStatus = result.status;
      if (result.headers) mergeHeaders(responseHeaders, result.headers);
    }

    // Preload the error boundary's view function (if configured) so a
    // render-time throw from a layout / route view can be routed through
    // it synchronously. Without this preload, catching a synchronous
    // render throw and then awaiting an import would force a re-render
    // boundary the view layer doesn't have. `null` when no boundary is
    // configured or its module import / shape check fails — render-time
    // throws will then escape to the consumer's fallback path.
    let errorView: ((e: unknown) => unknown) | null = null;
    if (entry.errorBoundary) {
      try {
        const errMod = (await waitForRoute(entry.errorBoundary.importFn(), signal)) as {
          default?: (e: unknown) => unknown;
        };
        errorView = typeof errMod?.default === 'function' ? errMod.default : null;
      } catch (importErr) {
        signal.throwIfAborted();
        // Boundary preload failed. Log so the dev sees the underlying
        // bundler/network issue; render-time throws will escape via the
        // consumer's outer fallback (typically the apex `errorBoundary`).
        console.error('[purity] asyncRoute: error boundary preload failed:', importErr);
        errorView = null;
      }
    }

    const renderWithBoundary = (err: unknown): unknown => {
      if (!errorView) throw err;
      const token: LoaderDataToken = pushLoaderData(err);
      try {
        return errorView(err);
      } finally {
        popLoaderData(token);
      }
    };

    // reduceRight wraps each layout around the inner view, leaf → root.
    // Each component invocation is bracketed by tokened push/pop so
    // `loaderData()` (ADR 0026) reads the calling view's own slot, and
    // an unbalanced user push escapes loudly instead of silently leaking
    // data between scopes. Nested layouts + route compose correctly
    // because pushes mirror the JS call stack.
    return (): unknown => {
      assertViewActive();
      applyRouteResponse(responseStatus, responseHeaders);
      let view: () => unknown = () => {
        assertViewActive();
        const token = pushLoaderData(pageData);
        try {
          return routeMod.default(loaderParams, pageData);
        } finally {
          popLoaderData(token);
        }
      };
      for (let i = layoutMods.length - 1; i >= 0; i--) {
        const layout = layoutMods[i];
        const data = layoutsData[i];
        const inner = view;
        view = () => {
          assertViewActive();
          const token = pushLoaderData(data);
          try {
            return layout.default(inner, data);
          } finally {
            popLoaderData(token);
          }
        };
      }
      // Render-time error isolation: a throw inside a layout's / route's
      // synchronous `default()` would otherwise escape `when()` and
      // crash the consumer's render. Route through the preloaded error
      // boundary when present; re-throw otherwise so the consumer's
      // outer fallback path can decide what to do.
      try {
        return view();
      } catch (renderErr) {
        assertViewActive();
        markRouteError();
        return renderWithBoundary(renderErr);
      }
    };
  } catch (err) {
    // Cancellation is control flow. Never feed it to an error boundary or
    // let an abandoned loader's redirect navigate the current page.
    signal.throwIfAborted();
    stopLoaders(err);
    // A loader's Web Response is an HTTP outcome, not an error-page input.
    if (err instanceof Response) {
      if (serverRender) throw err;
      const location = err.headers.get('Location');
      if (err.status >= 300 && err.status < 400 && location && typeof window !== 'undefined') {
        window.location.assign(new URL(location, request.url).href);
        return () => undefined;
      }
      const errorView = await waitForRoute(loadErrorBoundary(entry, err), signal);
      signal.throwIfAborted();
      if (errorView) {
        return () => {
          assertViewActive();
          const token = pushLoaderData(err);
          try {
            return errorView(err);
          } finally {
            popLoaderData(token);
          }
        };
      }
      const message = await waitForRoute(err.text(), signal);
      return () => {
        assertViewActive();
        return message || err.statusText || `HTTP ${err.status}`;
      };
    }
    // Route-level error boundary (ADR 0021). Loaded on demand — most
    // routes never error so paying the import cost up front would be
    // wasteful. The boundary's loaderData slot is the caught error so
    // `_error.ts` views can call `loaderData<{ error: unknown }>()` if
    // they prefer.
    //
    // Boundary-import failure preserves the original error via
    // AggregateError so the root cause isn't masked by the boundary
    // load failure.
    const errorView = await waitForRoute(loadErrorBoundary(entry, err), signal);
    signal.throwIfAborted();
    if (!errorView) throw err;
    return () => {
      assertViewActive();
      markRouteError();
      const token = pushLoaderData(err);
      try {
        return errorView(err);
      } finally {
        popLoaderData(token);
      }
    };
  } finally {
    // SSR resources stop forwarding once their operation settles. Detach the
    // route's additional request listener too, including failed/aborted loads.
    // Client routes keep forwarding until the owning resource is disposed.
    if (serverRender) {
      signal.removeEventListener('abort', onRouteAbort);
      cancellation.detach();
    }
  }
}

/**
 * Render a single manifest route entry. Composes the route's layout
 * chain (ADR 0020), invokes loaders if any (ADR 0022), and renders an
 * error boundary on failure (ADR 0021). Hooks into the SSR multipass
 * cycle via `lazyResource({ key })` (ADR 0024) — the SSR HTML ships
 * with the resolved view, not the fallback.
 *
 * @example
 * ```ts
 * import { asyncRoute, html, matchRoute } from '@purityjs/core';
 * import { routes } from 'purity:routes';
 *
 * export function App() {
 *   for (const entry of routes) {
 *     const m = matchRoute(entry.pattern);
 *     if (m) return asyncRoute(entry, m.params);
 *   }
 *   return html`<h1>404</h1>`;
 * }
 * ```
 */
export function asyncRoute(
  entry: AsyncRouteEntry,
  params: Record<string, string>,
  options?: AsyncRouteOptions,
): unknown {
  const requestFn = options?.request ?? defaultRequest;
  const serverRender = getSSRRenderContext() !== null;
  const stack = lazyResource(
    (_args, { signal }) => loadStack(entry, params, requestFn(), serverRender, signal),
    {
      key: (options?.keyPrefix ?? 'route:') + entry.pattern,
    },
  );
  stack.fetch();
  return when(
    () => stack() !== undefined,
    () => (stack() as () => unknown)(),
    options?.fallback,
  );
}

/**
 * Pick the deepest entry in a `notFoundChain` whose `dir` is a prefix
 * of `path` (ADR 0028). Chain is expected deepest-first; first match
 * wins. Returns null when no entry matches.
 */
function pickNotFoundForPath(
  chain: ReadonlyArray<AsyncNotFoundEntry>,
  path: string,
): AsyncNotFoundEntry | null {
  for (const entry of chain) {
    const dir = entry.dir;
    if (dir === undefined || dir === '') return entry; // root entry / no dir = catches all
    // Normalize the user-supplied `dir`: strip leading/trailing slashes so
    // `dir: '/admin'`, `'admin/'`, `'/admin/'`, and `'admin'` all behave
    // identically. The manifest plugin emits the canonical form, but
    // hand-rolled callers and integration adapters routinely pass any of
    // these — silently failing to match was a real footgun.
    let norm = dir;
    while (norm.length > 0 && norm.charCodeAt(0) === 47 /* '/' */) norm = norm.slice(1);
    while (norm.length > 0 && norm.charCodeAt(norm.length - 1) === 47) norm = norm.slice(0, -1);
    if (norm === '') return entry; // dir was effectively root after normalization
    // Match `/admin`, `/admin/`, `/admin/anything` but NOT `/administrator`.
    const prefix = '/' + norm;
    if (path === prefix || path.startsWith(prefix + '/')) return entry;
  }
  return null;
}

/**
 * Render the manifest's `notFound` page (ADR 0021) or pick from a
 * `notFoundChain` (ADR 0028). Same SSR-multipass story as
 * {@link asyncRoute} — the lazyResource registers the import promise
 * so pass 2 sees the resolved view.
 *
 * Two call shapes:
 *
 * - **Single entry** — `asyncNotFound(notFound)`. Renders the supplied
 *   entry directly. Back-compat with ADR 0021.
 * - **Chain** — `asyncNotFound(notFoundChain)`. Walks the chain
 *   deepest-first and picks the first entry whose `dir` is a prefix of
 *   `currentPath()`. ADR 0028. Returns the options.fallback (or
 *   nothing) when the chain is empty / no entry matches.
 *
 * @example
 * ```ts
 * import { asyncNotFound, asyncRoute, matchRoute } from '@purityjs/core';
 * import { notFoundChain, routes } from 'purity:routes';
 *
 * export function App() {
 *   for (const entry of routes) {
 *     const m = matchRoute(entry.pattern);
 *     if (m) return asyncRoute(entry, m.params);
 *   }
 *   return asyncNotFound(notFoundChain);
 * }
 * ```
 */
export function asyncNotFound(
  entryOrChain: AsyncNotFoundEntry | ReadonlyArray<AsyncNotFoundEntry>,
  options?: AsyncRouteOptions,
): unknown {
  // Resolve the active entry. For a chain, pick by current path; for a
  // single entry, use it as-is.
  const entry = Array.isArray(entryOrChain)
    ? pickNotFoundForPath(entryOrChain as ReadonlyArray<AsyncNotFoundEntry>, currentPath())
    : (entryOrChain as AsyncNotFoundEntry);
  if (!entry) {
    // No 404 matched the current path — render fallback (typically undefined,
    // which when() handles as "render nothing").
    return when(
      () => false,
      () => undefined,
      options?.fallback,
    );
  }
  const r = lazyResource(
    async () => {
      const mod = (await entry.importFn()) as { default: () => unknown };
      return mod.default;
    },
    { key: (options?.keyPrefix ?? 'notFound:') + entry.filePath },
  );
  r.fetch();
  return when(
    () => r() !== undefined,
    () => {
      // 404 has no loader data; push `undefined` so `loaderData()` inside
      // the page consistently returns undefined (vs. inheriting some
      // outer push). Tokened push/pop catches a misbehaving 404 view that
      // pushes-without-popping — without the token, our `popLoaderData()`
      // would silently remove that orphan frame and leak the leftover
      // (undefined) frame upward instead. Matches ADR 0026's documented
      // behavior.
      const token = pushLoaderData(undefined);
      try {
        return (r() as () => unknown)();
      } finally {
        popLoaderData(token);
      }
    },
    options?.fallback,
  );
}
