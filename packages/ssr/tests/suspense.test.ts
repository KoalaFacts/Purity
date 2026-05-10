// @vitest-environment jsdom
// Tests for `suspense(view, fallback)` — Phase 1 of ADR 0006.
//
// Phase 1 ships:
//   * synchronous error isolation in `view()` (catches → renders fallback)
//   * `<!--s:N--><!--/s:N-->` boundary markers in SSR output
//   * marker-stripping in the hydrate inflate path so the boundary is
//     transparent to the inner template's structural walk
//   * per-render `suspenseCounter` reset on each renderToString pass

import { html as clientHtml, hydrate, resource, state, suspense } from '@purityjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { html as ssrHtml, renderToString } from '../src/index.ts';

type AnyHtml = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

describe('suspense() — SSR error isolation + boundary markers', () => {
  it('emits <!--s:N--><!--/s:N--> markers around the rendered view', async () => {
    const out = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => ssrHtml`<aside>resolved</aside>`,
          () => ssrHtml`<aside>fallback</aside>`,
        )}</main>`,
    );
    expect(out).toContain('<!--s:1-->');
    expect(out).toContain('<aside>resolved</aside>');
    expect(out).toContain('<!--/s:1-->');
    expect(out).not.toContain('<aside>fallback</aside>');
  });

  it('renders fallback when view throws synchronously', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            throw new Error('boom');
          },
          () => ssrHtml`<aside>fallback</aside>`,
        )}</main>`,
    );
    expect(out).toContain('<!--s:1-->');
    expect(out).toContain('<aside>fallback</aside>');
    expect(out).toContain('<!--/s:1-->');
    expect(errSpy).toHaveBeenCalled();
    const msg = String(errSpy.mock.calls[0][0]);
    expect(msg).toContain('suspense() view threw');
    errSpy.mockRestore();
  });

  it('emits an empty boundary when both view and fallback throw', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            throw new Error('view boom');
          },
          () => {
            throw new Error('fallback boom');
          },
        )}</main>`,
    );
    expect(out).toContain('<!--s:1--><!--/s:1-->');
    // Both errors logged.
    expect(errSpy).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  it('allocates monotonically increasing IDs across multiple boundaries', async () => {
    const out = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => ssrHtml`<a>A</a>`,
          () => ssrHtml`<a>fa</a>`,
        )}${suspense(
          () => ssrHtml`<b>B</b>`,
          () => ssrHtml`<b>fb</b>`,
        )}</main>`,
    );
    expect(out).toContain('<!--s:1-->');
    expect(out).toContain('<!--/s:1-->');
    expect(out).toContain('<!--s:2-->');
    expect(out).toContain('<!--/s:2-->');
  });

  it('handles nested boundaries (inner counter increments before outer body emits)', async () => {
    const out = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () =>
            ssrHtml`<section>${suspense(
              () => ssrHtml`<p>inner</p>`,
              () => ssrHtml`<p>fb</p>`,
            )}</section>`,
          () => ssrHtml`<aside>outer-fb</aside>`,
        )}</main>`,
    );
    // Both boundaries emitted with distinct IDs; inner content survives.
    expect(out).toMatch(/<!--s:\d+-->/);
    expect(out).toContain('<p>inner</p>');
    // Two opens, two closes.
    expect(out.match(/<!--s:\d+-->/g)?.length).toBe(2);
    expect(out.match(/<!--\/s:\d+-->/g)?.length).toBe(2);
  });

  it('invokes onError(error, { phase: "view" }) when view throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reports: Array<{ error: unknown; phase: string; boundaryId: number }> = [];
    await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            throw new Error('view boom');
          },
          () => ssrHtml`<aside>fb</aside>`,
          {
            onError: (error, info) => {
              reports.push({ error, phase: info.phase, boundaryId: info.boundaryId });
            },
          },
        )}</main>`,
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].phase).toBe('view');
    expect(reports[0].boundaryId).toBe(1);
    expect((reports[0].error as Error).message).toBe('view boom');
    errSpy.mockRestore();
  });

  it('invokes onError twice when both view and fallback throw (phases: view, fallback)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const phases: string[] = [];
    await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            throw new Error('v');
          },
          () => {
            throw new Error('f');
          },
          {
            onError: (_err, info) => {
              phases.push(info.phase);
            },
          },
        )}</main>`,
    );
    expect(phases).toEqual(['view', 'fallback']);
    errSpy.mockRestore();
  });

  it('invokes onError(undefined, { phase: "timeout" }) when boundary deadline fires', async () => {
    const reports: Array<{ phase: string; boundaryId: number }> = [];
    await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = resource(
              () => new Promise((resolve) => setTimeout(() => resolve('slow'), 200)),
              { key: 'slow' },
            );
            return ssrHtml`<aside>${() => r() ?? '...'}</aside>`;
          },
          () => ssrHtml`<aside>fb</aside>`,
          {
            timeout: 30,
            onError: (_err, info) => {
              reports.push({ phase: info.phase, boundaryId: info.boundaryId });
            },
          },
        )}</main>`,
    );
    expect(reports.some((r) => r.phase === 'timeout')).toBe(true);
  });

  it('survives an onError hook that throws (logs but does not propagate)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            throw new Error('view boom');
          },
          () => ssrHtml`<aside>fb</aside>`,
          {
            onError: () => {
              throw new Error('hook boom');
            },
          },
        )}</main>`,
    );
    expect(out).toContain('<aside>fb</aside>');
    // Two errors: the original view error + the hook's own error.
    const messages = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(messages).toContain('onError hook threw');
    errSpy.mockRestore();
  });

  it('resets the suspenseCounter between separate renderToString calls', async () => {
    const view = () =>
      ssrHtml`${suspense(
        () => ssrHtml`<x>x</x>`,
        () => ssrHtml`<x>fb</x>`,
      )}`;
    const a = await renderToString(view);
    const b = await renderToString(view);
    // Same first ID in both — counter is per-render, not module-global.
    expect(a).toContain('<!--s:1-->');
    expect(b).toContain('<!--s:1-->');
  });
});

describe('suspense() — client + hydration', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it('renders view() directly outside SSR (fallback unused)', () => {
    const root = suspense(
      () => clientHtml`<aside>view</aside>`,
      () => clientHtml`<aside>fb</aside>`,
    ) as Node;
    host.appendChild(root);
    expect(host.textContent).toBe('view');
  });

  it('hydrates an SSR-rendered boundary, preserving DOM identity', async () => {
    const ssr = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => ssrHtml`<aside>${'hello'}</aside>`,
          () => ssrHtml`<aside>fb</aside>`,
        )}</main>`,
    );
    host.innerHTML = ssr;
    const ssrAside = host.querySelector('aside');
    expect(ssrAside?.textContent).toBe('hello');

    const text = state('hello');
    hydrate(
      host,
      () =>
        (clientHtml as AnyHtml)`<main>${suspense(
          () => (clientHtml as AnyHtml)`<aside>${() => text()}</aside>`,
          () => (clientHtml as AnyHtml)`<aside>fb</aside>`,
        )}</main>` as Node,
    );

    // Identity preserved across the boundary's marker pair.
    expect(host.querySelector('aside')).toBe(ssrAside);
    expect(host.textContent).toBe('hello');

    // Reactivity wired against the SSR-existing text node.
    text('world');
    await Promise.resolve();
    expect(host.textContent).toBe('world');
  });

  it('renders fallback when the boundary deadline fires (Phase 2)', async () => {
    // A slow resource (200ms) inside a boundary with a 30ms timeout.
    // The boundary should give up after 30ms and emit the fallback.
    // The outer renderToString continues without hanging on the slow promise.
    const out = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = resource(
              () => new Promise((resolve) => setTimeout(() => resolve('slow'), 200)),
            );
            return ssrHtml`<aside>${() => r() ?? '...'}</aside>`;
          },
          () => ssrHtml`<aside class="loading">loading</aside>`,
          { timeout: 30 },
        )}</main>`,
    );
    expect(out).toContain('<!--s:1-->');
    expect(out).toContain('<aside class="loading">loading</aside>');
    expect(out).not.toContain('<aside><!--[-->slow<!--]--></aside>');
    expect(out).toContain('<!--/s:1-->');
  });

  it('renders the view normally when the boundary resolves before its deadline', async () => {
    // 50ms resource with a 1000ms deadline — view should win.
    const out = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = resource(
              () => new Promise((resolve) => setTimeout(() => resolve('fast'), 10)),
            );
            return ssrHtml`<aside>${() => r() ?? '...'}</aside>`;
          },
          () => ssrHtml`<aside>fb</aside>`,
          { timeout: 1000 },
        )}</main>`,
    );
    expect(out).toContain('<aside><!--[-->fast<!--]--></aside>');
    expect(out).not.toContain('<aside>fb</aside>');
  });

  it('isolates timeouts per boundary — fast neighbor still resolves', async () => {
    // Use keyed resources so a timed-out neighbor's skipped view() can't
    // shift creation-order indices for the surviving boundary's resource.
    const out = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () => {
            const slow = resource(
              () => new Promise((resolve) => setTimeout(() => resolve('slow'), 200)),
              { key: 'slow' },
            );
            return ssrHtml`<aside>${() => slow() ?? '...'}</aside>`;
          },
          () => ssrHtml`<aside class="loading">SLOW-FB</aside>`,
          { timeout: 30 },
        )}${suspense(
          () => {
            const fast = resource(
              () => new Promise((resolve) => setTimeout(() => resolve('fast'), 10)),
              { key: 'fast' },
            );
            return ssrHtml`<aside>${() => fast() ?? '...'}</aside>`;
          },
          () => ssrHtml`<aside>FAST-FB</aside>`,
          { timeout: 1000 },
        )}</main>`,
    );
    // First boundary: fallback. Second boundary: view.
    expect(out).toContain('<aside class="loading">SLOW-FB</aside>');
    expect(out).toContain('<aside><!--[-->fast<!--]--></aside>');
  });

  it('hydrates nested suspense boundaries with marker stripping at each level', async () => {
    const ssr = await renderToString(
      () =>
        ssrHtml`<main>${suspense(
          () =>
            ssrHtml`<section>${suspense(
              () => ssrHtml`<p>${'inner'}</p>`,
              () => ssrHtml`<p>fb</p>`,
            )}</section>`,
          () => ssrHtml`<aside>fb</aside>`,
        )}</main>`,
    );
    host.innerHTML = ssr;
    const ssrSection = host.querySelector('section');
    const ssrP = host.querySelector('p');
    expect(ssrP?.textContent).toBe('inner');

    const text = state('inner');
    hydrate(
      host,
      () =>
        (clientHtml as AnyHtml)`<main>${suspense(
          () =>
            (clientHtml as AnyHtml)`<section>${suspense(
              () => (clientHtml as AnyHtml)`<p>${() => text()}</p>`,
              () => (clientHtml as AnyHtml)`<p>fb</p>`,
            )}</section>`,
          () => (clientHtml as AnyHtml)`<aside>fb</aside>`,
        )}</main>` as Node,
    );

    expect(host.querySelector('section')).toBe(ssrSection);
    expect(host.querySelector('p')).toBe(ssrP);
    expect(host.textContent).toBe('inner');

    text('updated');
    await Promise.resolve();
    expect(host.textContent).toBe('updated');
  });
});
