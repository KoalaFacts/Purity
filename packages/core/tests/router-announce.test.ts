// @vitest-environment jsdom
// Tests for manageNavAnnounce() — ADR 0045.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manageNavAnnounce, navigate } from '../src/index.ts';

const DEFAULT_ID = '__purity_announce__';
const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

let teardown: (() => void) | null = null;

function resetDom(): void {
  document.body.replaceChildren();
  document.title = '';
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  resetDom();
});

afterEach(() => {
  teardown?.();
  teardown = null;
  resetDom();
  window.history.replaceState(null, '', '/');
});

describe('manageNavAnnounce() — region creation', () => {
  it('creates a polite live region with sr-only styles when none exists', async () => {
    teardown = manageNavAnnounce();
    navigate('/somewhere');
    await tick();
    const region = document.getElementById(DEFAULT_ID);
    expect(region).not.toBeNull();
    expect(region!.getAttribute('aria-live')).toBe('polite');
    expect(region!.getAttribute('aria-atomic')).toBe('true');
    expect(region!.getAttribute('role')).toBe('status');
    const style = region!.getAttribute('style')!;
    expect(style).toContain('position:absolute');
    expect(style).toContain('width:1px');
    expect(style).toContain('clip:rect(0,0,0,0)');
  });

  it('uses role="alert" + aria-live=assertive when configured', async () => {
    teardown = manageNavAnnounce({ live: 'assertive' });
    navigate('/x');
    await tick();
    const region = document.getElementById(DEFAULT_ID)!;
    expect(region.getAttribute('aria-live')).toBe('assertive');
    expect(region.getAttribute('role')).toBe('alert');
  });

  it('reuses an existing region by id (does not duplicate)', async () => {
    const pre = document.createElement('div');
    pre.id = 'my-announce';
    pre.setAttribute('aria-live', 'polite');
    pre.textContent = 'previous';
    document.body.appendChild(pre);

    teardown = manageNavAnnounce({ regionId: 'my-announce' });
    navigate('/x');
    await tick();
    const all = document.querySelectorAll('#my-announce');
    expect(all.length).toBe(1);
    // User's existing aria-live wasn't overwritten.
    expect(pre.getAttribute('aria-live')).toBe('polite');
  });

  it('does not create the region until the first navigate fires', () => {
    teardown = manageNavAnnounce();
    expect(document.getElementById(DEFAULT_ID)).toBeNull();
  });
});

describe('manageNavAnnounce() — message text', () => {
  it('announces document.title when set', async () => {
    document.title = 'My Page';
    teardown = manageNavAnnounce();
    navigate('/x');
    await tick();
    const region = document.getElementById(DEFAULT_ID)!;
    expect(region.textContent).toBe('My Page');
  });

  it('falls back to url.pathname when title is empty', async () => {
    document.title = '';
    teardown = manageNavAnnounce();
    navigate('/users/42');
    await tick();
    const region = document.getElementById(DEFAULT_ID)!;
    expect(region.textContent).toBe('/users/42');
  });

  it('falls back to url.pathname when title is whitespace-only', async () => {
    document.title = '   \t  ';
    teardown = manageNavAnnounce();
    navigate('/users/42');
    await tick();
    const region = document.getElementById(DEFAULT_ID)!;
    expect(region.textContent).toBe('/users/42');
  });

  it('honors a custom message function', async () => {
    teardown = manageNavAnnounce({
      message: (url) => `You are now at ${url.pathname}`,
    });
    navigate('/about');
    await tick();
    const region = document.getElementById(DEFAULT_ID)!;
    expect(region.textContent).toBe('You are now at /about');
  });

  it('passes replace flag to message', async () => {
    const captured: boolean[] = [];
    teardown = manageNavAnnounce({
      message: (_url, replace) => {
        captured.push(replace);
        return 'x';
      },
    });
    navigate('/a');
    await tick();
    navigate('/b', { replace: true });
    await tick();
    expect(captured).toEqual([false, true]);
  });
});

describe('manageNavAnnounce() — re-announce on same text', () => {
  it('clears textContent first when the new message matches the old (forces AT re-read)', async () => {
    teardown = manageNavAnnounce({ message: () => 'static' });
    navigate('/a');
    await tick();
    const region = document.getElementById(DEFAULT_ID)!;
    expect(region.textContent).toBe('static');
    navigate('/b');
    await tick();
    await tick();
    await tick();
    expect(region.textContent).toBe('static');
  });

  it('a queued same-text restore does NOT clobber a subsequent different-text navigate', async () => {
    // Three navigations with text sequence (X, X, Y) — message() runs per
    // outer microtask after navigate() queues them, so an in-message
    // counter gives us deterministic interleave:
    //   MT 1 → "X"  (region empty → direct set)
    //   MT 2 → "X"  (region has "X" → clear + queue restore "X")
    //   MT 3 → "Y"  (region empty from MT 2's clear → direct set "Y")
    //
    // Without the per-nav token guard, MT 2's queued restore would fire
    // AFTER MT 3's direct set and overwrite "Y" with stale "X".
    let count = 0;
    teardown = manageNavAnnounce({
      message: () => {
        count++;
        return count <= 2 ? 'X' : 'Y';
      },
    });
    navigate('/a');
    navigate('/b');
    navigate('/c');
    // Flush all queued microtasks: outer MTs first, then inner restores.
    await tick();
    await tick();
    await tick();
    await tick();
    const region = document.getElementById(DEFAULT_ID)!;
    expect(region.textContent).toBe('Y');
  });
});

describe('manageNavAnnounce() — custom onNavigate', () => {
  it('replaces default behavior entirely', async () => {
    const calls: Array<{ pathname: string; replace: boolean }> = [];
    teardown = manageNavAnnounce({
      onNavigate: (url, replace) => calls.push({ pathname: url.pathname, replace }),
    });
    navigate('/a');
    await tick();
    navigate('/b', { replace: true });
    await tick();
    expect(calls).toEqual([
      { pathname: '/a', replace: false },
      { pathname: '/b', replace: true },
    ]);
    // No region was created — custom handler is responsible for any DOM.
    expect(document.getElementById(DEFAULT_ID)).toBeNull();
  });
});

describe('manageNavAnnounce() — teardown', () => {
  it('stops announcing after teardown', async () => {
    teardown = manageNavAnnounce({ message: () => 'hello' });
    navigate('/a');
    await tick();
    const region = document.getElementById(DEFAULT_ID)!;
    expect(region.textContent).toBe('hello');
    region.textContent = '';

    teardown!();
    teardown = null;

    navigate('/b');
    await tick();
    // Region remains in DOM (apps may reuse it).
    expect(document.getElementById(DEFAULT_ID)).not.toBeNull();
    expect(document.getElementById(DEFAULT_ID)!.textContent).toBe('');
  });

  it('does not run an already-queued microtask after teardown', async () => {
    // navigate() fires the onNavigate listener synchronously, which queues a
    // microtask that creates the region + writes the message. teardown()
    // arriving before that microtask drains must short-circuit — without an
    // active-flag guard, teardown is a footgun during HMR / route swaps.
    teardown = manageNavAnnounce({ message: () => 'leaked' });
    navigate('/a');
    teardown!();
    teardown = null;
    await tick();
    await tick();
    // No region was created, no leaked text.
    expect(document.getElementById(DEFAULT_ID)).toBeNull();
  });

  it('does not run a queued same-text restore after teardown', async () => {
    teardown = manageNavAnnounce({ message: () => 'same' });
    navigate('/a');
    await tick();
    const region = document.getElementById(DEFAULT_ID)!;
    expect(region.textContent).toBe('same');
    navigate('/b'); // queues outer MT; outer MT will queue inner restore MT
    teardown!();
    teardown = null;
    await tick();
    await tick();
    await tick();
    // The outer microtask cleared then queued a restore. Both must be
    // suppressed by teardown — region remains whatever it was when
    // teardown ran (either 'same' from before navigate, or '' if outer
    // microtask got to clear before teardown). Either way, no late write
    // to 'same' after teardown.
    expect(['same', '']).toContain(region.textContent ?? '');
    // Whatever the region holds at teardown is stable across further ticks.
    const snapshot = region.textContent;
    await tick();
    await tick();
    expect(region.textContent).toBe(snapshot);
  });
});

describe('manageNavAnnounce() — throw isolation', () => {
  it('isolates message() throws so subsequent navs still announce', async () => {
    let count = 0;
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      teardown = manageNavAnnounce({
        message: () => {
          count++;
          if (count === 1) throw new Error('boom');
          return 'recovered';
        },
      });
      navigate('/a');
      await tick();
      // Bad first nav must not break the listener — second nav still
      // creates the region and writes the recovered text.
      navigate('/b');
      await tick();
      const region = document.getElementById(DEFAULT_ID);
      expect(region).not.toBeNull();
      expect(region!.textContent).toBe('recovered');
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      console.error = origError;
    }
  });

  it('isolates custom onNavigate handler throws across subsequent navs', async () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      teardown = manageNavAnnounce({
        onNavigate: (url) => {
          calls.push(url.pathname);
          if (url.pathname === '/a') throw new Error('first-nav-throws');
        },
      });
      navigate('/a');
      await tick();
      navigate('/b');
      await tick();
      expect(calls).toEqual(['/a', '/b']);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      console.error = origError;
    }
  });
});

describe('manageNavAnnounce() — server', () => {
  it('returns a no-op teardown when document is unavailable', () => {
    const realDocument = globalThis.document;
    // @ts-expect-error — simulating Node.js env
    delete (globalThis as { document?: Document }).document;
    try {
      const t = manageNavAnnounce();
      expect(typeof t).toBe('function');
      expect(() => t()).not.toThrow();
    } finally {
      (globalThis as { document?: Document }).document = realDocument;
    }
  });
});
