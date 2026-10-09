// Pins the exact SSRRenderContext field shape at each of the three distinct
// construction sites (renderToString's render loop, renderToStream's shell
// render, and renderToStream's per-suspense-boundary render) BEFORE any
// attempt to consolidate their construction. These three contexts are
// genuinely different shapes, not copy-paste accidents — this file exists
// so a future refactor that shares their common fields can be verified not
// to leak streaming-only fields into the string/boundary paths or vice
// versa, since a field present where it shouldn't be (or absent where it's
// needed) is exactly the kind of bug that wouldn't show up as a type error,
// only as a subtle runtime behavior change deep in suspense/streaming logic.

import { getSSRRenderContext, resource, suspense } from '@purityjs/core';
import { describe, expect, it } from 'vite-plus/test';
import { html as ssrHtml, renderToStream, renderToString } from '../src/index.ts';

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function slowResource<T>(value: T, delayMs: number) {
  return resource(() => new Promise<T>((r) => setTimeout(() => r(value), delayMs)), {
    initialValue: undefined,
  });
}

describe('SSRRenderContext shape — renderToString', () => {
  it('has head/boundaryAborts but no streaming-only or per-boundary fields', async () => {
    let captured: ReturnType<typeof getSSRRenderContext> = null;
    await renderToString(() => {
      captured = getSSRRenderContext();
      return ssrHtml`<p>x</p>`;
    });
    expect(captured).not.toBeNull();
    expect(captured!.head).toEqual([]);
    expect(captured!.boundaryAborts).toBeDefined();
    expect(captured!.streamingMode).toBeUndefined();
    expect(captured!.streamingBoundaries).toBeUndefined();
    expect(captured!.boundaryPath).toBeUndefined();
    expect(captured!.boundaryIdStack).toBeUndefined();
  });
});

describe('SSRRenderContext shape — renderToStream shell (top-level, outside any boundary)', () => {
  it('has streamingMode/streamingBoundaries/head but no boundaryAborts or per-boundary fields', async () => {
    let captured: ReturnType<typeof getSSRRenderContext> = null;
    await streamToString(
      renderToStream(() => {
        captured = getSSRRenderContext();
        return ssrHtml`<p>x</p>`;
      }),
    );
    expect(captured).not.toBeNull();
    expect(captured!.streamingMode).toBe(true);
    expect(captured!.streamingBoundaries).toBeDefined();
    expect(captured!.head).toEqual([]);
    expect(captured!.boundaryAborts).toBeUndefined();
    expect(captured!.boundaryPath).toBeUndefined();
    expect(captured!.boundaryIdStack).toBeUndefined();
  });
});

describe('SSRRenderContext shape — renderToStream suspense boundary (view render)', () => {
  it('has boundaryAborts/boundaryPath/boundaryIdStack but no streaming-shell or head fields', async () => {
    let captured: ReturnType<typeof getSSRRenderContext> = null;
    const stream = renderToStream(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            captured = getSSRRenderContext();
            const r = slowResource('x', 5);
            return ssrHtml`<p>${() => r()}</p>`;
          },
          () => ssrHtml`<p>loading</p>`,
        )}</main>`,
    );
    await streamToString(stream);
    expect(captured).not.toBeNull();
    expect(captured!.boundaryAborts).toBeDefined();
    expect(captured!.boundaryPath).toMatch(/^stream:\d+\/(view|fallback)$/);
    expect(captured!.boundaryIdStack).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(captured!.streamingMode).toBeUndefined();
    expect(captured!.streamingBoundaries).toBeUndefined();
    expect(captured!.head).toBeUndefined();
  });
});
