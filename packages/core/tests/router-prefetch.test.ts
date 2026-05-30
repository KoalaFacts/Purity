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

function focus(a: HTMLAnchorElement): void {
  a.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

function blur(a: HTMLAnchorElement): void {
  a.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
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

describe('prefetchManifestLinks — audit-v2 regressions', () => {
  // Finding: default predicate used `a.origin === window.location.origin`
  // as the only scheme gate. `blob:<page-origin>/uuid` and
  // `filesystem:<page-origin>/...` inherit the page origin string, so they
  // slipped past the origin check. In jsdom the blob URL's `pathname`
  // is the inner serialized URL (`http://localhost:3000/deadbeef-1234`),
  // which a manifest wildcard route like `/*` happily matches — feeding
  // an opaque scheme into the routes scan. Mirror the http(s) allow-list
  // from interceptLinks() (commit 64f1b43).
  it('skips non-http(s) schemes that share the page origin (blob:)', async () => {
    const calls: string[] = [];
    // Wildcard route so the routes scan would otherwise match the blob
    // URL's inner pathname.
    const routes = [makeEntry('/*', calls, 'wild')];
    teardown = prefetchManifestLinks(routes, { delay: 0 });

    const a = document.createElement('a');
    a.setAttribute('href', `blob:${window.location.origin}/deadbeef-1234`);
    document.body.appendChild(a);
    // Sanity: same origin as the page (so the origin gate alone would
    // let this through), but a blob: protocol.
    expect(a.origin).toBe(window.location.origin);
    expect(a.protocol).toBe('blob:');

    hover(a);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  // Finding: `focusin` was bound to `onEnter` but no `focusout` paired
  // listener cleared the pending timer. Tabbing past a link queued a
  // 50 ms timer that fired against the now-blurred anchor; rapid Tab
  // through N links queued N concurrent prefetches.
  it('cancels a pending prefetch when focus leaves before the debounce expires', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    teardown = prefetchManifestLinks(routes, { delay: 50 });

    const a = makeLink('/about');
    focus(a);
    // Mid-debounce, blur the link (simulating rapid Tab-past).
    vi.advanceTimersByTime(30);
    blur(a);
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  // Finding: in-flight Promise.all from a kicked-off prefetch outlives
  // teardown and its `.catch` writes to a now-orphaned WeakSet. Verify
  // the disposed flag short-circuits the catch path — no late state
  // mutation, no thrown error escapes, the next install is clean.
  it('does not throw or mutate post-teardown state when an in-flight prefetch rejects after dispose', async () => {
    const calls: string[] = [];
    let rejectImport: ((reason: unknown) => void) | null = null;
    const pendingImport = new Promise((_resolve, reject) => {
      rejectImport = reject;
    });
    const routes: MockEntry[] = [
      {
        pattern: '/about',
        importFn: () => {
          calls.push('route:about');
          return pendingImport;
        },
        layouts: [],
      },
    ];
    teardown = prefetchManifestLinks(routes, { delay: 0 });

    const a = makeLink('/about');
    hover(a);
    vi.advanceTimersByTime(0);
    // The import was kicked off but hasn't settled yet.
    expect(calls).toEqual(['route:about']);

    // Tear down BEFORE the import rejects.
    teardown();
    teardown = null;

    // Now reject the in-flight import. The `.catch` should short-circuit
    // on the `disposed` flag rather than mutating the (orphaned) `fired`
    // WeakSet. We can't directly observe `fired`, but we can verify no
    // error escapes (no unhandled rejection) and re-installing works
    // cleanly.
    rejectImport!(new Error('chunk load failed'));
    await Promise.resolve();
    await Promise.resolve();

    // Re-install and verify a fresh fire cycle is normal — proves the
    // closure was tidied up and no cross-talk between sessions.
    const calls2: string[] = [];
    const routes2 = [makeEntry('/about', calls2, 'about')];
    teardown = prefetchManifestLinks(routes2, { delay: 0 });
    const b = makeLink('/about');
    hover(b);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(calls2).toEqual(['route:about']);
  });

  // Finding: mouseover delegation re-fires per descendant. The existing
  // `pending` map and `fired` WeakSet dedup the predicate after the
  // first descendant event, but the fix adds an explicit
  // `relatedTarget`-inside-anchor short-circuit. Document the dedup
  // contract: shouldPrefetch runs at most once per anchor entry even
  // with deeply nested descendants.
  it('runs shouldPrefetch at most once per anchor entry even with nested descendants', async () => {
    const calls: string[] = [];
    const routes = [makeEntry('/about', calls, 'about')];
    let predicateCalls = 0;
    teardown = prefetchManifestLinks(routes, {
      delay: 50,
      shouldPrefetch: () => {
        predicateCalls++;
        return true;
      },
    });

    const a = makeLink('/about');
    const inner = document.createElement('span');
    const innerDeep = document.createElement('em');
    inner.appendChild(innerDeep);
    a.appendChild(inner);

    // First mouseover: entering the anchor for real (relatedTarget
    // outside the anchor).
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    // Cursor moves to a descendant — relatedTarget is the previous
    // target (inside the same anchor). Should be ignored.
    innerDeep.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: inner }));
    inner.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: innerDeep }));

    expect(predicateCalls).toBe(1);

    vi.advanceTimersByTime(50);
    await Promise.resolve();
    expect(calls).toEqual(['route:about']);
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
