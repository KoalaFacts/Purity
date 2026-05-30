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
  watch,
} from '../src/index.ts';
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
