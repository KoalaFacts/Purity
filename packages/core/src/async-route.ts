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

/**
 * Loader context passed to a route or layout's `loader()` named export
 * (ADR 0022). The composer constructs this from the call's args.
 */
export interface LoaderContext {
  /** Server-side request (ADR 0009) on the SSR pass; constructed from `window.location` on the client. */
  request: Request;
  /** Route params from `matchRoute()` (ADR 0011). */
  params: Record<string, string>;
  /** Abort signal — never aborts during SSR; client may abort on navigation in a future ADR. */
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

async function callLoader(mod: AsyncModule, ctx: LoaderContext): Promise<unknown> {
  if (typeof mod.loader !== 'function') return undefined;
  return await mod.loader(ctx);
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

/**
 * Build the route's view-or-error-boundary as a sync factory. Returned
 * by `asyncRoute`'s lazyResource; on resolve, `() => …` is what the
 * `when()` branch invokes per render.
 */
async function loadStack(
  entry: AsyncRouteEntry,
  params: Record<string, string>,
  request: Request,
): Promise<() => unknown> {
  // Defensive shallow-freeze: loaders are user code, and a loader that
  // mutates `ctx.params` (e.g. assigning `params.id = sanitized`) would
  // race-corrupt the view's positional `routeMod.default(params, …)`
  // read on the same object. Freezing surfaces the bug at the offending
  // call site rather than letting a stale/clobbered slot reach the view.
  // The original `params` object is left untouched — callers can keep
  // mutating their own bag — but the loader sees a sealed snapshot.
  const loaderParams = Object.freeze({ ...params });
  const ctx: LoaderContext = {
    request,
    params: loaderParams,
    // Abort semantics: SSR never aborts (one-shot render), and the
    // composer does not currently abort on client navigate-away. The
    // signal is exposed for signature parity + future wiring; loaders
    // can pass it to `fetch()` so adding cancellation later is a flip,
    // not a contract change.
    signal: new AbortController().signal,
  };

  try {
    // Parallel import: route module + every layout module. The plugin's
    // codegen wraps each in a static `() => import(absPath)` so Vite /
    // Rollup code-split per route.
    const [routeMod, ...layoutMods] = (await Promise.all([
      entry.importFn(),
      ...entry.layouts.map((l) => l.importFn()),
    ])) as [AsyncModule, ...AsyncModule[]];

    // Loader calls. Routes + layouts that opted in via `hasLoader: true`
    // get their loader awaited in parallel; others resolve to undefined.
    const [routeData, ...layoutsData] = await Promise.all([
      entry.hasLoader ? callLoader(routeMod, ctx) : Promise.resolve(undefined),
      ...entry.layouts.map((l, i) =>
        l.hasLoader ? callLoader(layoutMods[i], ctx) : Promise.resolve(undefined),
      ),
    ]);

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
        const errMod = (await entry.errorBoundary.importFn()) as {
          default?: (e: unknown) => unknown;
        };
        errorView = typeof errMod?.default === 'function' ? errMod.default : null;
      } catch (importErr) {
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
      let view: () => unknown = () => {
        const token = pushLoaderData(routeData);
        try {
          return routeMod.default(loaderParams, routeData);
        } finally {
          popLoaderData(token);
        }
      };
      for (let i = layoutMods.length - 1; i >= 0; i--) {
        const layout = layoutMods[i];
        const data = layoutsData[i];
        const inner = view;
        view = () => {
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
        return renderWithBoundary(renderErr);
      }
    };
  } catch (err) {
    // Route-level error boundary (ADR 0021). Loaded on demand — most
    // routes never error so paying the import cost up front would be
    // wasteful. The boundary's loaderData slot is the caught error so
    // `_error.ts` views can call `loaderData<{ error: unknown }>()` if
    // they prefer.
    //
    // Boundary-import failure preserves the original error via
    // AggregateError so the root cause isn't masked by the boundary
    // load failure.
    const errorView = await loadErrorBoundary(entry, err);
    if (!errorView) throw err;
    return () => {
      const token = pushLoaderData(err);
      try {
        return errorView(err);
      } finally {
        popLoaderData(token);
      }
    };
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
  const stack = lazyResource(() => loadStack(entry, params, requestFn()), {
    key: (options?.keyPrefix ?? 'route:') + entry.pattern,
  });
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
