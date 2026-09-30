import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resource, suspense } from '@purityjs/core';
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

async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    expect(value.byteLength).toBeLessThanOrEqual(64 * 1024);
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

describe.each(renderers)('SSR backpressure — $name', ({ render }) => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pauses 64 large boundary renders until the consumer drains their output', async () => {
    const views = Array.from({ length: 64 }, (_, index) =>
      vi.fn(() => html`<section>${index}:${'x'.repeat(64 * 1024)}</section>`),
    );
    const stream = await render(
      () => html`<main>${views.map((view) => suspense(view, () => html`<p>WAITING</p>`))}</main>`,
      { serializeResources: false },
    );
    const reader = stream.getReader();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(views.filter((view) => view.mock.calls.length > 0)).toHaveLength(0);
      const shell = await reader.read();
      expect(new TextDecoder().decode(shell.value)).toContain('WAITING');
      await vi.advanceTimersByTimeAsync(0);
      expect(views[0]).toHaveBeenCalledTimes(1);
      expect(views.slice(1).every((view) => view.mock.calls.length === 0)).toBe(true);
      const body = await readAll(reader);
      for (let id = 1; id <= views.length; id++) {
        expect(body).toContain(`__purity_swap(${id});`);
        if (id > 1)
          expect(body.indexOf(`__purity_swap(${id - 1});`)).toBeLessThan(
            body.indexOf(`__purity_swap(${id});`),
          );
      }
      expect(views.every((view) => view.mock.calls.length === 1)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it('detaches request forwarding when canceled at a full shell queue', async () => {
    const request = new Request('https://example.test/');
    const added = vi.spyOn(request.signal, 'addEventListener');
    const removed = vi.spyOn(request.signal, 'removeEventListener');
    const view = vi.fn(() => html`<p>UNEXPECTED</p>`);
    const stream = await render(() => suspense(view, () => html`<p>WAITING</p>`), { request });
    await vi.advanceTimersByTimeAsync(0);
    await stream.cancel(new Error('consumer left'));
    await vi.advanceTimersByTimeAsync(0);
    expect(view).not.toHaveBeenCalled();
    expect(removed.mock.calls).toHaveLength(added.mock.calls.length);
    expect(request.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a paused Node destination back to deferred rendering', async () => {
    const views = Array.from({ length: 64 }, () =>
      vi.fn(() => html`<section>${'x'.repeat(64 * 1024)}</section>`),
    );
    const stream = await render(
      () => html`<main>${views.map((view) => suspense(view, () => html`<p>WAITING</p>`))}</main>`,
    );
    let release: (() => void) | undefined;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let paused = true;
    const sink = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        if (paused) {
          paused = false;
          release = callback;
          entered();
        } else callback();
      },
    });
    const done = pipeline(Readable.fromWeb(stream), sink);
    try {
      await started;
      await vi.advanceTimersByTimeAsync(0);
      // Node can prefetch beyond the renderer's one-chunk queue, but a
      // blocked destination must not cause all 64 boundaries to render.
      expect(views.filter((view) => view.mock.calls.length > 0).length).toBeLessThanOrEqual(2);
      release?.();
      release = undefined;
      await done;
      expect(views.every((view) => view.mock.calls.length === 1)).toBe(true);
    } finally {
      release?.();
      sink.destroy();
      await done.catch(() => {});
    }
  });

  it('forwards external abort while paused and does not start queued views', async () => {
    const abort = new AbortController();
    const added = vi.spyOn(abort.signal, 'addEventListener');
    const removed = vi.spyOn(abort.signal, 'removeEventListener');
    const view = vi.fn(() => html`<p>UNEXPECTED</p>`);
    const stream = await render(() => suspense(view, () => html`<p>WAITING</p>`), {
      signal: abort.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    abort.abort(new Error('request left'));
    const reader = stream.getReader();
    try {
      const body = await readAll(reader);
      expect(body).toContain('WAITING');
      expect(body).not.toContain('UNEXPECTED');
      expect(view).not.toHaveBeenCalled();
      expect(removed.mock.calls).toHaveLength(added.mock.calls.length);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it('keeps the original boundary deadline while waiting for consumer demand', async () => {
    const view = vi.fn(() => html`<p>TOO LATE</p>`);
    const onError = vi.fn();
    const stream = await render(() =>
      suspense(view, () => html`<p>EXPIRED</p>`, { timeout: 20, onError }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(view).not.toHaveBeenCalled();
    const reader = stream.getReader();
    try {
      const body = await readAll(reader);
      expect(body).toContain('EXPIRED');
      expect(body).not.toContain('TOO LATE');
      expect(view).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledExactlyOnceWith(undefined, {
        boundaryId: 1,
        phase: 'timeout',
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it('cancels an active fetcher with the exact consumer reason and clears its timer', async () => {
    const request = new Request('https://example.test/');
    let fetchSignal: AbortSignal | undefined;
    const stream = await render(
      () =>
        suspense(
          () => {
            const value = resource(({ signal }) => {
              fetchSignal = signal;
              return new Promise(() => {});
            });
            return html`<p>${() => value()}</p>`;
          },
          () => html`<p>WAITING</p>`,
        ),
      { request, timeout: 30_000 },
    );
    const reader = stream.getReader();
    try {
      await reader.read();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchSignal?.aborted).toBe(false);
      const reason = new Error('consumer left');
      await reader.cancel(reason);
      expect(fetchSignal?.aborted).toBe(true);
      expect(fetchSignal?.reason).toBe(reason);
      expect(request.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it.each(['shell', 'boundary'])(
    'preserves Unicode when a large %s spans transport chunks',
    async (part) => {
      const expected = html`<p>${'中文🧪'.repeat(40_000)}</p>`;
      const stream = await render(
        () =>
          part === 'shell'
            ? expected
            : suspense(
                () => expected,
                () => html`<p>WAITING</p>`,
              ),
        { serializeResources: false, nonce: 'test-nonce' },
      );
      const reader = stream.getReader();
      try {
        const body = await readAll(reader);
        expect(body).toContain(expected.__purity_ssr_html__);
        expect(body).not.toContain('\uFFFD');
        if (part === 'boundary') {
          expect(body).toContain('<template id="purity-s-1">');
          expect(body).toContain('<script nonce="test-nonce">__purity_swap(1);</script>');
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    },
  );
});

it('can cancel a direct stream before its first automatic pull', async () => {
  const view = vi.fn(() => html`<p>UNEXPECTED</p>`);
  const request = new Request('https://example.test/');
  const added = vi.spyOn(request.signal, 'addEventListener');
  const removed = vi.spyOn(request.signal, 'removeEventListener');
  try {
    const stream = renderToStream(view, { request });
    await stream.cancel();
    expect(view).not.toHaveBeenCalled();
    expect(removed.mock.calls).toHaveLength(added.mock.calls.length);
  } finally {
    vi.restoreAllMocks();
  }
});

it.each(['request', 'explicit'] as const)(
  'can abort a direct stream via %s before its first pull',
  async (source) => {
    const requestAbort = new AbortController();
    const explicit = new AbortController();
    const request = new Request('https://example.test/', { signal: requestAbort.signal });
    const view = vi.fn(() => html`<p>UNEXPECTED</p>`);
    const stream = renderToStream(view, { request, signal: explicit.signal });
    (source === 'request' ? requestAbort : explicit).abort(new Error('connection ended'));
    expect(await new Response(stream).text()).toBe('');
    expect(view).not.toHaveBeenCalled();
  },
);
