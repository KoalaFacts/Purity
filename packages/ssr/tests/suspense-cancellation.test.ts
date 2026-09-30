import {
  getSSRRenderContext,
  lazyResource,
  query,
  resource,
  suspense,
  type ResourceFetchInfo,
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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const renderers = [
  {
    name: 'buffered',
    render: (view: () => unknown, options: RenderToStreamOptions = {}) =>
      renderToString(view, options),
  },
  {
    name: 'stream',
    render: (view: () => unknown, options: RenderToStreamOptions = {}) =>
      new Response(renderToStream(view, options)).text(),
  },
  {
    name: 'stream response',
    render: async (view: () => unknown, options: RenderToStreamOptions = {}) =>
      new Response((await renderToStreamResponse(view, options)).body).text(),
  },
];

describe.each(renderers)('Suspense cancellation — $name', ({ name, render }) => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['resource', 'lazyResource', 'query'] as const)(
    'cancels %s at its deadline while its sibling stays active',
    async (kind) => {
      const sibling = deferred<string>();
      let slowSignal!: AbortSignal;
      let siblingSignal!: AbortSignal;
      let siblingFetches = 0;
      let registry!: NonNullable<ReturnType<typeof getSSRRenderContext>>['boundaryAborts'];
      const request = new Request('https://example.test/');
      const fetcher = ({ signal }: ResourceFetchInfo) => {
        slowSignal = signal;
        return new Promise<string>(() => {});
      };
      const result = render(
        () =>
          html`<main>${suspense(
            () => {
              const value =
                kind === 'query'
                  ? query({ key: 'slow', fetcher: (_key, info) => fetcher(info) })
                  : kind === 'resource'
                    ? resource(fetcher, { key: 'slow' })
                    : lazyResource((_arg: string, info) => fetcher(info), { key: 'slow' });
              if (kind === 'lazyResource')
                (value as ReturnType<typeof lazyResource<string, string>>).fetch('input');
              registry = getSSRRenderContext()!.boundaryAborts;
              return html`<p>${() => value() ?? 'waiting'}</p>`;
            },
            () => html`<p>SLOW-FALLBACK</p>`,
            { timeout: 20 },
          )}${suspense(
            () => {
              const value = resource(
                ({ signal }) => {
                  siblingFetches++;
                  siblingSignal = signal;
                  return sibling.promise;
                },
                { key: 'healthy' },
              );
              return html`<p>${() => value()}</p>`;
            },
            () => html`<p>SIBLING-FALLBACK</p>`,
            { timeout: 1000 },
          )}</main>`,
        { request },
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(slowSignal.aborted).toBe(true);
      expect(slowSignal.reason.name).toBe('TimeoutError');
      expect(siblingSignal.aborted).toBe(false);
      expect(request.signal.aborted).toBe(false);
      sibling.resolve('HEALTHY');
      const output = await result;
      expect(output).toContain('SLOW-FALLBACK');
      expect(output).toContain('HEALTHY');
      expect(output).not.toContain('"slow"');
      if (kind === 'query') expect(output).not.toContain('s:slow');
      expect(siblingFetches).toBe(1);
      expect(siblingSignal.aborted).toBe(false);
      expect(registry?.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('cancels a nested child without canceling its parent resource', async () => {
    const parent = deferred<string>();
    let parentSignal!: AbortSignal;
    let childSignal!: AbortSignal;
    const result = render(
      () =>
        html`${suspense(
          () => {
            const value = resource(
              ({ signal }) => {
                parentSignal = signal;
                return parent.promise;
              },
              { key: 'parent' },
            );
            return html`<section>${() => value()}${suspense(
              () => {
                resource(
                  ({ signal }) => {
                    childSignal = signal;
                    return new Promise(() => {});
                  },
                  { key: 'child' },
                );
                return html`<p>child view</p>`;
              },
              () => html`<p>CHILD-FALLBACK</p>`,
              { timeout: 10 },
            )}</section>`;
          },
          () => html`<p>PARENT-FALLBACK</p>`,
          { timeout: 200 },
        )}`,
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(childSignal.aborted).toBe(true);
    expect(parentSignal.aborted).toBe(false);
    parent.resolve('PARENT-READY');
    const output = await result;
    expect(output).toContain('PARENT-READY');
    expect(output).toContain('CHILD-FALLBACK');
    expect(output).not.toContain('PARENT-FALLBACK</p></template>');
    expect(output).not.toContain('"child"');
  });

  it('cancels descendants when the parent expires and keeps an outside sibling alive', async () => {
    const sibling = deferred<string>();
    let childSignal!: AbortSignal;
    let siblingSignal!: AbortSignal;
    const result = render(
      () =>
        html`${suspense(
          () =>
            html`${suspense(
              () => {
                resource(
                  ({ signal }) => {
                    childSignal = signal;
                    return new Promise(() => {});
                  },
                  { key: 'child' },
                );
                return html`<p>child view</p>`;
              },
              () => html`<p>child fallback</p>`,
              { timeout: 200 },
            )}`,
          () => html`<p>PARENT-FALLBACK</p>`,
          { timeout: 10 },
        )}${suspense(
          () => {
            const value = resource(
              ({ signal }) => {
                siblingSignal = signal;
                return sibling.promise;
              },
              { key: 'outside' },
            );
            return html`<p>${() => value()}</p>`;
          },
          () => html`<p>outside fallback</p>`,
          { timeout: 1000 },
        )}`,
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(childSignal.aborted).toBe(true);
    expect(siblingSignal.aborted).toBe(false);
    sibling.resolve('OUTSIDE-READY');
    const output = await result;
    expect(output).toContain('PARENT-FALLBACK');
    expect(output).toContain('OUTSIDE-READY');
    expect(output).not.toContain('"child"');
  });

  it('cancels failed view work immediately and gives fallback resources an active signal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('view failed');
    let failedSignal!: AbortSignal;
    const fallbackSignals: AbortSignal[] = [];
    const result = render(
      () =>
        html`${suspense(
          () => {
            resource(
              ({ signal }) => {
                failedSignal = signal;
                return new Promise(() => {});
              },
              { key: 'failed' },
            );
            throw failure;
          },
          () => {
            const value = resource(
              ({ signal }) => {
                fallbackSignals.push(signal);
                return Promise.resolve('SAFE-FALLBACK');
              },
              { key: 'fallback' },
            );
            return html`<p>${() => value()}</p>`;
          },
        )}`,
    );
    await vi.advanceTimersByTimeAsync(0);
    const output = await result;
    expect(failedSignal.aborted).toBe(true);
    expect(failedSignal.reason).toBe(failure);
    expect(fallbackSignals.every((signal) => !signal.aborted)).toBe(true);
    expect(output).toContain('SAFE-FALLBACK');
    expect(output).not.toContain('"failed"');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives resource-backed fallback work an active signal after a view timeout', async () => {
    let expiredSignal!: AbortSignal;
    const fallbackSignals: AbortSignal[] = [];
    const result = render(
      () =>
        html`${suspense(
          () => {
            resource(
              ({ signal }) => {
                expiredSignal = signal;
                return new Promise(() => {});
              },
              { key: 'expired' },
            );
            return html`<p>expired view</p>`;
          },
          () => {
            const value = resource(
              ({ signal }) => {
                fallbackSignals.push(signal);
                return Promise.resolve('TIMEOUT-FALLBACK');
              },
              { key: 'timeout-fallback' },
            );
            return html`<p>${() => value()}</p>`;
          },
          { timeout: 20 },
        )}`,
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toContain('TIMEOUT-FALLBACK');
    expect(expiredSignal.aborted).toBe(true);
    expect(fallbackSignals.length).toBeGreaterThan(0);
    expect(fallbackSignals.every((signal) => !signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives a nested fallback a fresh deadline after a child and its parent expire', async () => {
    let fallbackSignal!: AbortSignal;
    const result = render(
      () =>
        html`${suspense(
          () => {
            resource(() => new Promise(() => {}), { key: 'parent-pending' });
            return html`${suspense(
              () => {
                resource(() => new Promise(() => {}), { key: 'child-pending' });
                return html`<p>old child</p>`;
              },
              () => html`<p>old child fallback</p>`,
              { timeout: 10 },
            )}`;
          },
          () =>
            html`${suspense(
              () => {
                const value = resource(
                  ({ signal }) => {
                    fallbackSignal = signal;
                    return Promise.resolve('FRESH-FALLBACK-VIEW');
                  },
                  { key: 'fresh-fallback' },
                );
                return html`<p>${() => value()}</p>`;
              },
              () => html`<p>fresh child unavailable</p>`,
              { timeout: 100 },
            )}`,
          { timeout: 20 },
        )}`,
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toContain('FRESH-FALLBACK-VIEW');
    expect(fallbackSignal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not time out a completed resource while waiting for a slower sibling', async () => {
    const sibling = deferred<string>();
    let fastSignal!: AbortSignal;
    const result = render(
      () =>
        html`${suspense(
          () => {
            const value = resource(
              ({ signal }) => {
                fastSignal = signal;
                return Promise.resolve('FAST-READY');
              },
              { key: 'fast' },
            );
            return html`<p>${() => value()}</p>`;
          },
          () => html`<p>FAST-FALLBACK</p>`,
          { timeout: 10 },
        )}${suspense(
          () => {
            const value = resource(() => sibling.promise, { key: 'slow-sibling' });
            return html`<p>${() => value()}</p>`;
          },
          () => html`<p>slow fallback</p>`,
          { timeout: 1000 },
        )}`,
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(fastSignal.aborted).toBe(false);
    sibling.resolve('SIBLING-READY');
    const output = await result;
    expect(output).toContain('FAST-READY');
    expect(output).toContain('SIBLING-READY');
    if (name === 'buffered') expect(output).not.toContain('FAST-FALLBACK');
  });

  it('keeps siblings with the same query key in independent cancellation scopes', async () => {
    const healthy = deferred<string>();
    const signals: AbortSignal[] = [];
    const fetcher = (_key: unknown, { signal }: ResourceFetchInfo) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<string>(() => {}) : healthy.promise;
    };
    const result = render(
      () =>
        html`${suspense(
          () => {
            const value = query({ key: 'shared-query', fetcher });
            return html`<p>${() => value()}</p>`;
          },
          () => html`<p>EXPIRED-QUERY</p>`,
          { timeout: 20 },
        )}${suspense(
          () => {
            const value = query({ key: 'shared-query', fetcher });
            return html`<p>${() => value()}</p>`;
          },
          () => html`<p>healthy query fallback</p>`,
          { timeout: 1000 },
        )}`,
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    healthy.resolve('HEALTHY-QUERY');
    expect(await result).toContain('HEALTHY-QUERY');
    expect(signals).toHaveLength(2);
  });

  if (name !== 'buffered')
    it('anchors deadlines to the shell and skips a view already expired before it starts', async () => {
      const view = vi.fn(() => html`<p>UNEXPECTED-VIEW</p>`);
      const onError = vi.fn();
      const result = render(() => {
        resource(() => new Promise((resolve) => setTimeout(() => resolve('shell'), 40)), {
          key: 'shell',
        });
        return html`${suspense(view, () => html`<p>EXPIRED-FALLBACK</p>`, { timeout: 10, onError })}`;
      });
      await vi.advanceTimersByTimeAsync(40);
      expect(await result).toContain('EXPIRED-FALLBACK');
      expect(view).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ phase: 'timeout' }),
      );
      expect(vi.getTimerCount()).toBe(0);
    });
});
