// Independent boundary progress — ADR 0062 (SV2-009 slice 1).
//
// `boundaryConcurrency: n` lets up to n deferred suspense() views render at
// once and flushes each chunk as soon as it settles. The default (1) keeps
// ADR 0006's declaration-order stream exactly.

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

function delayed(value: string, ms: number) {
  return resource(() => new Promise<string>((resolve) => setTimeout(() => resolve(value), ms)), {
    key: value,
  });
}

function region(label: string, ms: number) {
  return suspense(
    () => {
      const r = delayed(label, ms);
      return html`<p>${() => r()}</p>`;
    },
    () => html`<p>WAIT-${label}</p>`,
  );
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

describe.each(renderers)('renderToStream boundaryConcurrency — $name', ({ render }) => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flushes a fast later sibling before a blocked first sibling', async () => {
    const stream = await render(
      () => html`<main>${region('SLOW', 500)}${region('FAST', 10)}</main>`,
      {
        boundaryConcurrency: 2,
      },
    );
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const shell = decoder.decode((await reader.read()).value);
    expect(shell).toContain('<!--s:1-->');
    expect(shell).toContain('<!--s:2-->');
    expect(shell).not.toContain('<template id="purity-s-');
    const next = reader.read();
    await vi.advanceTimersByTimeAsync(20);
    const fast = decoder.decode((await next).value);
    // The second boundary is ready while the first is still pending.
    expect(fast).toContain('<template id="purity-s-2">');
    expect(fast).toContain('FAST');
    expect(fast).not.toContain('purity-s-1');
    const rest = reader.read();
    await vi.advanceTimersByTimeAsync(500);
    const slow = decoder.decode((await rest).value);
    expect(slow).toContain('<template id="purity-s-1">');
    expect(slow).toContain('__purity_swap(1);');
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps declaration order by default', async () => {
    const stream = await render(
      () => html`<main>${region('SLOW', 500)}${region('FAST', 10)}</main>`,
    );
    const done = readAll(stream);
    await vi.advanceTimersByTimeAsync(600);
    const body = await done;
    expect(body.indexOf('__purity_swap(1);')).toBeGreaterThan(0);
    expect(body.indexOf('__purity_swap(1);')).toBeLessThan(body.indexOf('__purity_swap(2);'));
  });

  it('starts at most n views while the consumer is paused', async () => {
    const views = Array.from({ length: 16 }, (_, index) =>
      vi.fn(() => html`<section>${index}:${'x'.repeat(64 * 1024)}</section>`),
    );
    const stream = await render(
      () => html`<main>${views.map((view) => suspense(view, () => html`<p>WAITING</p>`))}</main>`,
      { boundaryConcurrency: 3, serializeResources: false },
    );
    const reader = stream.getReader();
    try {
      await reader.read();
      await vi.advanceTimersByTimeAsync(0);
      // Exactly n views run ahead of the paused consumer: more than one, no more than n.
      expect(views.filter((view) => view.mock.calls.length > 0)).toHaveLength(3);
      const decoder = new TextDecoder();
      let body = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
      }
      for (let id = 1; id <= views.length; id++) expect(body).toContain(`__purity_swap(${id});`);
      expect(views.every((view) => view.mock.calls.length === 1)).toBe(true);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it('a throwing or timed-out sibling does not hold back a ready one', async () => {
    const onError = vi.fn();
    const stream = await render(
      () =>
        html`<main>${suspense(
          () => {
            const r = delayed('NEVER', 10_000);
            return html`<p>${() => r()}</p>`;
          },
          () => html`<p>LATE-FALLBACK</p>`,
          { timeout: 50, onError },
        )}${suspense(
          () => {
            throw new Error('boom');
          },
          () => html`<p>THROWN-FALLBACK</p>`,
        )}${region('OK', 5)}</main>`,
      { boundaryConcurrency: 3 },
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const done = readAll(stream);
    await vi.advanceTimersByTimeAsync(100);
    const body = await done;
    // Thrown view (2) and ready view (3) arrive before the timed-out view (1).
    const ok = body.indexOf('__purity_swap(3);');
    const thrown = body.indexOf('__purity_swap(2);');
    const late = body.indexOf('__purity_swap(1);');
    expect(ok).toBeGreaterThan(0);
    expect(thrown).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(Math.max(ok, thrown));
    expect(body).toContain('LATE-FALLBACK');
    expect(body).not.toContain('NEVER<');
    expect(onError).toHaveBeenCalledWith(undefined, { boundaryId: 1, phase: 'timeout' });
    // Only the abandoned fetcher's own setTimeout is left; it settles harmlessly.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancelling drops every in-flight view and clears their timers', async () => {
    const stream = await render(
      () => html`<main>${region('A', 1000)}${region('B', 1000)}${region('C', 1000)}</main>`,
      { boundaryConcurrency: 3 },
    );
    const reader = stream.getReader();
    const shell = new TextDecoder().decode((await reader.read()).value);
    expect(shell).toContain('<!--s:3-->');
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(10);
    await reader.cancel(new Error('consumer left'));
    expect((await pending).done).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('external abort ends the stream without the pending chunks', async () => {
    const abort = new AbortController();
    const stream = await render(() => html`<main>${region('A', 1000)}${region('B', 1000)}</main>`, {
      boundaryConcurrency: 2,
      signal: abort.signal,
    });
    const done = readAll(stream);
    await vi.advanceTimersByTimeAsync(10);
    abort.abort(new Error('request left'));
    const body = await done;
    expect(body).toContain('<!--s:2-->');
    expect(body).not.toContain('purity-s-1');
    expect(body).not.toContain('purity-s-2');
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('renderToStream boundaryConcurrency validation', () => {
  it.each([0, -1, 1.5, Number.NaN, '2'])('rejects %s', async (value) => {
    expect(() =>
      renderToStream(() => html`<p>x</p>`, {
        boundaryConcurrency: value as unknown as number,
      }),
    ).toThrow(/boundaryConcurrency/);
    await expect(
      renderToStreamResponse(() => html`<p>x</p>`, {
        boundaryConcurrency: value as unknown as number,
      }),
    ).rejects.toThrow(/boundaryConcurrency/);
  });

  it('accepts Infinity and starts every view', async () => {
    const views = Array.from({ length: 5 }, (_, index) => vi.fn(() => html`<p>v${index}</p>`));
    const body = await readAll(
      renderToStream(
        () => html`<main>${views.map((view) => suspense(view, () => html`<p>w</p>`))}</main>`,
        { boundaryConcurrency: Number.POSITIVE_INFINITY },
      ),
    );
    for (let id = 1; id <= views.length; id++) expect(body).toContain(`__purity_swap(${id});`);
    expect(views.every((view) => view.mock.calls.length === 1)).toBe(true);
  });
});
