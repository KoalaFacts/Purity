import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { debounced } from '../src/debounced.ts';
import { state, watch } from '../src/signals.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()));

// Moved from packages/core/tests/resource.test.ts so @purityjs/signals tests its
// own debounced() (core re-exports the same function; see core's
// debounced-shared.test.ts and the debounced → resource integration case).
describe('debounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mirrors the source synchronously on first read', () => {
    const s = state('hello');
    const d = debounced(s, 100);
    expect(d()).toBe('hello');
  });

  it('delays propagation by the configured ms', async () => {
    const s = state('a');
    const d = debounced(s, 100);

    s('b');
    await vi.advanceTimersByTimeAsync(50);
    expect(d()).toBe('a');

    await vi.advanceTimersByTimeAsync(50);
    expect(d()).toBe('b');
  });

  it('coalesces rapid bursts into a single propagation', async () => {
    const s = state(0);
    const d = debounced(s, 100);

    for (let i = 1; i <= 10; i++) {
      s(i);
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(d()).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(d()).toBe(10);
  });

  it('is read-only (no .set method on the accessor)', () => {
    const s = state(1);
    const d = debounced(s, 50);
    expect((d as unknown as { set?: unknown }).set).toBe(undefined);
  });

  // --- audit-v2 regressions -------------------------------------------------

  it('rejects NaN / Infinity / negative ms up-front', () => {
    const s = state(0);
    expect(() => debounced(s, Number.NaN)).toThrow(RangeError);
    expect(() => debounced(s, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => debounced(s, -1)).toThrow(RangeError);
    // sanity: zero is allowed (immediate flush after macrotask)
    expect(() => debounced(s, 0).dispose()).not.toThrow();
  });

  it('dispose() is idempotent and clears any pending timer', async () => {
    const s = state('a');
    const d = debounced(s, 100);
    s('b');
    // Pending timer is now armed.
    await tick();
    d.dispose();
    // Second dispose must not throw and must not write to the underlying state.
    expect(() => d.dispose()).not.toThrow();
    await vi.advanceTimersByTimeAsync(500);
    // Post-dispose, value stays frozen at the last propagated value (init).
    expect(d()).toBe('a');
  });

  it('does not write through after dispose even if the timer raced', async () => {
    const s = state(0);
    const d = debounced(s, 50);
    s(1);
    await tick();
    // Simulate dispose happening right before the timer's queued task drains.
    d.dispose();
    // Advance enough that any leftover scheduled callback would fire.
    await vi.advanceTimersByTimeAsync(1000);
    // Internal state must remain at the initial value — no late write.
    expect(d()).toBe(0);
  });

  it('isolates a throw from source() and keeps watching', async () => {
    const trigger = state(0);
    const explode = state(false);
    const errs: unknown[] = [];
    const origErr = console.error;
    console.error = (...a) => errs.push(a[0]);
    try {
      const d = debounced(() => {
        // Track both so the watcher re-runs on either change.
        const t = trigger();
        if (explode()) throw new Error('boom');
        return t;
      }, 50);
      expect(d()).toBe(0);

      // First: trigger a normal change and confirm propagation.
      trigger(1);
      await vi.advanceTimersByTimeAsync(60);
      expect(d()).toBe(1);

      // Now make source throw. The watcher must survive (log, no crash).
      explode(true);
      await tick();
      await vi.advanceTimersByTimeAsync(60);
      // Last good value preserved.
      expect(d()).toBe(1);

      // Recover: stop throwing, push a new value — propagation resumes.
      explode(false);
      trigger(2);
      await vi.advanceTimersByTimeAsync(60);
      expect(d()).toBe(2);

      d.dispose();
    } finally {
      console.error = origErr;
    }
    // At least one source-throw was logged through console.error.
    expect(errs.some((e) => String(e).includes('debounced'))).toBe(true);
  });

  it('a downstream watcher only fires once per debounce window (no double-fire)', async () => {
    const s = state(0);
    const d = debounced(s, 50);
    let fires = 0;
    const stop = watch(d, () => {
      fires++;
    });

    // Burst of writes inside one window — must coalesce to a single notify.
    for (let i = 1; i <= 5; i++) s(i);
    await vi.advanceTimersByTimeAsync(60);
    await tick();
    expect(fires).toBe(1);

    // Another window with a single write — exactly one more notify.
    s(99);
    await vi.advanceTimersByTimeAsync(60);
    await tick();
    expect(fires).toBe(2);

    stop();
    d.dispose();
  });
});
