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

// Covers both failure modes a plain `.toBeUndefined()` or a lone
// `Object.hasOwn` check would each individually miss: `Object.hasOwn`
// catches an own key present with value `undefined` (a future shared
// context factory spreading in e.g. `streamingMode: undefined`); the plain
// property read catches a field INHERITED via the prototype chain (a
// factory that places defaults on a shared prototype) — consumers like
// `suspense()` read these fields through ordinary property lookup, which
// walks the prototype chain, so an inherited leak is just as real a bug as
// an own one, and `Object.hasOwn` alone can't see it.
function assertFieldAbsent(obj: object, field: string): void {
  expect(Object.hasOwn(obj, field)).toBe(false);
  expect((obj as Record<string, unknown>)[field]).toBeUndefined();
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
    assertFieldAbsent(captured!, 'streamingMode');
    assertFieldAbsent(captured!, 'streamingBoundaries');
    assertFieldAbsent(captured!, 'boundaryPath');
    assertFieldAbsent(captured!, 'boundaryIdStack');
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
    assertFieldAbsent(captured!, 'boundaryAborts');
    assertFieldAbsent(captured!, 'boundaryPath');
    assertFieldAbsent(captured!, 'boundaryIdStack');
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
    assertFieldAbsent(captured!, 'streamingMode');
    assertFieldAbsent(captured!, 'streamingBoundaries');
    assertFieldAbsent(captured!, 'head');
  });
});
