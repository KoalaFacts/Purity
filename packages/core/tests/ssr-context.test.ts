// @vitest-environment jsdom
//
// Colocated unit tests for `packages/core/src/ssr-context.ts`.
//
// Covers:
//   * `pushSSRRenderContext` / `popSSRRenderContext` behave as a real stack
//     across nested SSR scopes (HIGH from the deep audit) — a pop in an
//     inner scope must restore the outer caller's context, and a pop in the
//     outermost scope must clear it.
//   * `consumeHydrationValue` in mixed keyed + unkeyed payloads — a keyed
//     miss must NOT advance the positional cursor (the SSR serializer
//     already omits keyed resources from the ordered array, so consuming a
//     positional slot for a keyed miss would skew the next unkeyed call's
//     pairing). HIGH from the deep audit; the invariant was previously
//     uncovered.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  consumeHydrationValue,
  getSSRRenderContext,
  popSSRRenderContext,
  primeHydrationCache,
  pushSSRRenderContext,
} from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

describe('pushSSRRenderContext / popSSRRenderContext — stack semantics', () => {
  afterEach(() => {
    // Defensive: any test that fails to pop must not contaminate the next
    // test's `getSSRRenderContext()` read. Drain until null.
    for (let i = 0; i < 8 && getSSRRenderContext() !== null; i++) {
      popSSRRenderContext();
    }
  });

  it('a single push/pop pair leaves the context cleared', () => {
    expect(getSSRRenderContext()).toBeNull();
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    expect(getSSRRenderContext()).toBe(ctx);
    popSSRRenderContext();
    expect(getSSRRenderContext()).toBeNull();
  });

  it('a nested push then pop restores the outer context (real stack)', () => {
    const outer = makeSSRContext();
    const inner = makeSSRContext();
    pushSSRRenderContext(outer);
    expect(getSSRRenderContext()).toBe(outer);
    pushSSRRenderContext(inner);
    expect(getSSRRenderContext()).toBe(inner);
    // Inner pop — outer must be restored, NOT nulled.
    popSSRRenderContext();
    expect(getSSRRenderContext()).toBe(outer);
    popSSRRenderContext();
    expect(getSSRRenderContext()).toBeNull();
  });

  it('three-deep nesting unwinds in LIFO order', () => {
    const a = makeSSRContext();
    const b = makeSSRContext();
    const c = makeSSRContext();
    pushSSRRenderContext(a);
    pushSSRRenderContext(b);
    pushSSRRenderContext(c);
    expect(getSSRRenderContext()).toBe(c);
    popSSRRenderContext();
    expect(getSSRRenderContext()).toBe(b);
    popSSRRenderContext();
    expect(getSSRRenderContext()).toBe(a);
    popSSRRenderContext();
    expect(getSSRRenderContext()).toBeNull();
  });

  it('an extra pop on an empty stack is a no-op (still null, does not throw)', () => {
    expect(getSSRRenderContext()).toBeNull();
    expect(() => popSSRRenderContext()).not.toThrow();
    expect(getSSRRenderContext()).toBeNull();
  });
});

describe('consumeHydrationValue — mixed keyed + unkeyed positional pairing', () => {
  beforeEach(() => {
    primeHydrationCache([]);
  });
  afterEach(() => {
    primeHydrationCache([]);
  });

  it('a keyed miss does NOT advance the positional cursor', () => {
    // Server-side invariant (resource.ts:264): a keyed resource never
    // consumes a positional slot. So the ordered payload here holds ONE
    // value, intended for the single unkeyed resource. If a keyed miss
    // advances the cursor, the unkeyed call would read past the end and
    // get undefined — skewed pairing.
    primeHydrationCache({ ordered: ['for-the-unkeyed-one'], keyed: { other: 'present' } });

    // Keyed miss — the user-supplied key is not in the keyed cache.
    expect(consumeHydrationValue('absent-key')).toBeUndefined();

    // The next unkeyed call must still find the ordered[0] slot intact.
    expect(consumeHydrationValue()).toBe('for-the-unkeyed-one');
  });

  it('a keyed hit also does not consume a positional slot', () => {
    primeHydrationCache({ ordered: ['unkeyed-0'], keyed: { k: 'keyed-v' } });

    // Keyed hit returns its value.
    expect(consumeHydrationValue('k')).toBe('keyed-v');

    // The positional cursor was untouched: the next unkeyed call still
    // reads slot 0.
    expect(consumeHydrationValue()).toBe('unkeyed-0');
  });

  it('interleaved keyed + unkeyed reads pair correctly with the serializer', () => {
    // Mirrors a realistic mixed-mode page: unkeyed, keyed, unkeyed, keyed.
    // The server only emits the two unkeyed values to `ordered`.
    primeHydrationCache({
      ordered: ['u0', 'u1'],
      keyed: { k0: 'kv0', k1: 'kv1' },
    });

    expect(consumeHydrationValue()).toBe('u0');
    expect(consumeHydrationValue('k0')).toBe('kv0');
    expect(consumeHydrationValue()).toBe('u1');
    expect(consumeHydrationValue('k1')).toBe('kv1');
  });
});
