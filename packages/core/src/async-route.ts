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
import { lazyResource } from './resource.ts';
import { getRequest } from './request-context.ts';

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
 * Build the route's view-or-error-boundary as a sync factory. Returned
 * by `asyncRoute`'s lazyResource; on resolve, `() => …` is what the
 * `when()` branch invokes per render.
 */
async function loadStack(
  entry: AsyncRouteEntry,
  params: Record<string, string>,
  request: Request,
): Promise<() => unknown> {
  const ctx: LoaderContext = {
    request,
    params,
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

    // reduceRight wraps each layout around the inner view, leaf → root.
    return (): unknown => {
      let view: () => unknown = () => routeMod.default(params, routeData);
      for (let i = layoutMods.length - 1; i >= 0; i--) {
        const layout = layoutMods[i];
        const data = layoutsData[i];
        const inner = view;
        view = () => layout.default(inner, data);
      }
      return view();
    };
  } catch (err) {
    // Route-level error boundary (ADR 0021). Loaded on demand — most
    // routes never error so paying the import cost up front would be
    // wasteful. The boundary itself shouldn't throw; if it does, the
    // throw escapes to the consumer's fallback path.
    if (entry.errorBoundary) {
      const errMod = (await entry.errorBoundary.importFn()) as {
        default: (e: unknown) => unknown;
      };
      return () => errMod.default(err);
    }
    throw err;
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
 * Render the manifest's top-level `notFound` page (ADR 0021). Same
 * SSR-multipass story as {@link asyncRoute} — the lazyResource registers
 * the import promise so pass 2 sees the resolved view.
 *
 * @example
 * ```ts
 * import { asyncNotFound, asyncRoute, html, matchRoute } from '@purityjs/core';
 * import { notFound, routes } from 'purity:routes';
 *
 * export function App() {
 *   for (const entry of routes) {
 *     const m = matchRoute(entry.pattern);
 *     if (m) return asyncRoute(entry, m.params);
 *   }
 *   return notFound ? asyncNotFound(notFound) : html`<h1>404</h1>`;
 * }
 * ```
 */
export function asyncNotFound(entry: AsyncNotFoundEntry, options?: AsyncRouteOptions): unknown {
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
    () => (r() as () => unknown)(),
    options?.fallback,
  );
}
