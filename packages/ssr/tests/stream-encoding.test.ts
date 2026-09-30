import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { html, renderToStream, renderToStreamResponse } from '../src/index.ts';

const chunkBytes = 64 * 1024;
const renderers = [
  {
    name: 'direct stream',
    render: async (view: () => unknown) => renderToStream(view, { serializeResources: false }),
  },
  {
    name: 'prepared stream',
    render: async (view: () => unknown) =>
      (await renderToStreamResponse(view, { serializeResources: false })).body,
  },
];

const samples = [
  { name: 'empty content', text: '' },
  { name: 'small Unicode content', text: '中文🧪' },
  { name: 'small-output fast path limit', text: '界'.repeat(Math.floor(chunkBytes / 3) - 29) },
  { name: 'above the fast path limit', text: '界'.repeat(Math.floor(chunkBytes / 3) - 28) },
  { name: 'large ASCII content', text: 'x'.repeat(2 * 1024 * 1024) },
  { name: 'large Chinese content', text: '中文'.repeat(40_000) },
  { name: 'large emoji content', text: '🧪🌏'.repeat(40_000) },
  // <main><!--[--> contributes fourteen UTF-16 units before these payloads.
  {
    name: 'surrogate pair across an input window',
    text: 'x'.repeat(chunkBytes - 15) + '🧪' + 'z'.repeat(chunkBytes),
  },
  {
    name: 'surrogate pair across destination capacity',
    text: '界'.repeat(Math.floor((chunkBytes - 14) / 3)) + '🧪' + 'z'.repeat(chunkBytes),
  },
  {
    name: 'lone surrogates and adjacent valid pairs',
    text: '\ud800x\udc00🧪\ud800🧪\udc00'.repeat(10_000),
  },
];

describe.each(renderers)('SSR incremental encoding — $name', ({ render }) => {
  afterEach(() => vi.restoreAllMocks());

  it.each(samples)('matches standard UTF-8 encoding for $name', async ({ text }) => {
    const source = `<main><!--[-->${text}<!--]--></main>`;
    const expected = new TextEncoder().encode(source);
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const encodeInto = vi.spyOn(TextEncoder.prototype, 'encodeInto');
    const stream = await render(() => html`<main>${text}</main>`);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        expect(value.byteLength).toBeGreaterThan(0);
        expect(value.buffer.byteLength).toBeLessThanOrEqual(chunkBytes);
        chunks.push(value);
      }
      expect(Buffer.compare(Buffer.concat(chunks), expected)).toBe(0);
      const encodedSizes = encode.mock.results.map((result) => result.value.byteLength);
      expect(Math.max(0, ...encodedSizes)).toBeLessThanOrEqual(chunkBytes);
      for (const [input, destination] of encodeInto.mock.calls) {
        expect(input.length).toBeLessThanOrEqual(chunkBytes);
        expect(destination.byteLength).toBeLessThanOrEqual(chunkBytes);
      }
      if (source.length <= Math.floor(chunkBytes / 3)) {
        expect(encode).toHaveBeenCalledTimes(1);
        expect(encodeInto).not.toHaveBeenCalled();
      } else {
        expect(encode).not.toHaveBeenCalled();
        expect(encodeInto).toHaveBeenCalledTimes(chunks.length);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it('keeps previously delivered buffers unchanged while encoding later chunks', async () => {
    const text = '中文🧪'.repeat(40_000);
    const stream = await render(() => html`<main>${text}</main>`);
    const reader = stream.getReader();
    try {
      const first = (await reader.read()).value!;
      const snapshot = first.slice();
      let chunks = 1;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        expect(value.buffer).not.toBe(first.buffer);
        chunks++;
      }
      expect(chunks).toBeGreaterThan(2);
      expect(first).toEqual(snapshot);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it('stops allocating encoding buffers when a large output is canceled', async () => {
    const encodeInto = vi.spyOn(TextEncoder.prototype, 'encodeInto');
    const stream = await render(() => html`<main>${'界'.repeat(1_000_000)}</main>`);
    const reader = stream.getReader();
    try {
      await reader.read();
      await reader.cancel(new Error('consumer left'));
      const count = encodeInto.mock.calls.length;
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(2);
      await Promise.resolve();
      expect(encodeInto).toHaveBeenCalledTimes(count);
      expect((await reader.read()).done).toBe(true);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });
});
