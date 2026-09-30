// ADR 0025 — asyncRoute / asyncNotFound runtime composer.
//
// Unit tests for the helper's pass-1 / pass-2 SSR behavior + the
// loadStack composition (route + layouts + loaders + error boundary).

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount } from '../src/component.ts';
import { state, watch } from '../src/signals.ts';

import {
  asyncNotFound,
  type AsyncNotFoundEntry,
  asyncRoute,
  type AsyncRouteEntry,
  routeData,
} from '../src/async-route.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function mountRoute(entry: AsyncRouteEntry, request?: Request) {
  const root = document.createElement('div');
  document.body.append(root);
  const active = state(true);
  const mounted = mount(
    () =>
      asyncRoute(entry, {}, request ? { request: () => request } : undefined) as DocumentFragment,
    root,
  );
  cleanups.push(mounted.unmount);
  // A router replaces a mounted route scope. when()/match() intentionally
  // cache hidden branches, so hiding one is not a lifecycle teardown.
  cleanups.push(
    watch(() => {
      if (!active()) {
        mounted.unmount();
        root.textContent = 'Next route';
      }
    }),
  );
  return { root, active, ...mounted };
}

describe('asyncRoute — loader cancellation', () => {
  it('shares cancellation between page/layout loaders when the route scope is replaced', async () => {
    const signals: AbortSignal[] = [];
    const work = deferred<string>();
    const loader = ({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return work.promise;
    };
    const entry: AsyncRouteEntry = {
      pattern: '/cancel',
      filePath: 'cancel.ts',
      hasLoader: true,
      importFn: async () => ({ default: () => document.createTextNode('Old route'), loader }),
      layouts: [
        {
          filePath: '_layout.ts',
          hasLoader: true,
          importFn: async () => ({ default: (children: () => unknown) => children(), loader }),
        },
      ],
    };
    const { root, active } = mountRoute(entry);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]).toBe(signals[1]);
    active(false);
    await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
    work.resolve('late');
    await new Promise((done) => setTimeout(done, 0));
    expect(root.textContent).toBe('Next route');
  });

  it('keeps the loader signal live after settlement and removes forwarding listeners on unmount', async () => {
    const request = new Request('http://localhost/cancel');
    const add = vi.spyOn(request.signal, 'addEventListener');
    const remove = vi.spyOn(request.signal, 'removeEventListener');
    let signal!: AbortSignal;
    const entry: AsyncRouteEntry = {
      pattern: '/cancel',
      filePath: 'cancel.ts',
      hasLoader: true,
      layouts: [],
      importFn: async () => ({
        default: () => document.createTextNode('Ready'),
        loader: (ctx: { signal: AbortSignal }) => {
          signal = ctx.signal;
          return 'done';
        },
      }),
    };
    const { root, unmount } = mountRoute(entry, request);
    await vi.waitFor(() => expect(root.textContent).toBe('Ready'));
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
  });

  it('does not start loaders after cancellation during module import', async () => {
    const module = deferred<unknown>();
    const loader = vi.fn();
    const boundary = vi.fn(async () => ({ default: () => 'error' }));
    const entry: AsyncRouteEntry = {
      pattern: '/cancel',
      filePath: 'cancel.ts',
      hasLoader: true,
      layouts: [],
      importFn: () => module.promise,
      errorBoundary: { filePath: '_error.ts', importFn: boundary },
    };
    const { unmount } = mountRoute(entry);
    await new Promise((done) => setTimeout(done, 0));
    unmount();
    module.resolve({ default: () => 'old', loader });
    await new Promise((done) => setTimeout(done, 0));
    expect(loader).not.toHaveBeenCalled();
    expect(boundary).not.toHaveBeenCalled();
  });

  it('ignores an abandoned loader redirect without inspecting or navigating to its target', async () => {
    const work = deferred<string>();
    const loader = vi.fn(() => work.promise);
    const boundary = vi.fn(async () => ({ default: () => 'error' }));
    const entry: AsyncRouteEntry = {
      pattern: '/cancel',
      filePath: 'cancel.ts',
      hasLoader: true,
      layouts: [],
      importFn: async () => ({ default: () => 'old', loader }),
      errorBoundary: { filePath: '_error.ts', importFn: boundary },
    };
    const { unmount } = mountRoute(entry);
    await vi.waitFor(() => expect(loader).toHaveBeenCalled());
    unmount();
    const redirect = Response.redirect('http://localhost/late', 302);
    const get = vi.spyOn(redirect.headers, 'get');
    work.reject(redirect);
    await new Promise((done) => setTimeout(done, 0));
    expect(get).not.toHaveBeenCalled();
    expect(boundary).not.toHaveBeenCalled();
  });

  it('forwards a custom client request abort without rendering an error boundary', async () => {
    const controller = new AbortController();
    const request = new Request('http://localhost/cancel', { signal: controller.signal });
    const work = deferred<string>();
    let signal!: AbortSignal;
    const loader = vi.fn((ctx: { signal: AbortSignal }) => {
      signal = ctx.signal;
      return work.promise;
    });
    const boundary = vi.fn(async () => ({ default: () => 'error' }));
    const entry: AsyncRouteEntry = {
      pattern: '/cancel',
      filePath: 'cancel.ts',
      hasLoader: true,
      layouts: [],
      importFn: async () => ({ default: () => 'old', loader }),
      errorBoundary: { filePath: '_error.ts', importFn: boundary },
    };
    mountRoute(entry, request);
    await vi.waitFor(() => expect(loader).toHaveBeenCalled());
    const reason = new Error('Request cancelled');
    controller.abort(reason);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
    work.reject(new Error('Late error'));
    await new Promise((done) => setTimeout(done, 0));
    expect(boundary).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'])('ignores boundary preload %s after cancellation', async (mode) => {
    const module = deferred<unknown>();
    const boundary = vi.fn(() => module.promise);
    const view = vi.fn(() => document.createTextNode('old'));
    const errorView = vi.fn(() => 'error');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entry: AsyncRouteEntry = {
      pattern: '/cancel',
      filePath: 'cancel.ts',
      layouts: [],
      importFn: async () => ({ default: view }),
      errorBoundary: { filePath: '_error.ts', importFn: boundary },
    };
    const { unmount } = mountRoute(entry);
    await vi.waitFor(() => expect(boundary).toHaveBeenCalled());
    unmount();
    if (mode === 'resolve') module.resolve({ default: errorView });
    else module.reject(new Error('Late import failure'));
    await new Promise((done) => setTimeout(done, 0));
    expect(view).not.toHaveBeenCalled();
    expect(errorView).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('does not import a route for an already aborted SSR request', async () => {
    const controller = new AbortController();
    const reason = new Error('SSR cancelled');
    controller.abort(reason);
    const request = new Request('http://localhost/cancel', { signal: controller.signal });
    const importFn = vi.fn(async () => ({ default: () => 'old' }));
    const entry: AsyncRouteEntry = {
      pattern: '/cancel',
      filePath: 'cancel.ts',
      layouts: [],
      importFn,
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}, { request: () => request }));
    await Promise.all(ctx.pendingPromises);
    expect(importFn).not.toHaveBeenCalled();
    expect(ctx.resolvedErrorsByKey['route:/cancel']).toBe(reason);
  });

  it('settles SSR cancellation promptly even when a loader ignores its signal', async () => {
    const controller = new AbortController();
    const request = new Request('http://localhost/cancel', { signal: controller.signal });
    const work = deferred<string>();
    let signal!: AbortSignal;
    const loader = vi.fn((ctx: { signal: AbortSignal }) => {
      signal = ctx.signal;
      return work.promise;
    });
    const boundary = vi.fn(async () => ({ default: () => 'error' }));
    const entry: AsyncRouteEntry = {
      pattern: '/cancel',
      filePath: 'cancel.ts',
      hasLoader: true,
      layouts: [],
      importFn: async () => ({ default: () => 'old', loader }),
      errorBoundary: { filePath: '_error.ts', importFn: boundary },
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}, { request: () => request }));
    await vi.waitFor(() => expect(loader).toHaveBeenCalled());
    expect(signal).toBe(request.signal);
    const reason = new Error('SSR cancelled');
    controller.abort(reason);
    await vi.waitFor(() => expect(ctx.resolvedErrorsByKey['route:/cancel']).toBe(reason));
    expect(ctx.resolvedDataByKey['route:/cancel']).toBeUndefined();
    expect(boundary).not.toHaveBeenCalled();
    work.resolve('late');
    await Promise.all(ctx.pendingPromises);
    await new Promise((done) => setTimeout(done, 0));
    expect(ctx.resolvedDataByKey['route:/cancel']).toBeUndefined();
  });
});

function inSSRContext<T>(
  fn: () => T,
  ctx?: SSRRenderContext,
): { ctx: SSRRenderContext; result: T } {
  const c = ctx ?? makeSSRContext();
  pushSSRRenderContext(c);
  try {
    return { ctx: c, result: fn() };
  } finally {
    popSSRRenderContext();
  }
}

describe('asyncRoute — pass 1 registers the loadStack promise (ADR 0025)', () => {
  it('imports the route + layout modules in parallel and pushes one promise', async () => {
    const importLog: string[] = [];
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => {
        importLog.push('route');
        return { default: () => 'route view' };
      },
      layouts: [
        {
          filePath: '_layout.ts',
          importFn: async () => {
            importLog.push('layout');
            return { default: (children: () => unknown) => children() };
          },
        },
      ],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    // One promise registered: the lazyResource's loadStack promise.
    expect(ctx.pendingPromises).toHaveLength(1);

    await Promise.all(ctx.pendingPromises);

    // Route + layout imported (parallel, so order may vary).
    expect(importLog.sort()).toEqual(['layout', 'route']);
    // Resolved value cached under the manifest key.
    expect(ctx.resolvedDataByKey['route:/p']).toBeTypeOf('function');
  });

  it('respects a custom keyPrefix', () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({ default: () => 'view' }),
      layouts: [],
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}, { keyPrefix: 'admin:' }));
    expect(Object.keys(ctx.resolvedDataByKey)).toEqual([]); // pass 1 hasn't resolved
    expect(ctx.pendingPromises).toHaveLength(1);
  });
});

describe('asyncRoute — loader pipeline (ADR 0025 / 0022)', () => {
  it('applies layout then page HTTP metadata and passes only the data to views', async () => {
    const pageHeaders = new Headers({ 'Cache-Control': 'private', 'X-Page': 'yes' });
    pageHeaders.append('Set-Cookie', 'page=1; Path=/');
    const layoutHeaders = new Headers({ 'Cache-Control': 'public', 'X-Layout': 'yes' });
    layoutHeaders.append('Set-Cookie', 'layout=1; Path=/');
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: (_params: unknown, data: unknown) => `page:${data}`,
        loader: () =>
          routeData('post', {
            status: 404,
            headers: pageHeaders,
          }),
      }),
      layouts: [
        {
          filePath: '_layout.ts',
          hasLoader: true,
          importFn: async () => ({
            default: (children: () => unknown, data: unknown) => `${data}:${children()}`,
            loader: () =>
              routeData('layout', {
                status: 202,
                headers: layoutHeaders,
              }),
          }),
        },
      ],
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(inSSRContext(factory, ctx).result).toBe('layout:page:post');
    expect(ctx.routeResponse?.status).toBe(404);
    expect(ctx.routeResponse?.headers.get('Cache-Control')).toBe('private');
    expect(ctx.routeResponse?.headers.get('X-Layout')).toBe('yes');
    expect(ctx.routeResponse?.headers.get('X-Page')).toBe('yes');
    expect(ctx.routeResponse?.headers.getSetCookie()).toEqual([
      'layout=1; Path=/',
      'page=1; Path=/',
    ]);
  });

  it('rejects statuses that cannot accompany rendered HTML', () => {
    expect(() => routeData(null, { status: 302 })).toThrow(RangeError);
    expect(() => routeData(null, { status: 204 })).toThrow(RangeError);
    expect(() => routeData(null, { status: 404 })).not.toThrow();
    expect(() => routeData(null, { headers: { 'Content-Length': '1' } })).toThrow(TypeError);
  });

  it('passes a loader Response through without rendering an error boundary', async () => {
    const redirect = Response.redirect('https://example.test/login', 302);
    const entry: AsyncRouteEntry = {
      pattern: '/private',
      filePath: 'private.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => 'never',
        loader: () => redirect,
      }),
      layouts: [],
      errorBoundary: {
        filePath: '_error.ts',
        importFn: async () => ({ default: () => 'boundary' }),
      },
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    expect(ctx.resolvedErrorsByKey['route:/private']).toBe(redirect);
  });

  it('calls route + layout loaders in parallel when hasLoader is set', async () => {
    const log: string[] = [];
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: (_p: Record<string, string>, data: unknown) => `route-${data}`,
        loader: async () => {
          log.push('route-loader');
          return 'rd';
        },
      }),
      layouts: [
        {
          filePath: '_layout.ts',
          hasLoader: true,
          importFn: async () => ({
            default: (children: () => unknown, data: unknown) => `[${data}]${children()}`,
            loader: async () => {
              log.push('layout-loader');
              return 'ld';
            },
          }),
        },
      ],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    // Both loaders ran.
    expect(log.sort()).toEqual(['layout-loader', 'route-loader']);

    // Pass 2 — fresh asyncRoute call, cached value applied via the
    // underlying resource()'s SSR path. The factory is in resolvedDataByKey.
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(factory()).toBe('[ld]route-rd');
  });

  it('skips loaders when hasLoader is not set', async () => {
    let calls = 0;
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      // hasLoader omitted — loader present but should not be called.
      importFn: async () => ({
        default: (_p: Record<string, string>, data: unknown) =>
          data === undefined ? 'no-data' : `unexpected-${data}`,
        loader: async () => {
          calls++;
          return 'unused';
        },
      }),
      layouts: [],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    expect(calls).toBe(0);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(factory()).toBe('no-data');
  });
});

describe('asyncRoute — error boundary (ADR 0025 / 0021)', () => {
  it('renders the errorBoundary view when a loader rejects', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => 'never',
        loader: async () => {
          throw new Error('loader exploded');
        },
      }),
      layouts: [],
      errorBoundary: {
        filePath: '_error.ts',
        importFn: async () => ({
          default: (err: unknown) => `boundary:${(err as Error).message}`,
        }),
      },
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(inSSRContext(factory, ctx).result).toBe('boundary:loader exploded');
    expect(ctx.routeResponse?.status).toBe(500);
  });

  it('rejects the lazyResource when no errorBoundary is configured', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => 'never',
        loader: async () => {
          throw new Error('uncaught');
        },
      }),
      layouts: [],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.allSettled(ctx.pendingPromises);
    // The error mirror was populated by ADR 0024's lazyResource SSR path.
    expect(ctx.resolvedErrorsByKey['route:/p']).toBeInstanceOf(Error);
    expect((ctx.resolvedErrorsByKey['route:/p'] as Error).message).toBe('uncaught');
  });
});

describe('asyncRoute — layout chain (ADR 0025 / 0020)', () => {
  it('wraps layouts root → leaf via reduceRight', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({ default: () => 'inner' }),
      layouts: [
        {
          filePath: 'a.ts',
          importFn: async () => ({
            default: (children: () => unknown) => `A(${children()})`,
          }),
        },
        {
          filePath: 'b.ts',
          importFn: async () => ({
            default: (children: () => unknown) => `B(${children()})`,
          }),
        },
      ],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    // Root (a) wraps the result of b wrapping inner.
    expect(factory()).toBe('A(B(inner))');
  });
});

describe('asyncNotFound — manifest top-level 404 (ADR 0025 / 0021)', () => {
  it('renders the notFound page on pass 2', async () => {
    const entry: AsyncNotFoundEntry = {
      filePath: '_404.ts',
      importFn: async () => ({ default: () => '404 view' }),
    };
    const { ctx } = inSSRContext(() => asyncNotFound(entry));
    await Promise.all(ctx.pendingPromises);
    expect(ctx.resolvedDataByKey['notFound:_404.ts']).toBeTypeOf('function');
    const factory = ctx.resolvedDataByKey['notFound:_404.ts'] as () => unknown;
    expect(factory()).toBe('404 view');
  });
});

// ---------------------------------------------------------------------------
// ADR 0028 — asyncNotFound chain form. Walks the manifest's notFoundChain
// deepest-first and renders the entry whose `dir` prefixes the current path.
// ---------------------------------------------------------------------------

import { navigate } from '../src/router.ts';

describe('asyncNotFound — chain form (ADR 0028)', () => {
  it('picks the deepest entry whose dir prefixes the current path', async () => {
    // We're inside an SSR context here, so navigate() does nothing on the
    // server — but the test exercises the chain-walk logic via a manually
    // set window.location-like signal. Simulate by pushing the SSR context's
    // request URL.
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: 'admin',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
      {
        filePath: '_404.ts',
        dir: '',
        importFn: async () => ({ default: () => 'ROOT 404' }),
      },
    ];
    // Set client-side URL to /admin/missing so currentPath() returns /admin/missing.
    navigate('/admin/missing');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    expect(ctx.resolvedDataByKey['notFound:admin/_404.ts']).toBeTypeOf('function');
    const factory = ctx.resolvedDataByKey['notFound:admin/_404.ts'] as () => unknown;
    expect(factory()).toBe('ADMIN 404');
  });

  it('falls through to the root entry when no nested dir matches', async () => {
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: 'admin',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
      {
        filePath: '_404.ts',
        dir: '',
        importFn: async () => ({ default: () => 'ROOT 404' }),
      },
    ];
    navigate('/blog/missing');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    expect(ctx.resolvedDataByKey['notFound:_404.ts']).toBeTypeOf('function');
    const factory = ctx.resolvedDataByKey['notFound:_404.ts'] as () => unknown;
    expect(factory()).toBe('ROOT 404');
  });

  it('does NOT match dir prefix on similar-but-different paths', async () => {
    // `dir: 'admin'` should match /admin and /admin/* but NOT /administrator.
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: 'admin',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
      {
        filePath: '_404.ts',
        dir: '',
        importFn: async () => ({ default: () => 'ROOT 404' }),
      },
    ];
    navigate('/administrator');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    // /administrator falls through to root.
    const factory = ctx.resolvedDataByKey['notFound:_404.ts'] as () => unknown;
    expect(factory()).toBe('ROOT 404');
    // admin's _404 was NOT loaded.
    expect(ctx.resolvedDataByKey['notFound:admin/_404.ts']).toBeUndefined();
  });

  it('renders nothing when the chain is empty', () => {
    const { result } = inSSRContext(() => asyncNotFound([]));
    // Empty chain → result is `when(false, ...)` which renders an empty match.
    // We don't assert the exact shape (it's an SSR HTML marker); just that
    // it doesn't throw.
    expect(result).toBeDefined();
  });

  it('renders nothing when no entry matches the current path', async () => {
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: 'admin',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
    ];
    navigate('/blog/missing');
    const { ctx, result } = inSSRContext(() => asyncNotFound(chain));
    // No matching entry → nothing fetched.
    expect(ctx.pendingPromises).toHaveLength(0);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// audit-v2 regressions — render-time error isolation, boundary-import
// failure preservation, dir normalization, loader param freeze.
// ---------------------------------------------------------------------------

describe('asyncRoute — audit-v2 render-time error isolation', () => {
  it('routes a route-view throw through the error boundary instead of escaping when()', async () => {
    // RED before fix: a sync throw inside `routeMod.default()` escapes the
    // try-block in loadStack's catch (which only catches imports/loaders),
    // so when() invokes a thrown factory and the consumer's render crashes.
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({
        default: () => {
          throw new Error('view rendered with stale data');
        },
      }),
      layouts: [],
      errorBoundary: {
        filePath: '_error.ts',
        importFn: async () => ({
          default: (err: unknown) => `caught:${(err as Error).message}`,
        }),
      },
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    // GREEN: the factory does NOT throw; the boundary view rendered instead.
    expect(() => factory()).not.toThrow();
    expect(factory()).toBe('caught:view rendered with stale data');
  });

  it('routes a layout-render throw through the error boundary', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({ default: () => 'inner' }),
      layouts: [
        {
          filePath: '_layout.ts',
          importFn: async () => ({
            default: (_children: () => unknown) => {
              throw new TypeError('layout crashed');
            },
          }),
        },
      ],
      errorBoundary: {
        filePath: '_error.ts',
        importFn: async () => ({
          default: (err: unknown) => `boundary:${(err as Error).message}`,
        }),
      },
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(factory()).toBe('boundary:layout crashed');
  });

  it('still rethrows a render-time throw when no errorBoundary is configured', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({
        default: () => {
          throw new Error('escapes');
        },
      }),
      layouts: [],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    // No boundary → throw must still surface to the consumer's outer
    // fallback path. Routing it to a fake boundary would silently swallow.
    expect(() => factory()).toThrow('escapes');
  });
});

describe('asyncRoute — audit-v2 errorBoundary import failure', () => {
  it('preserves the original loader error when the boundary import itself fails', async () => {
    // RED before fix: the catch block awaited errorBoundary.importFn(),
    // and if that rejected, the throw replaced `err` with the boundary's
    // import error — the original loader bug was invisible.
    const loaderErr = new Error('original loader bug');
    const boundaryErr = new Error('boundary chunk 404');
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => 'never',
        loader: async () => {
          throw loaderErr;
        },
      }),
      layouts: [],
      errorBoundary: {
        filePath: '_error.ts',
        importFn: async () => {
          throw boundaryErr;
        },
      },
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.allSettled(ctx.pendingPromises);
    const surfaced = ctx.resolvedErrorsByKey['route:/p'];
    // GREEN: AggregateError with both layers visible.
    expect(surfaced).toBeInstanceOf(AggregateError);
    const agg = surfaced as AggregateError;
    expect(agg.errors).toHaveLength(2);
    expect(agg.errors[0]).toBe(loaderErr);
    expect(agg.errors[1]).toBe(boundaryErr);
  });

  it('falls through to original-throw when boundary module has no default export', async () => {
    const loaderErr = new Error('the real bug');
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => 'never',
        loader: async () => {
          throw loaderErr;
        },
      }),
      layouts: [],
      errorBoundary: {
        filePath: '_error.ts',
        // No `default` — malformed boundary module.
        importFn: async () => ({}),
      },
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.allSettled(ctx.pendingPromises);
    // Should surface the ORIGINAL error — not an opaque "boundary unusable".
    expect(ctx.resolvedErrorsByKey['route:/p']).toBe(loaderErr);
  });
});

describe('asyncNotFound — audit-v2 dir normalization (ADR 0028)', () => {
  it('accepts a leading slash on dir', async () => {
    // RED before fix: `dir: '/admin'` produced prefix '//admin' which
    // can never match any sane URL path — silently routed to the next
    // chain entry instead.
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: '/admin',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
      {
        filePath: '_404.ts',
        dir: '',
        importFn: async () => ({ default: () => 'ROOT 404' }),
      },
    ];
    navigate('/admin/missing');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['notFound:admin/_404.ts'] as () => unknown;
    expect(factory()).toBe('ADMIN 404');
  });

  it('accepts a trailing slash on dir', async () => {
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: 'admin/',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
      {
        filePath: '_404.ts',
        dir: '',
        importFn: async () => ({ default: () => 'ROOT 404' }),
      },
    ];
    navigate('/admin');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['notFound:admin/_404.ts'] as () => unknown;
    expect(factory()).toBe('ADMIN 404');
  });

  it('treats dir consisting solely of slashes as the root catch-all', async () => {
    const chain = [
      {
        filePath: 'catch.ts',
        dir: '///',
        importFn: async () => ({ default: () => 'CATCH' }),
      },
    ];
    navigate('/anywhere');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['notFound:catch.ts'] as () => unknown;
    expect(factory()).toBe('CATCH');
  });
});

describe('asyncRoute — audit-v2 loader param shielding', () => {
  it('hands the loader a frozen params snapshot so mutations cannot race the view', async () => {
    // RED before fix: ctx.params === routeMod.default(params, …)'s same
    // object. A loader that did `ctx.params.id = sanitize(ctx.params.id)`
    // would silently mutate the view's input mid-render. Freezing the
    // snapshot surfaces the bug at the loader instead.
    let loaderSawFrozen = false;
    const original = { id: 'raw' };
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: (_p: Record<string, string>) => 'ok',
        loader: async (ctx: LoaderContext) => {
          loaderSawFrozen = Object.isFrozen(ctx.params);
          // The original caller's bag must NOT be frozen — only the loader's
          // snapshot is sealed.
          return null;
        },
      }),
      layouts: [],
    };
    // Need a local import for LoaderContext typing within the test scope.
    type LoaderContext = import('../src/async-route.ts').LoaderContext;

    const { ctx } = inSSRContext(() => asyncRoute(entry, original));
    await Promise.all(ctx.pendingPromises);
    expect(loaderSawFrozen).toBe(true);
    // Caller's original params bag is untouched (and still mutable).
    expect(Object.isFrozen(original)).toBe(false);
    expect(original).toEqual({ id: 'raw' });
  });
});

describe('asyncRoute — audit-v2 tokened loaderData balance', () => {
  it('the route view-factory uses tokened push/pop so unbalanced user pushes are detected', async () => {
    // RED before fix: untokened popLoaderData() silently removed whatever
    // top frame was on the stack — a misbehaving route view that pushed
    // without popping leaked its frame upward and corrupted later reads.
    const { pushLoaderData, loaderDataStackDepth, resetLoaderDataStack } =
      await import('../src/loader-data.ts');
    resetLoaderDataStack();
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({
        default: () => {
          // Misbehaving view: pushes without popping.
          pushLoaderData('rogue');
          return 'view';
        },
      }),
      layouts: [],
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    // GREEN: the wrapping tokened pop throws on mismatch — bug surfaces
    // at the offending call site instead of silently leaking the frame.
    expect(() => factory()).toThrow(/imbalance/);
    // Clean up so other tests aren't poisoned.
    resetLoaderDataStack();
    expect(loaderDataStackDepth()).toBe(0);
  });
});
