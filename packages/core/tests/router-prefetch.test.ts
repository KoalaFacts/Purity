// @vitest-environment jsdom
// ADR 0029 — prefetchManifestLinks() tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureNavigation, navigate, prefetchManifestLinks } from '../src/index.ts';

interface MockEntry {
  pattern: string;
  importFn: () => Promise<unknown>;
  layouts: Array<{ importFn: () => Promise<unknown> }>;
}

let teardown: (() => void) | null = null;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  navigate('/');
  document.body.innerHTML = '';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  teardown?.();
  teardown = null;
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

function makeEntry(
  pattern: string,
  importCalls: string[],
  name: string,
  withLayout = false,
): MockEntry {
  const entry: MockEntry = {
    pattern,
    importFn: async () => {
      importCalls.push(`route:${name}`);
      return { default: () => name };
    },
    layouts: [],
  };
  if (withLayout) {
    entry.layouts.push({
      importFn: async () => {
        importCalls.push(`layout:${name}`);
        return { default: (c: () => unknown) => c() };
      },
    });
  }
  return entry;
}

function makeLink(
  href: string,
  opts: { target?: string; noPrefetch?: boolean } = {},
): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  if (opts.target) a.setAttribute('target', opts.target);
  if (opts.noPrefetch) a.setAttribute('data-no-prefetch', '');
  document.body.appendChild(a);
  return a;
}

function hover(a: HTMLAnchorElement): void {
  a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

function unhover(a: HTMLAnchorElement): void {
  a.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
}

describe('prefetchManifestLinks — default behavior (ADR 0029)', () => {
  it('fires importFn after debounce when hovering a matching link', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about', true)];
    teardown = prefetchManifestLinks(routes, { delay: 50 });

    const a = makeLink('/about');
    hover(a);
    // Before debounce expires, no fire.
    expect(calls).toEqual([]);

    vi.advanceTimersByTime(50);
    // Flush microtasks so the Promise.all kick fires.
    await vi.runAllTicks?.();
    await Promise.resolve();
    expect(calls).toContain('route:about');
    expect(calls).toContain('layout:about');
  });

  it('cancels the prefetch when the cursor leaves before debounce', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    teardown = prefetchManifestLinks(routes, { delay: 50 });

    const a = makeLink('/about');
    hover(a);
    vi.advanceTimersByTime(30);
    unhover(a);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([]);
  });

  it('does not fire the same anchor twice in one session', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    teardown = prefetchManifestLinks(routes, { delay: 0 });

    const a = makeLink('/about');
    hover(a);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(calls).toEqual(['route:about']);
    calls.length = 0;
    // Hover again — already fired, no re-fire.
    unhover(a);
    hover(a);
    vi.advanceTimersByTime(50);
    await Promise.resolve();
    expect(calls).toEqual([]);
  });
});

describe('prefetchManifestLinks — default filter (ADR 0029)', () => {
  it('skips links with target="_blank"', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    teardown = prefetchManifestLinks(routes, { delay: 0 });
    const a = makeLink('/about', { target: '_blank' });
    hover(a);
    vi.advanceTimersByTime(0);
    expect(calls).toEqual([]);
  });

  it('skips links with data-no-prefetch', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    teardown = prefetchManifestLinks(routes, { delay: 0 });
    const a = makeLink('/about', { noPrefetch: true });
    hover(a);
    vi.advanceTimersByTime(0);
    expect(calls).toEqual([]);
  });

  it('skips cross-origin links', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    teardown = prefetchManifestLinks(routes, { delay: 0 });
    const a = makeLink('https://example.com/about');
    hover(a);
    vi.advanceTimersByTime(0);
    expect(calls).toEqual([]);
  });

  it('skips links whose path does not match any manifest entry', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    teardown = prefetchManifestLinks(routes, { delay: 0 });
    const a = makeLink('/nowhere');
    hover(a);
    vi.advanceTimersByTime(0);
    expect(calls).toEqual([]);
  });
});

describe('prefetchManifestLinks — custom predicate (ADR 0029)', () => {
  it('honors a custom shouldPrefetch that rejects all hovers', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    teardown = prefetchManifestLinks(routes, {
      delay: 0,
      shouldPrefetch: () => false,
    });
    const a = makeLink('/about');
    hover(a);
    vi.advanceTimersByTime(0);
    expect(calls).toEqual([]);
  });
});

describe('prefetchManifestLinks — teardown (ADR 0029)', () => {
  it('returns a teardown that removes listeners + cancels pending timers', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    const td = prefetchManifestLinks(routes, { delay: 50 });
    const a = makeLink('/about');
    hover(a);
    td();
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([]);
    // After teardown, new hovers don't fire either.
    const b = makeLink('/about');
    hover(b);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([]);
  });
});

describe('configureNavigation — prefetch sub-option (ADR 0029)', () => {
  it('wires prefetch when given { routes }', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    teardown = configureNavigation({
      // Skip the other helpers to isolate prefetch in this test.
      intercept: false,
      scroll: false,
      focus: false,
      transitions: false,
      prefetch: { routes, delay: 0 },
    });
    const a = makeLink('/about');
    hover(a);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(calls).toContain('route:about');
  });

  it('skips prefetch when given prefetch: false', async () => {
    const calls: string[] = [];
    // Unused `routes` would be a lint warning; we exercise the no-prefetch
    // path so the test doesn't need the manifest at all.
    teardown = configureNavigation({
      intercept: false,
      scroll: false,
      focus: false,
      transitions: false,
      prefetch: false,
    });
    const a = makeLink('/about');
    hover(a);
    vi.advanceTimersByTime(50);
    expect(calls).toEqual([]);
  });
});
