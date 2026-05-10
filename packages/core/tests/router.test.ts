// @vitest-environment jsdom
// Tests for the minimal router primitives (ADR 0011).
//
// Three exports: currentPath() / navigate() / matchRoute(). The client-side
// covers history integration; server-side path resolution from a Request is
// covered in @purityjs/ssr's router test file.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentPath, matchRoute, navigate, watch } from '../src/index.ts';

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
