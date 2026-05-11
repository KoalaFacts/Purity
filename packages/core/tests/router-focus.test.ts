// @vitest-environment jsdom
// Tests for manageNavFocus() — ADR 0016.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manageNavFocus, navigate } from '../src/index.ts';

let teardown: (() => void) | null = null;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  document.body.innerHTML = '';
});

afterEach(() => {
  teardown?.();
  teardown = null;
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('manageNavFocus() — default behavior', () => {
  it('focuses the first <main> element on navigate', async () => {
    document.body.innerHTML = '<main>content</main>';
    const main = document.querySelector('main')!;
    teardown = manageNavFocus();
    navigate('/somewhere');
    await Promise.resolve();
    expect(document.activeElement).toBe(main);
  });

  it('adds tabindex="-1" when not already present (landmark is focusable)', async () => {
    document.body.innerHTML = '<main>content</main>';
    const main = document.querySelector('main')!;
    expect(main.hasAttribute('tabindex')).toBe(false);
    teardown = manageNavFocus();
    navigate('/x');
    await Promise.resolve();
    expect(main.getAttribute('tabindex')).toBe('-1');
  });

  it('preserves an existing tabindex value', async () => {
    document.body.innerHTML = '<main tabindex="0">content</main>';
    const main = document.querySelector('main')!;
    teardown = manageNavFocus();
    navigate('/x');
    await Promise.resolve();
    expect(main.getAttribute('tabindex')).toBe('0');
  });

  it('focuses with { preventScroll: true } so it does not fight scroll restoration', async () => {
    document.body.innerHTML = '<main>content</main>';
    const main = document.querySelector('main')! as HTMLElement;
    let receivedOptions: FocusOptions | undefined;
    main.focus = function (this: HTMLElement, opts?: FocusOptions) {
      receivedOptions = opts;
    } as typeof main.focus;
    teardown = manageNavFocus();
    navigate('/x');
    await Promise.resolve();
    expect(receivedOptions?.preventScroll).toBe(true);
  });

  it('no-ops cleanly when no element matches the selector', async () => {
    // No <main>, no anything.
    teardown = manageNavFocus();
    // Mustn't throw.
    navigate('/x');
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
  });

  it('honors a custom selector', async () => {
    document.body.innerHTML = '<div class="app-root">content</div>';
    const root = document.querySelector('.app-root')! as HTMLElement;
    teardown = manageNavFocus({ selector: '.app-root' });
    navigate('/x');
    await Promise.resolve();
    expect(document.activeElement).toBe(root);
  });
});

describe('manageNavFocus() — hash target priority', () => {
  it('focuses the hash target element when URL has #fragment + element exists', async () => {
    document.body.innerHTML = '<main></main><section id="target"></section>';
    const section = document.getElementById('target')!;
    teardown = manageNavFocus();
    navigate('/page#target');
    await Promise.resolve();
    expect(document.activeElement).toBe(section);
  });

  it('URI-decodes the hash before lookup (matches manageNavScroll)', async () => {
    document.body.innerHTML = '<section id="café"></section>';
    const section = document.getElementById('café')!;
    teardown = manageNavFocus();
    navigate('/page#caf%C3%A9');
    await Promise.resolve();
    expect(document.activeElement).toBe(section);
  });

  it('falls back to the selector when the hash target is missing', async () => {
    document.body.innerHTML = '<main></main>';
    const main = document.querySelector('main')!;
    teardown = manageNavFocus();
    navigate('/page#missing');
    await Promise.resolve();
    expect(document.activeElement).toBe(main);
  });
});

describe('manageNavFocus() — custom handler', () => {
  it('replaces the default behavior entirely', async () => {
    const seen: Array<[string, boolean]> = [];
    teardown = manageNavFocus({
      onNavigate: (url, replace) => {
        seen.push([url.pathname, replace]);
      },
    });
    document.body.innerHTML = '<main></main>';
    const main = document.querySelector('main')!;
    navigate('/whatever');
    await Promise.resolve();
    expect(seen).toEqual([['/whatever', false]]);
    // Default behavior did NOT run — main element didn't get focus.
    expect(document.activeElement).not.toBe(main);
  });
});

describe('manageNavFocus() — lifecycle', () => {
  it('returns a teardown that stops handling future navs', async () => {
    document.body.innerHTML = '<main></main>';
    const main = document.querySelector('main')! as HTMLElement;
    let calls = 0;
    main.focus = function () {
      calls++;
    } as typeof main.focus;
    teardown = manageNavFocus();
    navigate('/first');
    await Promise.resolve();
    expect(calls).toBe(1);
    teardown();
    teardown = null;
    navigate('/second');
    await Promise.resolve();
    expect(calls).toBe(1);
  });
});
