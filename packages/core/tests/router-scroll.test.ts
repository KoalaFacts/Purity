// @vitest-environment jsdom
// Tests for onNavigate() + manageNavScroll(). ADR 0015.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manageNavScroll, navigate, onNavigate } from '../src/index.ts';

let teardown: (() => void) | null = null;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  document.body.innerHTML = '';
  window.scrollTo(0, 0);
});

afterEach(() => {
  teardown?.();
  teardown = null;
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  window.scrollTo(0, 0);
});

describe('onNavigate() — listener hook', () => {
  it('fires after navigate() with the post-nav URL + replace flag', () => {
    const calls: Array<[string, boolean]> = [];
    teardown = onNavigate((url, replace) => {
      calls.push([url.pathname, replace]);
    });
    navigate('/a');
    navigate('/b', { replace: true });
    expect(calls).toEqual([
      ['/a', false],
      ['/b', true],
    ]);
  });

  it('supports multiple subscribers', () => {
    const seen1: string[] = [];
    const seen2: string[] = [];
    const t1 = onNavigate((u) => seen1.push(u.pathname));
    const t2 = onNavigate((u) => seen2.push(u.pathname));
    navigate('/x');
    t1();
    t2();
    expect(seen1).toEqual(['/x']);
    expect(seen2).toEqual(['/x']);
  });

  it('isolates a throwing listener so siblings + navigate() still run', () => {
    // Without per-listener try/catch, a single throwing onNavigate
    // subscriber aborted the rest AND escaped to the navigate() caller.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    const t1 = onNavigate(() => {
      throw new Error('boom');
    });
    const t2 = onNavigate((u) => seen.push(u.pathname));
    expect(() => navigate('/iso')).not.toThrow();
    expect(seen).toEqual(['/iso']);
    expect(errSpy).toHaveBeenCalledWith('[purity] onNavigate listener threw:', expect.any(Error));
    t1();
    t2();
    errSpy.mockRestore();
  });

  it('teardown removes the listener', () => {
    const calls: string[] = [];
    const t = onNavigate((u) => calls.push(u.pathname));
    navigate('/before');
    t();
    navigate('/after');
    expect(calls).toEqual(['/before']);
  });

  it('does NOT fire on browser-driven popstate', () => {
    const calls: string[] = [];
    teardown = onNavigate((u) => calls.push(u.pathname));
    window.history.replaceState(null, '', '/somewhere');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(calls).toEqual([]);
  });

  it('does not fire when navigate() short-circuits (cross-origin)', () => {
    const calls: string[] = [];
    teardown = onNavigate((u) => calls.push(u.pathname));
    navigate('https://other.example.com/');
    expect(calls).toEqual([]);
  });

  it('does not throw on a malformed href; logs and no-ops', () => {
    // navigate() is called from intercepted clicks, where a crafted
    // <a href> could be unparseable, and from user code under any
    // circumstance. A bare `new URL(...)` throws TypeError — that
    // would escape to navigate()'s caller and break the nav handler.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: string[] = [];
    teardown = onNavigate((u) => calls.push(u.pathname));
    // These all throw on `new URL(href)` (invalid port / host):
    expect(() => navigate('http://[::]:99999/')).not.toThrow();
    expect(() => navigate('http://%')).not.toThrow();
    expect(calls).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('manageNavScroll() — default behavior', () => {
  it('scrolls to (0, 0) on plain navigate', async () => {
    teardown = manageNavScroll();
    const spy = vi.spyOn(window, 'scrollTo');
    navigate('/somewhere');
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockRestore();
  });

  it('scrolls to the hash target element when URL has #anchor', async () => {
    teardown = manageNavScroll();
    document.body.innerHTML = '<section id="target"></section>';
    const el = document.getElementById('target')!;
    // jsdom doesn't ship scrollIntoView; stub it on the prototype first.
    const scrollSpy = vi.fn();
    (el as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy;
    navigate('/page#target');
    await Promise.resolve();
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('falls back to (0, 0) when the hash element does not exist', async () => {
    teardown = manageNavScroll();
    const spy = vi.spyOn(window, 'scrollTo');
    navigate('/page#missing');
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockRestore();
  });

  it('URI-decodes the hash before looking it up', async () => {
    teardown = manageNavScroll();
    document.body.innerHTML = '<section id="café"></section>';
    const el = document.getElementById('café')!;
    // jsdom doesn't ship scrollIntoView; stub it on the prototype first.
    const scrollSpy = vi.fn();
    (el as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy;
    navigate('/page#caf%C3%A9');
    await Promise.resolve();
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('does not throw on a malformed-percent hash (falls back to top)', async () => {
    teardown = manageNavScroll();
    const spy = vi.spyOn(window, 'scrollTo');
    // `#%` makes decodeURIComponent throw; the handler must swallow it and
    // still scroll to top rather than leak an uncaught error.
    navigate('/page#%');
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockRestore();
  });

  it('fires on replace navs too', async () => {
    teardown = manageNavScroll();
    const spy = vi.spyOn(window, 'scrollTo');
    navigate('/replaced', { replace: true });
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockRestore();
  });

  it('teardown stops handling scrolls on future navs', async () => {
    teardown = manageNavScroll();
    const spy = vi.spyOn(window, 'scrollTo');
    navigate('/first');
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    teardown();
    teardown = null;
    spy.mockClear();
    navigate('/second');
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('manageNavScroll() — custom handler', () => {
  it('replaces the default behavior entirely', async () => {
    const seen: Array<[string, boolean]> = [];
    teardown = manageNavScroll({
      onNavigate: (url, replace) => {
        seen.push([url.pathname, replace]);
      },
    });
    const spy = vi.spyOn(window, 'scrollTo');
    navigate('/whatever');
    await Promise.resolve();
    // Custom handler ran; default scroll-to-top did NOT.
    expect(seen).toEqual([['/whatever', false]]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('isolates a throwing custom handler so it does not surface as an unhandled error', async () => {
    // The docs invite users to "perform whatever scroll action you want"
    // — a throwing handler must NOT escape as an unhandled microtask
    // rejection. Without the in-handler try/catch the throw escapes the
    // queueMicrotask and surfaces on the global error channel.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    teardown = manageNavScroll({
      onNavigate: () => {
        throw new Error('boom');
      },
    });
    navigate('/whatever');
    // Drain the microtask the handler is scheduled in.
    await Promise.resolve();
    // Give one more turn so any UNHANDLED rejection would have surfaced.
    await Promise.resolve();
    expect(errSpy).toHaveBeenCalledWith(
      '[purity] manageNavScroll handler threw:',
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  it('does not scroll when teardown happens before the deferred microtask drains', async () => {
    // Race: navigate() fires the onNavigate listener synchronously, which
    // queues a microtask. If teardown runs between the listener and the
    // microtask, the unsubscribed instance must NOT scroll — the user has
    // signalled "stop". Without the disposed guard the scroll leaks
    // through.
    teardown = manageNavScroll();
    const spy = vi.spyOn(window, 'scrollTo');
    navigate('/late');
    // Synchronously tear down BEFORE the microtask handler runs.
    teardown();
    teardown = null;
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
