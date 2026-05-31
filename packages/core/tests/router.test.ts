// @vitest-environment jsdom
// Tests for the minimal router primitives (ADR 0011).
//
// Three exports: currentPath() / navigate() / matchRoute(). The client-side
// covers history integration; server-side path resolution from a Request is
// covered in @purityjs/ssr's router test file.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  currentHash,
  currentPath,
  currentSearch,
  matchRoute,
  navigate,
  onNavigate,
  watch,
} from '../src/index.ts';
import { _setNavigateWrapper } from '../src/router.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

describe('matchRoute() — pattern matching', () => {
  it('matches exact literal paths', () => {
    expect(matchRoute('/about', '/about')).toEqual({ params: {} });
    expect(matchRoute('/about', '/contact')).toBeNull();
    expect(matchRoute('/users/edit', '/users/edit')).toEqual({ params: {} });
  });

  it('matches the root path', () => {
    expect(matchRoute('/', '/')).toEqual({ params: {} });
    expect(matchRoute('/', '/about')).toBeNull();
    expect(matchRoute('/', '')).toEqual({ params: {} });
  });

  it('captures :param segments', () => {
    expect(matchRoute('/users/:id', '/users/42')).toEqual({ params: { id: '42' } });
    expect(matchRoute('/blog/:year/:slug', '/blog/2026/hello')).toEqual({
      params: { year: '2026', slug: 'hello' },
    });
  });

  it('URI-decodes :param values', () => {
    expect(matchRoute('/users/:name', '/users/Ada%20Lovelace')).toEqual({
      params: { name: 'Ada Lovelace' },
    });
    expect(matchRoute('/tags/:tag', '/tags/c%2B%2B')).toEqual({
      params: { tag: 'c++' },
    });
  });

  it('does not throw on a malformed percent-encoded :param (falls back to raw)', () => {
    // decodeURIComponent('%') raises URIError. A path segment is fully
    // attacker-controllable, and matchRoute gates the whole render — a
    // throw here would crash routing. We fall back to the raw segment.
    expect(() => matchRoute('/users/:id', '/users/%')).not.toThrow();
    expect(matchRoute('/users/:id', '/users/%')).toEqual({ params: { id: '%' } });
    // Incomplete UTF-8 escape sequence.
    expect(matchRoute('/users/:id', '/users/%E0%A4')).toEqual({ params: { id: '%E0%A4' } });
    // Valid segments alongside a malformed one still match; only the bad
    // one falls back.
    expect(matchRoute('/u/:a/:b', '/u/ok/%C0')).toEqual({ params: { a: 'ok', b: '%C0' } });
  });

  it('rejects paths that are too short for the pattern', () => {
    expect(matchRoute('/users/:id', '/users')).toBeNull();
    expect(matchRoute('/a/b/c', '/a/b')).toBeNull();
  });

  it('rejects paths with trailing segments the pattern does not consume', () => {
    expect(matchRoute('/about', '/about/x')).toBeNull();
    expect(matchRoute('/users/:id', '/users/42/edit')).toBeNull();
  });

  it('captures the splat tail with *', () => {
    expect(matchRoute('/blog/*', '/blog/2026/hello')).toEqual({
      params: { '*': '2026/hello' },
    });
    expect(matchRoute('/files/*', '/files/')).toEqual({ params: { '*': '' } });
    expect(matchRoute('/files/*', '/files')).toEqual({ params: { '*': '' } });
  });

  it('mixes :param and * (params before splat)', () => {
    expect(matchRoute('/users/:id/files/*', '/users/42/files/docs/readme.md')).toEqual({
      params: { id: '42', '*': 'docs/readme.md' },
    });
  });

  it('URI-decodes splat segments symmetrically with :param', () => {
    // Before the fix the splat capture skipped safeDecode while :param
    // captures decoded. So `/files/Hello%20World/c%2B%2B.md` matched
    // `/files/*` to `Hello%20World/c%2B%2B.md` raw — asymmetric and
    // surprising. Each path segment is now decoded.
    expect(matchRoute('/files/*', '/files/Hello%20World/c%2B%2B.md')).toEqual({
      params: { '*': 'Hello World/c++.md' },
    });
    // Mixed :param + * — both decoded.
    expect(matchRoute('/u/:name/*', '/u/Ada%20Lovelace/notes/2024%2F01.md')).toEqual({
      params: { name: 'Ada Lovelace', '*': 'notes/2024/01.md' },
    });
    // Malformed percent in a splat segment falls back to raw, doesn't throw.
    expect(matchRoute('/files/*', '/files/%/safe')).toEqual({
      params: { '*': '%/safe' },
    });
  });

  it('treats consecutive / as one segment (filter Boolean)', () => {
    expect(matchRoute('/about', '//about///')).toEqual({ params: {} });
  });
});

describe('currentPath() + navigate() — client-side history', () => {
  beforeEach(() => {
    // Reset to a known path before each test.
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('returns the current pathname', () => {
    window.history.replaceState(null, '', '/about');
    // currentPath reads from the reactive signal which is initialised at
    // module load. After we replaceState we have to navigate() (or fire
    // popstate) for the signal to refresh; this test just verifies
    // navigate() updates correctly:
    navigate('/about');
    expect(currentPath()).toBe('/about');
  });

  it('pushState by default (back-stack entry); replace via { replace: true }', () => {
    const before = window.history.length;
    navigate('/page-a');
    const afterPush = window.history.length;
    expect(afterPush).toBeGreaterThan(before);
    navigate('/page-b', { replace: true });
    // Length unchanged on replace.
    expect(window.history.length).toBe(afterPush);
  });

  it('ignores cross-origin hrefs', () => {
    navigate('/start');
    expect(currentPath()).toBe('/start');
    // External URL — should not navigate.
    navigate('https://elsewhere.example.com/whatever');
    expect(currentPath()).toBe('/start');
  });

  it('drives reactive subscribers via watch()', async () => {
    const seen: string[] = [];
    navigate('/initial');
    const dispose = watch(() => {
      seen.push(currentPath());
    });
    navigate('/next');
    await Promise.resolve();
    navigate('/another');
    await Promise.resolve();
    dispose();
    expect(seen).toContain('/initial');
    expect(seen).toContain('/next');
    expect(seen).toContain('/another');
  });

  it('updates from popstate events', async () => {
    navigate('/first');
    expect(currentPath()).toBe('/first');
    window.history.replaceState(null, '', '/from-popstate');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(currentPath()).toBe('/from-popstate');
  });

  it('matchRoute() reads currentPath() by default', () => {
    navigate('/users/42');
    expect(matchRoute('/users/:id')).toEqual({ params: { id: '42' } });
    expect(matchRoute('/about')).toBeNull();
  });
});

describe('currentSearch() / currentHash() — URL part signals (ADR 0014)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('currentSearch() reads the navigate()d URL search params', () => {
    navigate('/list?sort=name&page=2');
    const params = currentSearch();
    expect(params.get('sort')).toBe('name');
    expect(params.get('page')).toBe('2');
  });

  it('currentSearch() returns an empty params object when no query', () => {
    navigate('/about');
    expect(currentSearch().toString()).toBe('');
  });

  it('currentSearch() returns a fresh copy each call (mutations are local)', () => {
    navigate('/list?a=1');
    const params = currentSearch();
    params.set('a', '999');
    params.set('b', '2');
    // The underlying URL still has the original search.
    expect(currentSearch().get('a')).toBe('1');
    expect(currentSearch().get('b')).toBeNull();
  });

  it('currentHash() returns the leading `#` + fragment, or empty when none', () => {
    navigate('/page#section-2');
    expect(currentHash()).toBe('#section-2');

    navigate('/page');
    expect(currentHash()).toBe('');
  });

  it('search reads are reactive — watch fires on navigate', async () => {
    const { watch } = await import('../src/index.ts');
    const seen: string[] = [];
    navigate('/list?page=1');
    const dispose = watch(() => {
      seen.push(currentSearch().get('page') ?? '?');
    });
    navigate('/list?page=2');
    await Promise.resolve();
    navigate('/list?page=3');
    await Promise.resolve();
    dispose();
    expect(seen).toEqual(['1', '2', '3']);
  });

  it('hash reads are reactive — watch fires on hashchange', async () => {
    const { watch } = await import('../src/index.ts');
    const seen: string[] = [];
    navigate('/page');
    const dispose = watch(() => {
      seen.push(currentHash());
    });
    window.history.replaceState(null, '', '/page#first');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await Promise.resolve();
    window.history.replaceState(null, '', '/page#second');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await Promise.resolve();
    dispose();
    expect(seen).toContain('');
    expect(seen).toContain('#first');
    expect(seen).toContain('#second');
  });

  it('navigate() updates all three accessors atomically', () => {
    navigate('/posts/42?reply=7#comment-9');
    expect(currentPath()).toBe('/posts/42');
    expect(currentSearch().get('reply')).toBe('7');
    expect(currentHash()).toBe('#comment-9');
  });
});

describe('navigate() — audit-v2 hardening', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    _setNavigateWrapper(null);
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
    _setNavigateWrapper(null);
  });

  it('blocks `javascript:` hrefs even when origins match (opaque/null-origin defense)', () => {
    // The cross-origin guard catches `javascript:` in normal cases because
    // its parsed origin is `'null'` which differs from `window.location.origin`.
    // But in a sandboxed iframe or some `file://` contexts the document
    // itself has an opaque origin, so `null === null` would slip a hostile
    // `javascript:` payload into pushState. Defense in depth: the scheme
    // allow-list rejects it unconditionally.
    navigate('/safe');
    expect(currentPath()).toBe('/safe');
    navigate('javascript:alert(1)');
    // Still on /safe; hostile scheme was ignored.
    expect(currentPath()).toBe('/safe');
    expect(window.location.href).not.toContain('javascript:');
  });

  it('blocks `data:` and `blob:` hrefs', () => {
    navigate('/start');
    navigate('data:text/html,<script>alert(1)</script>');
    expect(currentPath()).toBe('/start');
    navigate('blob:https://example.com/uuid');
    expect(currentPath()).toBe('/start');
  });

  it('still allows http(s) absolute same-origin URLs', () => {
    navigate(`${window.location.origin}/ok`);
    expect(currentPath()).toBe('/ok');
  });

  it('isolates onNavigate listener throws (one bad listener does not abort the rest)', () => {
    navigate('/before');
    const seen: string[] = [];
    const offA = onNavigate(() => {
      seen.push('a');
      throw new Error('listener-a-boom');
    });
    const offB = onNavigate((url) => {
      seen.push(`b:${url.pathname}`);
    });
    expect(() => navigate('/after')).not.toThrow();
    expect(seen).toEqual(['a', 'b:/after']);
    offA();
    offB();
  });

  it('isolates navigateWrapper throws and still applies the History update (fallback)', () => {
    // A throwing view-transition wrapper otherwise (a) escapes to the
    // navigate() caller (link clicks, deep imports) and (b) leaves the
    // user on the previous URL with no signal update. The fix wraps the
    // wrapper call in try/catch and runs an unwrapped update so the
    // navigation still lands.
    navigate('/origin');
    _setNavigateWrapper(() => {
      throw new Error('wrapper-boom');
    });
    expect(() => navigate('/destination')).not.toThrow();
    // Fallback update ran: URL signal + history advanced to the target.
    expect(currentPath()).toBe('/destination');
  });

  it('guards against a wrapper calling update() twice (no double pushState / double listener fan-out)', () => {
    navigate('/before-double');
    const fireCount: string[] = [];
    const off = onNavigate((url) => {
      fireCount.push(url.pathname);
    });
    _setNavigateWrapper((_url, _replace, update) => {
      update();
      update(); // misbehaving wrapper — second call must be a no-op.
    });
    const before = window.history.length;
    navigate('/double-target');
    const after = window.history.length;
    // Exactly one pushState entry, exactly one listener fan-out.
    expect(after - before).toBe(1);
    expect(fireCount).toEqual(['/double-target']);
    off();
  });

  // Finding (cross-file #15): `_setNavigateWrapper` was last-writer-wins
  // with no atomicity. If caller A installed a wrapper, caller B then
  // installed its own wrapper (e.g. configureNavigation → manageNavTransitions
  // arriving after a custom wrapper was already in place), and A later ran
  // its teardown, A's `_setNavigateWrapper(null)` would silently uninstall
  // B's wrapper. The fix returns an opaque token from install and accepts
  // an `expected` token on clear — the swap only proceeds when the token
  // still matches the live one.
  it('CAS install: A.teardown does not clobber B after B overwrites A', () => {
    const seenByA: URL[] = [];
    const seenByB: URL[] = [];
    // Caller A installs first.
    const tokenA = _setNavigateWrapper((url, _replace, update) => {
      seenByA.push(url);
      update();
    });
    // Caller B installs after, taking ownership of the slot.
    const tokenB = _setNavigateWrapper((url, _replace, update) => {
      seenByB.push(url);
      update();
    });
    expect(tokenA).not.toBeNull();
    expect(tokenB).not.toBeNull();
    expect(tokenA).not.toBe(tokenB);

    // A's teardown tries to null the slot — but B owns it now, so the CAS
    // must reject and B's wrapper must stay live.
    const afterAClear = _setNavigateWrapper(null, tokenA);
    // Returned token reflects the still-active install (B), not null.
    expect(afterAClear).toBe(tokenB);

    // Verify B's wrapper is still routing.
    navigate('/after-a-teardown');
    expect(seenByA).toEqual([]);
    expect(seenByB.map((u) => u.pathname)).toEqual(['/after-a-teardown']);

    // Now B's own teardown should succeed (token matches the live one).
    const afterBClear = _setNavigateWrapper(null, tokenB);
    expect(afterBClear).toBeNull();
    navigate('/post-b-teardown');
    // No wrapper installed — B's counter doesn't advance.
    expect(seenByB.map((u) => u.pathname)).toEqual(['/after-a-teardown']);
  });
});

describe('matchRoute() — audit-v2 prototype-pollution defense', () => {
  it('does not pollute Object.prototype via `:__proto__` capture', () => {
    // Pattern with `:__proto__` segment. Before the fix the captured
    // value would be assigned to `params.__proto__` (silently a no-op
    // when value is a string, but `params` would still inherit
    // Object.prototype and any code spreading params into a plain object
    // could later poison ancestors). The fix uses a null-proto bag and
    // skips reserved names entirely.
    const m = matchRoute('/u/:__proto__', '/u/polluted');
    expect(m).not.toBeNull();
    // The dangerous key was skipped; no own slot installed.
    expect(Object.prototype.hasOwnProperty.call(m!.params, '__proto__')).toBe(false);
    // Object.prototype is intact.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // Spreading params into a plain object can't smuggle the __proto__
    // slot either.
    const copy = { ...m!.params };
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect((copy as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('skips `constructor` / `prototype` named captures (defense in depth)', () => {
    const a = matchRoute('/u/:constructor', '/u/x');
    expect(a).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(a!.params, 'constructor')).toBe(false);

    const b = matchRoute('/u/:prototype', '/u/x');
    expect(b).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(b!.params, 'prototype')).toBe(false);
  });

  it('params is a null-prototype object (no inherited methods leak to consumers)', () => {
    const m = matchRoute('/u/:id', '/u/42');
    expect(m).not.toBeNull();
    expect(Object.getPrototypeOf(m!.params)).toBeNull();
    // Consumer code doing `params.hasOwnProperty` would have shadowed
    // the prototype method on a poisoned bag; on a null-proto bag that
    // key is just `undefined` — safer surface.
    expect((m!.params as Record<string, unknown>).hasOwnProperty).toBeUndefined();
  });
});

describe('currentPath() — audit-v2 fix #4: trailing-slash normalization', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('strips a trailing slash from a non-root path (canonical form)', () => {
    // Before fix: `currentPath()` returned `/app/` verbatim, while
    // `matchRoute('/app')` happily matched both — disagreement broke
    // string-equality consumers: `currentPath() === '/app'` was true
    // for `/app` but false for `/app/`. After fix: both forms read
    // back as `/app`.
    navigate('/app/');
    expect(currentPath()).toBe('/app');
    navigate('/app/sub/');
    expect(currentPath()).toBe('/app/sub');
  });

  it('keeps the root `/` as `/` (not the empty string)', () => {
    navigate('/');
    expect(currentPath()).toBe('/');
  });

  it('does not touch paths without a trailing slash', () => {
    navigate('/app');
    expect(currentPath()).toBe('/app');
    navigate('/users/42');
    expect(currentPath()).toBe('/users/42');
  });

  it('matchRoute() over the normalized currentPath agrees with explicit form', () => {
    // Same path written two ways → same match.
    navigate('/app/');
    const fromCurrent = matchRoute('/app');
    const fromExplicit = matchRoute('/app', '/app');
    expect(fromCurrent).toEqual(fromExplicit);
  });
});

describe('navigate() — audit-v2 fix #3: in-flight no-op-and-warn', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    _setNavigateWrapper(null);
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    _setNavigateWrapper(null);
  });

  it('no-ops + warns when a second navigate() fires before a wrapper-deferred update() runs', async () => {
    // Repro: a view-transition wrapper that defers update() to a
    // microtask is mid-flight when the user double-clicks a link.
    // Without the in-flight latch, the second call races the History/
    // signal update. Fix: second call no-ops + warns.
    const { vi } = await import('vitest');
    // Establish a known baseline so we don't depend on prior-test state.
    navigate('/baseline');
    expect(currentPath()).toBe('/baseline');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let deferredUpdate: (() => void) | null = null;
    _setNavigateWrapper((_url, _replace, update) => {
      deferredUpdate = update;
    });
    navigate('/first');
    // First call hasn't applied yet — wrapper hasn't run update().
    expect(currentPath()).toBe('/baseline');
    // Second call must be ignored.
    navigate('/second');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('a previous nav is still pending'),
      '/second',
    );
    // Resolve the first nav — URL settles to /first, not /second.
    deferredUpdate!();
    expect(currentPath()).toBe('/first');
    // Now a fresh navigate() works — flag was cleared inside update().
    navigate('/third');
    deferredUpdate!();
    expect(currentPath()).toBe('/third');
    warnSpy.mockRestore();
  });

  it('clears the in-flight flag synchronously on the no-wrapper path', () => {
    // No wrapper installed — update() runs synchronously, so the flag
    // clears before navigate() returns, allowing the next call.
    navigate('/a');
    expect(currentPath()).toBe('/a');
    navigate('/b');
    expect(currentPath()).toBe('/b');
    navigate('/c');
    expect(currentPath()).toBe('/c');
  });

  it('clears the flag when the wrapper throws (fallback update() ran)', () => {
    _setNavigateWrapper(() => {
      throw new Error('wrapper-boom');
    });
    navigate('/x');
    // Fallback update() inside catch DID run and cleared the flag.
    expect(currentPath()).toBe('/x');
    _setNavigateWrapper(null);
    // Next nav not blocked by a stale flag.
    navigate('/y');
    expect(currentPath()).toBe('/y');
  });
});

describe('onNavigate() — audit-v2 fix #6: globalThis listener sentinel', () => {
  it('shares a single listener Set across module incarnations (HMR safety)', () => {
    // The fix hoists `navigateListeners` onto globalThis under
    // `__purityNavigateListeners`. A Vite HMR re-import then re-uses
    // the existing Set rather than creating a fresh one, so the
    // pre-HMR subscribers stay reachable and `unsubscribe()` still
    // points at the right entry. Verify the sentinel exists, is a
    // Set, and add/remove flows it correctly.
    interface RouterGlobal {
      __purityNavigateListeners?: Set<unknown>;
    }
    const sentinel = (globalThis as unknown as RouterGlobal).__purityNavigateListeners;
    expect(sentinel).toBeDefined();
    expect(sentinel).toBeInstanceOf(Set);
    const sizeBefore = sentinel!.size;
    const off = onNavigate(() => {});
    expect(sentinel!.size).toBe(sizeBefore + 1);
    off();
    expect(sentinel!.size).toBe(sizeBefore);
  });
});

describe('currentPath/Search/Hash — SSR with malformed request.url', () => {
  it('does not crash when the SSR Request URL is malformed', () => {
    // SSR adapters that surface req.url verbatim (edge runtimes,
    // hand-rolled handlers) can deliver malformed URLs. `new URL(req.url)`
    // throws TypeError. Components reading currentPath/Search/Hash should
    // see "no request" rather than crash the whole render.
    const ctx = makeSSRContext();
    ctx.request = { url: 'not a url' } as Request;
    pushSSRRenderContext(ctx);
    try {
      expect(() => currentPath()).not.toThrow();
      expect(() => currentSearch()).not.toThrow();
      expect(() => currentHash()).not.toThrow();
      // Falls through to the client-side urlSignal (initialised from
      // window.location). Path is whatever jsdom set; the important
      // invariant is "no throw".
      expect(typeof currentPath()).toBe('string');
    } finally {
      popSSRRenderContext();
    }
  });
});
