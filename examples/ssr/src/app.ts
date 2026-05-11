// File-system-routing demo. The plugin scans `src/pages/` (configured in
// vite.config.ts) and emits a virtual `purity:routes` module that this file
// consumes. End-to-end exercise of ADRs 0019-0024:
//
//   - ADR 0019 — pattern matching from the manifest's `pattern` field.
//   - ADR 0020 — layout chain in `entry.layouts` wrapped via reduceRight.
//   - ADR 0021 — `entry.errorBoundary` rendered on load failure; manifest
//     `notFound` rendered when no route matches.
//   - ADR 0022 — `entry.hasLoader` / `layout.hasLoader` flags drive loader
//     calls; resolved data threads into the component as the second
//     positional arg.
//   - ADR 0023 — `when()` / `suspense()` here are SSR-isomorphic.
//   - ADR 0024 — `lazyResource(..., { key })` registers its pending promise
//     with the SSR multipass context so the renderer awaits the route
//     module + loader resolution before pass 2.

import { html, lazyResource, matchRoute, when } from '@purityjs/core';
import { notFound, type RouteEntry, routes } from 'purity:routes';

interface LoaderContext {
  request: Request;
  params: Record<string, string>;
  signal: AbortSignal;
}

type ViewFactory = () => unknown;

async function callLoader(
  mod: { loader?: (ctx: LoaderContext) => unknown },
  ctx: LoaderContext,
): Promise<unknown> {
  if (typeof mod.loader !== 'function') return undefined;
  return await mod.loader(ctx);
}

async function loadStack(entry: RouteEntry, params: Record<string, string>): Promise<ViewFactory> {
  const ctx: LoaderContext = {
    request: new Request('http://localhost' + (params._path ?? '/')),
    params,
    signal: new AbortController().signal,
  };

  try {
    // Parallel import: the route module + every layout module.
    type AnyMod = {
      default: (...args: unknown[]) => unknown;
      loader?: (ctx: LoaderContext) => unknown;
    };
    const [routeMod, ...layoutMods] = (await Promise.all([
      entry.importFn(),
      ...entry.layouts.map((l) => l.importFn()),
    ])) as [AnyMod, ...AnyMod[]];

    // Loader calls. Routes + layouts that exported a `loader` get a chance
    // to fetch their server data before the view runs.
    const [routeData, ...layoutsData] = await Promise.all([
      entry.hasLoader ? callLoader(routeMod, ctx) : Promise.resolve(undefined),
      ...entry.layouts.map((l, i) =>
        l.hasLoader ? callLoader(layoutMods[i], ctx) : Promise.resolve(undefined),
      ),
    ]);

    // reduceRight wraps layouts around the inner route view, leaf → root.
    return (): unknown => {
      let view: ViewFactory = () => routeMod.default(params, routeData);
      for (let i = layoutMods.length - 1; i >= 0; i--) {
        const layout = layoutMods[i];
        const data = layoutsData[i];
        const inner = view;
        view = () => layout.default(inner, data);
      }
      return view();
    };
  } catch (err) {
    // Route-level error boundary (ADR 0021). Load it on demand — most
    // routes never error so paying the import cost up front would be
    // wasteful. The boundary itself shouldn't throw, so we let any
    // failure here bubble to the consumer's fallback.
    if (entry.errorBoundary) {
      const errMod = (await entry.errorBoundary.importFn()) as { default: (e: unknown) => unknown };
      return () => errMod.default(err);
    }
    throw err;
  }
}

function renderEntry(entry: RouteEntry, params: Record<string, string>): unknown {
  // The key threads through ADR 0024's SSR multipass cache. Same key on
  // every render of the same route lets pass 2 read the resolved view
  // factory without re-running loadStack — the underlying resource()
  // surfaces the cached value on pass 2 automatically.
  const stack = lazyResource(() => loadStack(entry, params), {
    key: `route:${entry.pattern}`,
  });
  stack.fetch();
  // when() / each() / match() are ADR-0023 isomorphic — this same call
  // emits SSR HTML on the server and reactive DOM on the client.
  return when(
    () => stack() !== undefined,
    () => (stack() as ViewFactory)(),
    () => html`<p class="loading">loading…</p>`,
  );
}

function renderNotFound(): unknown {
  if (!notFound) return html`<h1>404</h1>`;
  const r = lazyResource(
    async () => {
      const mod = (await notFound.importFn()) as { default: () => unknown };
      return mod.default;
    },
    { key: 'notFound' },
  );
  r.fetch();
  return when(
    () => r() !== undefined,
    () => (r() as () => unknown)(),
    () => html`<p class="loading">loading…</p>`,
  );
}

export function App(): unknown {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) return renderEntry(entry, m.params);
  }
  return renderNotFound();
}
