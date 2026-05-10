// @vitest-environment jsdom
// Tests for `suspense(view, fallback)` — Phase 1 of ADR 0006.
//
// Phase 1 ships:
//   * synchronous error isolation in `view()` (catches → renders fallback)
//   * `<!--s:N--><!--/s:N-->` boundary markers in SSR output
//   * marker-stripping in the hydrate inflate path so the boundary is
//     transparent to the inner template's structural walk
//   * per-render `suspenseCounter` reset on each renderToString pass

import { html as clientHtml, hydrate, state, suspense } from '@purityjs/core';
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
