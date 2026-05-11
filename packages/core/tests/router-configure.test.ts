// @vitest-environment jsdom
// ADR 0027 — configureNavigation() consolidator tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureNavigation, currentPath, navigate } from '../src/index.ts';

let teardown: (() => void) | null = null;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  navigate('/');
  document.body.innerHTML = '';
});

afterEach(() => {
  teardown?.();
  teardown = null;
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

function clickLink(a: HTMLAnchorElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  a.dispatchEvent(event);
  return event;
}

function makeLink(href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  document.body.appendChild(a);
  return a;
}

describe('configureNavigation — defaults (ADR 0027)', () => {
  it('enables interceptLinks by default — same-origin <a> click intercepts', () => {
    teardown = configureNavigation();
    const a = makeLink('/about');
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(true);
    expect(currentPath()).toBe('/about');
  });

  it('returns a teardown that disposes all four helpers', () => {
    teardown = configureNavigation();
    teardown();
    teardown = null;
    // After teardown, intercept should be gone — clicks fall through to
    // the default browser handler. jsdom doesn't follow links, so we
    // verify by checking the click event isn't preventDefault'd.
    const a = makeLink('/somewhere');
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('configureNavigation — per-helper opt-out (ADR 0027)', () => {
  it('intercept: false skips interceptLinks (clicks reach the browser default)', () => {
    teardown = configureNavigation({ intercept: false });
    const a = makeLink('/about');
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(false);
  });

  it('setting all four to false makes the call a near-no-op', () => {
    teardown = configureNavigation({
      intercept: false,
      scroll: false,
      focus: false,
      transitions: false,
    });
    // No teardowns registered → calling teardown is harmless.
    teardown();
    teardown = null;
  });

  it('true explicitly enables a helper (same as omitted)', () => {
    teardown = configureNavigation({ intercept: true });
    const a = makeLink('/about');
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('configureNavigation — per-helper option pass-through (ADR 0027)', () => {
  it('intercept: { ... } forwards options to interceptLinks', () => {
    teardown = configureNavigation({
      intercept: { shouldIntercept: () => false }, // never intercept
    });
    const a = makeLink('/about');
    const event = clickLink(a);
    // shouldIntercept returned false → no intercept → browser handles default.
    expect(event.defaultPrevented).toBe(false);
  });

  it('focus: { selector } forwards to manageNavFocus', () => {
    // Set up a focusable landmark so manageNavFocus has somewhere to land.
    document.body.innerHTML = '<custom-landmark tabindex="-1">x</custom-landmark>';
    teardown = configureNavigation({
      focus: { selector: 'custom-landmark' },
    });
    // Trigger a navigation; manageNavFocus moves focus to the landmark.
    navigate('/somewhere');
    // jsdom focus is async via microtask; flush.
    return Promise.resolve().then(() => {
      expect(document.activeElement?.tagName.toLowerCase()).toBe('custom-landmark');
    });
  });

  it('announce: true enables the ARIA live region (ADR 0037)', async () => {
    document.title = 'My Page';
    teardown = configureNavigation({
      intercept: false,
      scroll: false,
      focus: false,
      transitions: false,
      announce: true,
    });
    navigate('/somewhere');
    await new Promise((r) => queueMicrotask(r));
    const region = document.getElementById('__purity_announce__');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe('My Page');
  });

  it('announce: { ... } forwards options to manageNavAnnounce', async () => {
    teardown = configureNavigation({
      intercept: false,
      scroll: false,
      focus: false,
      transitions: false,
      announce: { regionId: 'my-region', message: (url) => `at ${url.pathname}` },
    });
    navigate('/about');
    await new Promise((r) => queueMicrotask(r));
    const region = document.getElementById('my-region');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe('at /about');
    // Default region was NOT created.
    expect(document.getElementById('__purity_announce__')).toBeNull();
  });

  it('announce defaults to off — no live region without opting in', async () => {
    teardown = configureNavigation();
    navigate('/x');
    await new Promise((r) => queueMicrotask(r));
    expect(document.getElementById('__purity_announce__')).toBeNull();
  });
});
