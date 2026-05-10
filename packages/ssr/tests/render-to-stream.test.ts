// @vitest-environment jsdom
// Tests for `renderToStream` — ADR 0006 Phase 3.
//
// Validates the streaming wire format: shell flush with fallbacks, inline
// `__purity_swap` helper, per-boundary `<template>` + swap chunks, and
// end-to-end behavior when the swap script is actually executed against a
// jsdom document.

import { resource, suspense } from '@purityjs/core';
import { describe, expect, it, vi } from 'vitest';
import { html as ssrHtml, renderToStream } from '../src/index.ts';

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

async function streamToChunks(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  const tail = decoder.decode();
  if (tail) chunks.push(tail);
  return chunks;
}

function fastResource<T>(value: T) {
  return resource(() => Promise.resolve(value), { initialValue: undefined });
}

function slowResource<T>(value: T, delayMs: number) {
  return resource(() => new Promise<T>((r) => setTimeout(() => r(value), delayMs)), {
    initialValue: undefined,
  });
}

describe('renderToStream — wire format', () => {
  it('emits the shell with fallback inline + swap helper for each boundary', async () => {
    const stream = renderToStream(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = slowResource('LATE', 5);
            return ssrHtml`<aside>${() => r()}</aside>`;
          },
          () => ssrHtml`<aside class="loading">…</aside>`,
        )}</main>`,
    );
    const out = await streamToString(stream);

    // Shell: boundary marker around the FALLBACK, not the resolved view.
    expect(out).toContain('<!--s:1-->');
    expect(out).toContain('<aside class="loading">…</aside>');
    expect(out).toContain('<!--/s:1-->');
    // Swap helper inlined exactly once.
    expect(out.match(/window\.__purity_swap=function/g)?.length).toBe(1);
    // Per-boundary chunk: <template id="purity-s-1">resolved</template> + call.
    // The reactive `${() => r()}` slot wraps the value in `<!--[-->...<!--]-->`
    // expression markers (standard SSR output), so the resolved aside contains
    // those marker pairs around the value.
    expect(out).toContain('<template id="purity-s-1"><aside><!--[-->LATE<!--]--></aside>');
    expect(out).toContain('__purity_swap(1)');
  });

  it('flushes the shell before slow boundaries resolve (chunked output)', async () => {
    // 50ms resource — long enough that the shell chunk arrives well before
    // the boundary chunk in the same stream.
    const stream = renderToStream(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = slowResource('LATE', 50);
            return ssrHtml`<aside>${() => r()}</aside>`;
          },
          () => ssrHtml`<aside class="loading">…</aside>`,
        )}</main>`,
    );
    const chunks = await streamToChunks(stream);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk has the shell + fallback; doesn't yet have the resolved
    // <aside>LATE</aside>.
    expect(chunks[0]).toContain('<aside class="loading">…</aside>');
    expect(chunks[0]).not.toContain('LATE');
    // A later chunk has the boundary template + swap call.
    const tail = chunks.slice(1).join('');
    expect(tail).toContain('<template id="purity-s-1">');
    expect(tail).toContain('LATE');
    expect(tail).toContain('__purity_swap(1)');
  });

  it('streams multiple boundaries in source-declaration order', async () => {
    const stream = renderToStream(
      () => ssrHtml`<main>
        ${suspense(
          () => {
            const r = slowResource('A', 2);
            return ssrHtml`<p>${() => r()}</p>`;
          },
          () => ssrHtml`<p class="lA">…</p>`,
        )}
        ${suspense(
          () => {
            const r = slowResource('B', 2);
            return ssrHtml`<p>${() => r()}</p>`;
          },
          () => ssrHtml`<p class="lB">…</p>`,
        )}
      </main>`,
    );
    const out = await streamToString(stream);
    const idxA = out.indexOf('<template id="purity-s-1">');
    const idxB = out.indexOf('<template id="purity-s-2">');
    expect(idxA).toBeGreaterThan(0);
    expect(idxB).toBeGreaterThan(idxA);
    // Same caveat as above — the reactive `${() => r()}` slot wraps the
    // resolved value in `<!--[-->...<!--]-->`.
    expect(out).toContain('<p><!--[-->A<!--]--></p>');
    expect(out).toContain('<p><!--[-->B<!--]--></p>');
  });

  it('emits the doctype prefix exactly once at the start of the shell', async () => {
    const stream = renderToStream(() => ssrHtml`<html><body><h1>x</h1></body></html>`, {
      doctype: '<!doctype html>',
    });
    const out = await streamToString(stream);
    expect(out.indexOf('<!doctype html>')).toBe(0);
  });

  it('omits the swap helper when there are no streamed boundaries', async () => {
    const stream = renderToStream(() => ssrHtml`<h1>plain</h1>`);
    const out = await streamToString(stream);
    expect(out).not.toContain('window.__purity_swap=function');
    expect(out).not.toContain('<template id="purity-s-');
    expect(out).toContain('<h1>plain</h1>');
  });

  it('inlines the resource cache prime when shell-level resources resolved', async () => {
    const stream = renderToStream(() => {
      const r = fastResource(42);
      return ssrHtml`<p>${() => r()}</p>`;
    });
    const out = await streamToString(stream);
    expect(out).toContain('<script type="application/json" id="__purity_resources__">');
    expect(out).toContain('42');
  });

  it('applies the CSP nonce to every inline <script> we emit', async () => {
    const stream = renderToStream(
      () => {
        const seed = fastResource('seed');
        return ssrHtml`<main>
          <p>${() => seed()}</p>
          ${suspense(
            () => {
              const r = slowResource('LATE', 2);
              return ssrHtml`<aside>${() => r()}</aside>`;
            },
            () => ssrHtml`<aside class="l">…</aside>`,
          )}
        </main>`;
      },
      { nonce: 'abc123' },
    );
    const out = await streamToString(stream);
    // Resources script, swap helper script, per-boundary swap script all
    // carry the nonce. Attribute order varies per emission site — the
    // resources script puts nonce after id; the swap scripts have only the
    // nonce attr — so we match the nonce attr separately from the script
    // body / id.
    expect(out).toMatch(/<script\s+nonce="abc123">window\.__purity_swap/);
    expect(out).toMatch(/<script\s+nonce="abc123">__purity_swap\(1\)/);
    expect(out).toMatch(
      /<script\s+type="application\/json"\s+id="__purity_resources__"\s+nonce="abc123"/,
    );
  });

  it('rejects malformed CSP nonces', () => {
    expect(() => renderToStream(() => ssrHtml`<p>x</p>`, { nonce: 'bad nonce!' })).toThrow(
      /invalid CSP nonce/,
    );
  });

  it('falls back to per-boundary fallback HTML when the boundary times out', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stream = renderToStream(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = slowResource('NEVER', 200);
            return ssrHtml`<aside>${() => r()}</aside>`;
          },
          () => ssrHtml`<aside class="lf">slow</aside>`,
        )}</main>`,
      { timeout: 30 },
    );
    const out = await streamToString(stream);
    // Shell still has the original fallback markup.
    expect(out).toContain('<aside class="lf">slow</aside>');
    // Boundary chunk emits the same fallback (or empty) — never NEVER.
    expect(out).not.toContain('NEVER');
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// End-to-end: parse the streamed HTML into jsdom, execute the inline scripts,
// assert the swap actually replaces the fallback DOM with the resolved view.
// ---------------------------------------------------------------------------

describe('renderToStream — runtime swap behavior', () => {
  it("__purity_swap(N) replaces the fallback nodes with the boundary's template content", async () => {
    const stream = renderToStream(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = slowResource('SWAPPED', 2);
            return ssrHtml`<aside>${() => r()}</aside>`;
          },
          () => ssrHtml`<aside class="loading">…</aside>`,
        )}</main>`,
    );
    const out = await streamToString(stream);

    // Parse + execute. document.body.innerHTML doesn't run inline scripts;
    // we use document.write into an iframe-style flow via a fresh document
    // so the inline scripts execute as the parser sees them.
    const doc = document.implementation.createHTMLDocument('test');
    doc.body.innerHTML = out;
    // jsdom's innerHTML doesn't execute scripts, so manually run the body
    // scripts in document order. Both the swap helper and the per-boundary
    // call need the swap helper installed on `window` — wire jsdom's
    // window for the eval'd source.
    const scripts = Array.from(doc.body.querySelectorAll('script'));
    for (const s of scripts) {
      // The swap helper writes to `window.__purity_swap`; the per-boundary
      // call invokes it. Eval against jsdom's globals so document and
      // document.body resolve correctly.
      // biome-ignore lint/security/noGlobalEval: test-only execution of generated SSR scripts
      new Function('document', 'window', s.textContent || '')(doc, doc.defaultView ?? globalThis);
    }

    // Fallback gone; resolved aside in its place.
    expect(doc.body.querySelector('aside.loading')).toBeNull();
    const resolved = doc.body.querySelector('aside');
    expect(resolved).not.toBeNull();
    expect(resolved!.textContent).toContain('SWAPPED');
    // The boundary markers are removed by the swap (it removes everything
    // between <!--s:1--> and <!--/s:1-->) — the markers themselves stay.
    // What matters: the resolved content replaced the fallback.
  });
});

// ---------------------------------------------------------------------------
// ADR 0006 Phase 6 second-half — per-boundary resource cache emit.
//
// Each streamed boundary chunk should carry its own resolved keyed-resource
// payload as `<script id="__purity_resources_N__">` so the client doesn't
// refetch inside the boundary on hydrate. Positional indices are dropped —
// only keyed resources get cross-boundary cache priming. ADR 0006.
// ---------------------------------------------------------------------------

describe('renderToStream — per-boundary resource cache', () => {
  it('emits <script id="__purity_resources_N__"> with keyed resources resolved inside the boundary', async () => {
    const stream = renderToStream(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = resource(() => Promise.resolve('LATE'), {
              initialValue: undefined,
              key: 'b1',
            });
            return ssrHtml`<aside>${() => r()}</aside>`;
          },
          () => ssrHtml`<aside>…</aside>`,
        )}</main>`,
    );
    const out = await streamToString(stream);

    // Per-boundary keyed cache emitted alongside the template.
    expect(out).toMatch(
      /<script type="application\/json" id="__purity_resources_1__">{"keyed":{"b1":"LATE"}}<\/script>/,
    );
    // Sanity: the swap script still follows the cache prime.
    expect(out).toMatch(/__purity_resources_1__[\s\S]*__purity_swap\(1\)/);
  });

  it('omits the per-boundary script when the boundary has no keyed resources', async () => {
    const stream = renderToStream(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            // No `key` option — positional only. Per-boundary script is skipped.
            const r = resource(() => Promise.resolve('LATE'), { initialValue: undefined });
            return ssrHtml`<aside>${() => r()}</aside>`;
          },
          () => ssrHtml`<aside>…</aside>`,
        )}</main>`,
    );
    const out = await streamToString(stream);
    expect(out).not.toContain('__purity_resources_1__');
  });

  it('emits one cache script per boundary, indexed by id', async () => {
    const stream = renderToStream(
      () => ssrHtml`<main>
        ${suspense(
          () => {
            const a = resource(() => Promise.resolve('A'), { initialValue: undefined, key: 'a' });
            return ssrHtml`<p>${() => a()}</p>`;
          },
          () => ssrHtml`<p>…</p>`,
        )}
        ${suspense(
          () => {
            const b = resource(() => Promise.resolve('B'), { initialValue: undefined, key: 'b' });
            return ssrHtml`<p>${() => b()}</p>`;
          },
          () => ssrHtml`<p>…</p>`,
        )}
      </main>`,
    );
    const out = await streamToString(stream);
    expect(out).toContain('id="__purity_resources_1__"');
    expect(out).toContain('"keyed":{"a":"A"}');
    expect(out).toContain('id="__purity_resources_2__"');
    expect(out).toContain('"keyed":{"b":"B"}');
  });

  it('applies CSP nonce to the per-boundary cache script too', async () => {
    const stream = renderToStream(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = resource(() => Promise.resolve('X'), { initialValue: undefined, key: 'k' });
            return ssrHtml`<aside>${() => r()}</aside>`;
          },
          () => ssrHtml`<aside>…</aside>`,
        )}</main>`,
      { nonce: 'abc123' },
    );
    const out = await streamToString(stream);
    expect(out).toMatch(
      /<script\s+type="application\/json"\s+id="__purity_resources_1__"\s+nonce="abc123">/,
    );
  });

  it('respects serializeResources: false by also dropping per-boundary caches', async () => {
    const stream = renderToStream(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = resource(() => Promise.resolve('X'), { initialValue: undefined, key: 'k' });
            return ssrHtml`<aside>${() => r()}</aside>`;
          },
          () => ssrHtml`<aside>…</aside>`,
        )}</main>`,
      { serializeResources: false },
    );
    const out = await streamToString(stream);
    expect(out).not.toContain('__purity_resources_');
  });
});
