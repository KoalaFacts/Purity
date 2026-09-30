import { getSSRRenderContext, resource, suspense, type SSRRenderContext } from '@purityjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  html,
  renderToStream,
  renderToStreamResponse,
  type RenderToStreamOptions,
} from '../src/index.ts';

const renderers = [
  {
    name: 'direct stream',
    render: async (view: () => unknown, options: RenderToStreamOptions = {}) =>
      renderToStream(view, options),
  },
  {
    name: 'prepared stream',
    render: async (view: () => unknown, options: RenderToStreamOptions = {}) =>
      (await renderToStreamResponse(view, options)).body,
  },
];

describe.each(renderers)('SSR boundary retention — $name', ({ render }) => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function fixture(options: RenderToStreamOptions = {}) {
    let boundaries!: NonNullable<SSRRenderContext['streamingBoundaries']>;
    const views = Array.from({ length: 64 }, (_, id) => vi.fn(() => html`<p>${id}</p>`));
    const stream = render(() => {
      boundaries = getSSRRenderContext()!.streamingBoundaries!;
      return html`<main>${views.map((view) => suspense(view, () => html`<p>WAITING</p>`))}</main>`;
    }, options);
    return { stream, views, getBoundaries: () => boundaries };
  }

  it('removes consumed callbacks while preserving remaining boundary order', async () => {
    const { stream, views, getBoundaries } = fixture();
    const reader = (await stream).getReader();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(getBoundaries().size).toBe(64);
      await reader.read();
      for (let id = 1; id <= 64; id++) {
        await vi.advanceTimersByTimeAsync(0);
        expect(getBoundaries().size).toBe(64 - id);
        expect([...getBoundaries().keys()]).toEqual(
          Array.from({ length: 64 - id }, (_, index) => id + index + 1),
        );
        const output = await reader.read();
        expect(new TextDecoder().decode(output.value)).toContain(`__purity_swap(${id});`);
      }
      expect((await reader.read()).done).toBe(true);
      expect(views.every((view) => view.mock.calls.length === 1)).toBe(true);
      expect(getBoundaries().size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it('clears unread callbacks on consumer cancellation', async () => {
    const { stream, views, getBoundaries } = fixture();
    const body = await stream;
    await vi.advanceTimersByTimeAsync(0);
    expect(getBoundaries().size).toBe(64);
    await body.cancel(new Error('consumer left'));
    expect(getBoundaries().size).toBe(0);
    expect(views.every((view) => view.mock.calls.length === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears unread callbacks on external abort', async () => {
    const controller = new AbortController();
    const { stream, views, getBoundaries } = fixture({ signal: controller.signal });
    const body = await stream;
    await vi.advanceTimersByTimeAsync(0);
    expect(getBoundaries().size).toBe(64);
    controller.abort(new Error('request left'));
    expect(getBoundaries().size).toBe(0);
    const reader = body.getReader();
    try {
      while (!(await reader.read()).done) {
        /* Drain the already queued shell. */
      }
    } finally {
      reader.releaseLock();
    }
    expect(views.every((view) => view.mock.calls.length === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears remaining callbacks when boundary resource serialization fails', async () => {
    let boundaries!: NonNullable<SSRRenderContext['streamingBoundaries']>;
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const sibling = vi.fn(() => html`<p>UNEXPECTED</p>`);
    const body = await render(() => {
      boundaries = getSSRRenderContext()!.streamingBoundaries!;
      return html`<main>${suspense(
        () => {
          resource(() => cyclic, { key: 'cyclic' });
          return html`<p>READY</p>`;
        },
        () => html`<p>WAITING</p>`,
      )}${suspense(sibling, () => html`<p>SIBLING</p>`)}</main>`;
    });
    const reader = body.getReader();
    try {
      await reader.read();
      const rejected = expect(reader.read()).rejects.toThrow(TypeError);
      await vi.advanceTimersByTimeAsync(0);
      await rejected;
      expect(boundaries.size).toBe(0);
      expect(sibling).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      reader.releaseLock();
    }
  });

  it('clears queued callbacks while canceling an active resource with the original reason', async () => {
    let boundaries!: NonNullable<SSRRenderContext['streamingBoundaries']>;
    let signal!: AbortSignal;
    const sibling = vi.fn(() => html`<p>UNEXPECTED</p>`);
    const body = await render(() => {
      boundaries = getSSRRenderContext()!.streamingBoundaries!;
      return html`<main>${suspense(
        () => {
          const data = resource((info) => {
            signal = info.signal;
            return new Promise<string>(() => {});
          });
          return html`<p>${() => data()}</p>`;
        },
        () => html`<p>WAITING</p>`,
      )}${suspense(sibling, () => html`<p>SIBLING</p>`)}</main>`;
    });
    const reader = body.getReader();
    try {
      await reader.read();
      await vi.advanceTimersByTimeAsync(0);
      expect(boundaries.size).toBe(1);
      const reason = new Error('consumer left');
      await reader.cancel(reason);
      expect(boundaries.size).toBe(0);
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe(reason);
      expect(sibling).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });
});
