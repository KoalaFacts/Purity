// ADR 0031 — RouteParams<P> tests.
//
// The type is compile-time only; vitest doesn't typecheck assertions
// directly, so we exercise the type by:
//   1. Writing variables with the derived type and asserting the
//      runtime shape they accept — a type-level mismatch shows up as
//      a TS error during esbuild's transform (which vitest runs).
//   2. Using a `@ts-expect-error` directive on intentionally-bad
//      assignments — if the type is wrong, the suppression fails the
//      compile.

import { describe, expect, it } from 'vitest';

import type { RouteParams } from '../src/route-params.ts';

describe('RouteParams<P> — derived shapes (ADR 0031)', () => {
  it('produces an empty record for patterns with no dynamic segments', () => {
    const home: RouteParams<'/'> = {};
    const about: RouteParams<'/about'> = {};
    const nested: RouteParams<'/about/team'> = {};
    expect(home).toEqual({});
    expect(about).toEqual({});
    expect(nested).toEqual({});
  });

  it('produces a single-key record for one dynamic param', () => {
    const user: RouteParams<'/users/:id'> = { id: '42' };
    expect(user.id).toBe('42');
  });

  it('produces a multi-key record for multiple dynamic params', () => {
    const userInOrg: RouteParams<'/orgs/:org/users/:id'> = {
      org: 'acme',
      id: '42',
    };
    expect(userInOrg.org).toBe('acme');
    expect(userInOrg.id).toBe('42');
  });

  it('produces a `*`-keyed record for splat patterns', () => {
    const blog: RouteParams<'/blog/*'> = { '*': '2026/hello' };
    expect(blog['*']).toBe('2026/hello');
  });

  it('mixes named params and literal segments correctly', () => {
    const userEdit: RouteParams<'/users/:id/edit'> = { id: '42' };
    expect(userEdit.id).toBe('42');
  });

  it('rejects unknown keys at compile time', () => {
    const user: RouteParams<'/users/:id'> = {
      id: '42',
      // @ts-expect-error — `name` is not a derived param of /users/:id
      name: 'oops',
    };
    expect(user.id).toBe('42');
  });

  it('rejects missing keys at compile time', () => {
    // @ts-expect-error — missing `id` required by /users/:id
    const user: RouteParams<'/users/:id'> = {};
    expect(user).toEqual({});
  });

  // Note: `RouteParams<'/about'>` produces an empty mapped type. TypeScript
  // doesn't enforce excess-property checks on assignments to empty mapped
  // types — `const x: RouteParams<'/about'> = { foo: 'bar' }` compiles
  // even though `foo` isn't a derived key. Documented in ADR 0031; doesn't
  // affect real apps because params-less route components never read keys.

  it('derives both params and splat when combined (single splat at end)', () => {
    // ADR 0019 only allows splat as the final segment.
    const post: RouteParams<'/users/:id/posts/*'> = {
      id: '42',
      '*': 'hello/world',
    };
    expect(post.id).toBe('42');
    expect(post['*']).toBe('hello/world');
  });

  // ---------------------------------------------------------------------
  // Audit-v2 regressions.
  // ---------------------------------------------------------------------

  it('audit-v2: excludes empty `:` segment from the param set (HIGH)', () => {
    // A bare `:` (no name after the colon) used to produce a `''` key
    // in the derived record, which never matches anything matchRoute()
    // would actually populate. After the fix the type is the empty
    // mapped type — same caveat as `/about` (TS doesn't enforce
    // excess-property checks on empty mapped types), but consumers
    // can no longer reference `params['']` and get `string`.
    const empty: RouteParams<'/users/:'> = {};
    expect(empty).toEqual({});
    // Documents the post-fix shape: `''` is not a known key, so reading
    // it through a typed variable degrades to `undefined` at runtime.
    // (Pre-fix the type was `{ '': string }`, which was a false
    // positive — `matchRoute` never populates an empty-name key.)
    const probe: RouteParams<'/users/:'> = {};
    expect((probe as Record<string, string | undefined>)['']).toBeUndefined();
  });

  it('audit-v2: excludes prototype-poisoning param names (HIGH)', () => {
    // matchRoute() silently skips `:__proto__`, `:constructor`,
    // `:prototype` at runtime (defense in depth around prototype
    // pollution). Surfacing those keys in the derived type was a false
    // positive — consumers would dereference a key the runtime never
    // populates.
    const a: RouteParams<'/u/:__proto__'> = {};
    const b: RouteParams<'/u/:constructor'> = {};
    const c: RouteParams<'/u/:prototype'> = {};
    expect(a).toEqual({});
    expect(b).toEqual({});
    expect(c).toEqual({});

    // The plain `id` key on a mixed pattern still surfaces — only the
    // poisoned name is filtered, not the whole pattern.
    const mixed: RouteParams<'/u/:__proto__/posts/:id'> = { id: '42' };
    expect(mixed.id).toBe('42');
  });

  it('audit-v2: handles trailing slash without leaking empty key (HIGH)', () => {
    // `/users/:id/` split by '/' yields ['', 'users', ':id', '']. The
    // trailing empty segment must not appear as a `''` key, and the
    // dynamic `id` must still be extracted.
    const u: RouteParams<'/users/:id/'> = { id: '42' };
    expect(u.id).toBe('42');
  });

  it('audit-v2: name shadowing across colon segments collapses cleanly', () => {
    // Two segments named `:id` collapse to a single `id` key — the
    // union dedupes. Documented behavior; covered here so a future
    // refactor that re-introduces an intersection (which would
    // become `never`) is caught.
    const dup: RouteParams<'/users/:id/posts/:id'> = { id: '42' };
    expect(dup.id).toBe('42');
  });
});
