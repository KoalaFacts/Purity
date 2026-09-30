import { resource, suspense } from '@purityjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  SSRTimeoutError,
  html,
  renderToStream,
  renderToStreamResponse,
  renderToString,
  renderStatic,
  type RenderToStreamOptions,
} from '../src/index.ts';

const renderers = [
  {
    name: 'buffered',
    phase: 'render',
    render: (view: () => unknown, options: RenderToStreamOptions) => renderToString(view, options),
  },
  {
    name: 'direct stream',
    phase: 'shell',
    render: (view: () => unknown, options: RenderToStreamOptions) =>
      new Response(renderToStream(view, options)).text(),
  },
  {
    name: 'prepared stream',
    phase: 'shell',
    render: async (view: () => unknown, options: RenderToStreamOptions) =>
      new Response((await renderToStreamResponse(view, options)).body).text(),
  },
];

describe.each(renderers)('SSR timeout contract — $name', ({ render, phase }) => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([0, 20, undefined])(
    'identifies budget %s and cancels resources with the same error',
    async (timeout) => {
      let signal: AbortSignal | undefined;
      const request = new Request('https://example.test/slow');
      const outcome = render(
        () => {
          const value = resource((context) => {
            signal = context.signal;
            return new Promise(() => {});
          });
          return html`<p>${() => value()}</p>`;
        },
        { request, timeout },
      ).catch((error) => error);
      const budget = timeout ?? 5000;
      await vi.advanceTimersByTimeAsync(budget);
      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SSRTimeoutError);
      expect(error).toMatchObject({
        name: 'SSRTimeoutError',
        code: 'PURITY_SSR_TIMEOUT',
        phase,
        timeout: budget,
      });
      expect(error.message).toContain(`timed out after ${budget}ms`);
      expect(signal?.aborted).toBe(true);
      expect(signal?.reason).toBe(error);
      expect(request.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('preserves a user error whose name and message resemble a timeout', async () => {
    const error = new Error('renderToString timed out after 20ms');
    error.name = 'SSRTimeoutError';
    await expect(
      render(
        () => {
          throw error;
        },
        { timeout: 20 },
      ),
    ).rejects.toBe(error);
    expect(error).not.toBeInstanceOf(SSRTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses local fallback without raising a render timeout', async () => {
    let signal: AbortSignal | undefined;
    const outcome = render(
      () =>
        suspense(
          () => {
            const value = resource(
              (context) => {
                signal = context.signal;
                return new Promise(() => {});
              },
              { key: 'slow-boundary' },
            );
            return html`<p>${() => value()}</p>`;
          },
          () => html`<p>Unavailable section</p>`,
          { timeout: 10 },
        ),
      { timeout: 100 },
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toContain('Unavailable section');
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason.name).toBe('TimeoutError');
    expect(signal?.reason).not.toBeInstanceOf(SSRTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('collects typed static-route timeouts as failures without publishing their HTML', async () => {
  vi.useFakeTimers();
  try {
    const outcome = renderStatic({
      routes: ['/slow'],
      handler: () => () => {
        const value = resource(() => new Promise(() => {}));
        return html`<p>${() => value()}</p>`;
      },
      renderOptions: { timeout: 20 },
    });
    await vi.advanceTimersByTimeAsync(20);
    const result = await outcome;
    expect(result.files.size).toBe(0);
    expect(result.errors.get('/slow')).toBeInstanceOf(SSRTimeoutError);
    expect(result.errors.get('/slow')).toMatchObject({ phase: 'render', timeout: 20 });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('preserves an externally supplied TimeoutError reason', async () => {
  const abort = new AbortController();
  const reason = new DOMException('Upstream timeout', 'TimeoutError');
  abort.abort(reason);
  for (const render of [renderToString, renderToStreamResponse]) {
    await expect(render(() => html`<p>unused</p>`, { signal: abort.signal })).rejects.toBe(reason);
  }
  expect(reason).not.toBeInstanceOf(SSRTimeoutError);
});
