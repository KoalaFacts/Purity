import { createServer, type ServerResponse } from 'node:http';
import {
  asyncRoute,
  routeData,
  suspense,
  type AsyncRouteEntry,
  type LoaderContext,
} from '@purityjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  html,
  renderToStream,
  renderToStreamResponse,
  renderToString,
  type RenderToStreamOptions,
} from '../src/index.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function route(pattern: string, loader: (ctx: LoaderContext) => unknown): AsyncRouteEntry {
  return {
    pattern,
    filePath: `${pattern.slice(1)}.ts`,
    hasLoader: true,
    importFn: async () => ({
      default: (_params: unknown, data: unknown) => html`<p>${data}</p>`,
      loader,
    }),
    layouts: [
      {
        filePath: '_layout.ts',
        hasLoader: true,
        importFn: async () => ({ default: (children: () => unknown) => children(), loader }),
      },
    ],
  };
}

const renderers = [
  {
    name: 'buffered',
    render: (view: () => unknown, options: RenderToStreamOptions) => renderToString(view, options),
  },
  {
    name: 'stream',
    render: (view: () => unknown, options: RenderToStreamOptions) =>
      new Response(renderToStream(view, options)).text(),
  },
  {
    name: 'stream response',
    render: async (view: () => unknown, options: RenderToStreamOptions) =>
      new Response((await renderToStreamResponse(view, options)).body).text(),
  },
];

describe.each(renderers)('SSR route cancellation — $name', ({ name, render }) => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cancels page and layout loaders on global timeout without aborting the request', async () => {
    const signals: AbortSignal[] = [];
    const entry = route('/slow', ({ signal }) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const request = new Request('https://example.test/slow');
    const outcome = render(() => asyncRoute(entry, {}), { request, timeout: 20 }).catch(
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    await vi.advanceTimersByTimeAsync(20);
    const error = await outcome;
    expect(error.message).toContain('timed out');
    expect(signals[0].aborted).toBe(true);
    expect(signals[0].reason).toBe(error);
    expect(signals[1].aborted).toBe(true);
    expect(signals[1].reason).toBe(error);
    expect(request.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['request', 'explicit', 'custom request'] as const)(
    'forwards %s cancellation and detaches listeners',
    async (source) => {
      const requestAbort = new AbortController();
      const explicit = new AbortController();
      const customAbort = new AbortController();
      const request = new Request('https://example.test/slow', { signal: requestAbort.signal });
      const custom = new Request('https://example.test/custom', { signal: customAbort.signal });
      const loaderRequest = source === 'custom request' ? custom : request;
      const add = vi.spyOn(loaderRequest.signal, 'addEventListener');
      const remove = vi.spyOn(loaderRequest.signal, 'removeEventListener');
      const signals: AbortSignal[] = [];
      const entry = route('/slow', ({ signal, request: incoming }) => {
        expect(incoming).toBe(loaderRequest);
        signals.push(signal);
        return new Promise(() => {});
      });
      const outcome = render(() => asyncRoute(entry, {}, { request: () => loaderRequest }), {
        request,
        signal: explicit.signal,
      }).catch((error) => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(signals).toHaveLength(2);
      const reason = new Error('cancel route');
      (source === 'request' ? requestAbort : source === 'explicit' ? explicit : customAbort).abort(
        reason,
      );
      // Direct streams close on external cancellation; buffered/prepared shells
      // reject. A custom loader request fails the shell rather than its stream.
      expect(await outcome).toBe(name === 'stream' && source !== 'custom request' ? '' : reason);
      expect(signals[0].aborted).toBe(true);
      expect(signals[0].reason).toBe(reason);
      expect(signals[1].aborted).toBe(true);
      expect(signals[1].reason).toBe(reason);
      expect(explicit.signal.aborted).toBe(source === 'explicit');
      expect(request.signal.aborted).toBe(source === 'request');
      for (const [type, listener] of add.mock.calls) {
        if (type === 'abort') expect(remove).toHaveBeenCalledWith(type, listener);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['value', 'error', 'redirect'] as const)(
    'isolates a boundary deadline and ignores a late loader %s',
    async (late) => {
      const slow = deferred<unknown>();
      const healthy = deferred<string>();
      const slowSignals: AbortSignal[] = [];
      const healthySignals: AbortSignal[] = [];
      const slowEntry = route('/slow', ({ signal }) => {
        slowSignals.push(signal);
        return slow.promise;
      });
      const healthyEntry = route('/healthy', ({ signal }) => {
        healthySignals.push(signal);
        return healthy.promise;
      });
      const errorView = vi.fn(() => html`<p>UNEXPECTED ERROR</p>`);
      const errorImport = vi.fn(async () => ({ default: errorView }));
      slowEntry.errorBoundary = { filePath: '_error.ts', importFn: errorImport };
      const request = new Request('https://example.test/');
      const result = render(
        () =>
          html`${suspense(
            () => asyncRoute(slowEntry, {}),
            () => html`<p>EXPIRED</p>`,
            { timeout: 20 },
          )}${suspense(
            () => asyncRoute(healthyEntry, {}),
            () => html`<p>WAITING</p>`,
            { timeout: 1000 },
          )}`,
        { request },
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(slowSignals).toHaveLength(2);
      expect(slowSignals[0]).not.toBe(slowSignals[1]);
      expect(slowSignals[0].aborted).toBe(true);
      expect(slowSignals[0].reason.name).toBe('TimeoutError');
      expect(slowSignals[1].aborted).toBe(true);
      expect(slowSignals[1].reason).toBe(slowSignals[0].reason);
      expect(healthySignals).toHaveLength(2);
      expect(healthySignals[0].aborted).toBe(false);
      expect(request.signal.aborted).toBe(false);
      if (late === 'value')
        slow.resolve(routeData('LATE', { status: 201, headers: { 'X-Late': 'yes' } }));
      else
        slow.reject(
          late === 'redirect' ? Response.redirect('https://example.test/late') : new Error('LATE'),
        );
      healthy.resolve('HEALTHY');
      const output = await result;
      expect(output).toContain('EXPIRED');
      expect(output).toContain('HEALTHY');
      expect(output).not.toContain('LATE');
      expect(output).not.toContain('route:/slow');
      expect(errorImport).not.toHaveBeenCalled();
      expect(errorView).not.toHaveBeenCalled();
      expect(healthySignals).toHaveLength(2);
      expect(healthySignals[0].aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['module', 'error preload'] as const)(
    'does not resume the route after expiry during %s import',
    async (stage) => {
      const imported = deferred<unknown>();
      const loader = vi.fn(() => 'READY');
      const view = vi.fn(() => html`<p>UNEXPECTED VIEW</p>`);
      const errorView = vi.fn(() => html`<p>UNEXPECTED ERROR</p>`);
      const entry = route('/slow', loader);
      entry.layouts = [];
      entry.importFn =
        stage === 'module' ? () => imported.promise : async () => ({ default: view, loader });
      entry.errorBoundary = {
        filePath: '_error.ts',
        importFn:
          stage === 'error preload'
            ? () => imported.promise
            : vi.fn(async () => ({ default: errorView })),
      };
      const request = new Request('https://example.test/slow');
      const result = render(
        () =>
          suspense(
            () => asyncRoute(entry, {}),
            () => html`<p>EXPIRED</p>`,
            { timeout: 20 },
          ),
        { request },
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(await result).toContain('EXPIRED');
      imported.resolve({ default: stage === 'module' ? view : errorView, loader });
      await vi.advanceTimersByTimeAsync(0);
      expect(loader).toHaveBeenCalledTimes(stage === 'module' ? 0 : 1);
      expect(view).not.toHaveBeenCalled();
      expect(errorView).not.toHaveBeenCalled();
      expect(request.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('cancels nested loaders with the parent deadline and runs fallback loaders in an active scope', async () => {
    const expired: AbortSignal[] = [];
    const recovered: AbortSignal[] = [];
    const slow = route('/slow', ({ signal }) => {
      expired.push(signal);
      return new Promise(() => {});
    });
    const fallback = route('/fallback', ({ signal }) => {
      recovered.push(signal);
      return 'RECOVERED';
    });
    const request = new Request('https://example.test/');
    const result = render(
      () =>
        suspense(
          () =>
            suspense(
              () => asyncRoute(slow, {}),
              () => html`<p>child fallback</p>`,
              { timeout: 1000 },
            ),
          () => asyncRoute(fallback, {}),
          { timeout: 20 },
        ),
      { request },
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toContain('RECOVERED');
    expect(expired).toHaveLength(2);
    expect(expired[0].aborted).toBe(true);
    expect(expired[0].reason.name).toBe('TimeoutError');
    // Streams render the fallback in the shell and again in the timed-out
    // fragment. Each pipeline's page/layout pair must have an active scope.
    expect(recovered).toHaveLength(name === 'buffered' ? 2 : 4);
    expect(recovered.every((signal) => !signal.aborted)).toBe(true);
    expect(request.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a completed route factory usable across passes while a neighbor expires', async () => {
    const signals: AbortSignal[] = [];
    const ready = route('/ready', ({ signal }) => {
      signals.push(signal);
      return 'READY';
    });
    const slow = route('/slow', () => new Promise(() => {}));
    const request = new Request('https://example.test/');
    const result = render(
      () =>
        html`${asyncRoute(ready, {})}${suspense(
          () => asyncRoute(slow, {}),
          () => html`<p>EXPIRED</p>`,
          { timeout: 20 },
        )}`,
      { request },
    );
    await vi.advanceTimersByTimeAsync(20);
    const output = await result;
    expect(output).toContain('READY');
    expect(output).toContain('EXPIRED');
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(false);
    expect(request.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['success', 'error', 'response'] as const)(
    'detaches SSR forwarding after %s and keeps successful loader signals live',
    async (mode) => {
      const request = new Request('https://example.test/ready');
      const add = vi.spyOn(request.signal, 'addEventListener');
      const remove = vi.spyOn(request.signal, 'removeEventListener');
      const signals: AbortSignal[] = [];
      const response = Response.redirect('https://example.test/next');
      const entry = route('/ready', ({ signal }) => {
        signals.push(signal);
        if (mode === 'error') throw new Error('EXPECTED');
        if (mode === 'response') return response;
        return 'READY';
      });
      const output = await render(() => asyncRoute(entry, {}), { request }).catch((error) => error);
      if (mode === 'success') expect(output).toContain('READY');
      else if (mode === 'response') expect(output).toBe(response);
      else expect(output.message).toBe('EXPECTED');
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => !signal.aborted)).toBe(true);
      for (const [type, listener] of add.mock.calls) {
        if (type === 'abort') expect(remove).toHaveBeenCalledWith(type, listener);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['page', 'layout'] as const)(
    'cancels an unfinished peer when the %s loader fails or ends HTTP handling',
    async (failing) => {
      for (const kind of ['error', 'redirect', 'response'] as const) {
        const peer = deferred<unknown>();
        let peerSignal!: AbortSignal;
        const outcome =
          kind === 'error'
            ? new Error('FAILED LOADER')
            : kind === 'redirect'
              ? Response.redirect('https://example.test/next', 303)
              : new Response('CUSTOM BODY', { status: 404 });
        const fail = () => {
          if (kind === 'error') throw outcome;
          return outcome;
        };
        const wait = ({ signal }: LoaderContext) => {
          peerSignal = signal;
          return peer.promise;
        };
        const pageView = vi.fn(() => html`<p>UNEXPECTED PAGE</p>`);
        const layoutView = vi.fn((children: () => unknown) => children());
        const errorView = vi.fn((error: unknown) => {
          expect(error).toBe(outcome);
          return html`<p>HANDLED ERROR</p>`;
        });
        const entry: AsyncRouteEntry = {
          pattern: '/failure',
          filePath: 'failure.ts',
          hasLoader: true,
          importFn: async () => ({ default: pageView, loader: failing === 'page' ? fail : wait }),
          layouts: [
            {
              filePath: '_layout.ts',
              hasLoader: true,
              importFn: async () => ({
                default: layoutView,
                loader: failing === 'layout' ? fail : wait,
              }),
            },
          ],
          errorBoundary: { filePath: '_error.ts', importFn: async () => ({ default: errorView }) },
        };
        const request = new Request('https://example.test/failure');
        const output = await render(() => asyncRoute(entry, {}), { request }).catch(
          (error) => error,
        );
        if (kind === 'error') {
          expect(output).toContain('HANDLED ERROR');
          expect(errorView).toHaveBeenCalledOnce();
        } else {
          expect(output).toBe(outcome);
          expect(errorView).not.toHaveBeenCalled();
        }
        expect(peerSignal.aborted).toBe(true);
        expect(peerSignal.reason).toBe(outcome);
        expect(request.signal.aborted).toBe(false);
        peer.reject(new Error('Late peer rejection'));
        await vi.advanceTimersByTimeAsync(0);
        expect(pageView).not.toHaveBeenCalled();
        expect(layoutView).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
    },
  );
});

describe.each(['stream', 'stream response'])('SSR route reader cancellation — %s', (mode) => {
  it('cancels deferred page/layout loaders with the consumer reason', async () => {
    const signals: AbortSignal[] = [];
    const started = deferred<void>();
    const entry = route('/slow', ({ signal }) => {
      signals.push(signal);
      if (signals.length === 2) started.resolve();
      return new Promise(() => {});
    });
    const request = new Request('https://example.test/slow');
    const view = () =>
      suspense(
        () => asyncRoute(entry, {}),
        () => html`<p>WAITING</p>`,
      );
    const stream =
      mode === 'stream'
        ? renderToStream(view, { request })
        : (await renderToStreamResponse(view, { request })).body;
    const reader = stream.getReader();
    await reader.read();
    await started.promise;
    const reason = new Error('consumer left');
    await reader.cancel(reason);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[0].reason).toBe(reason);
    expect(signals[1].aborted).toBe(true);
    expect(signals[1].reason).toBe(reason);
    expect(request.signal.aborted).toBe(false);
  });
});

describe.each(renderers)('SSR loader Response transfer — $name', ({ render }) => {
  it('keeps a real fetched body readable while canceling an unfinished peer', async () => {
    let reply!: ServerResponse;
    const server = createServer((_request, response) => {
      reply = response;
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('NETWORK ');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
      let winnerSignal!: AbortSignal;
      let peerSignal!: AbortSignal;
      const entry: AsyncRouteEntry = {
        pattern: '/response',
        filePath: 'response.ts',
        hasLoader: true,
        importFn: async () => ({
          default: () => 'unused',
          loader: ({ signal }: LoaderContext) => {
            winnerSignal = signal;
            return fetch(`http://127.0.0.1:${address.port}/body`, { signal });
          },
        }),
        layouts: [
          {
            filePath: '_layout.ts',
            hasLoader: true,
            importFn: async () => ({
              default: (children: () => unknown) => children(),
              loader: ({ signal }: LoaderContext) => {
                peerSignal = signal;
                return new Promise(() => {});
              },
            }),
          },
        ],
      };
      const request = new Request('https://example.test/response');
      const result = await render(() => asyncRoute(entry, {}), { request }).catch((error) => error);
      expect(result).toBeInstanceOf(Response);
      expect(peerSignal.aborted).toBe(true);
      expect(peerSignal.reason).toBe(result);
      expect(winnerSignal.aborted).toBe(false);
      expect(request.signal.aborted).toBe(false);
      reply.end('BODY');
      expect(await (result as Response).text()).toBe('NETWORK BODY');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
