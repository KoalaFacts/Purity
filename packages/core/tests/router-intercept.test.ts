// @vitest-environment jsdom
// Tests for interceptLinks() — ADR 0013.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentPath, interceptLinks, navigate } from '../src/index.ts';

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

function clickLink(a: HTMLAnchorElement, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  a.dispatchEvent(event);
  return event;
}

function makeLink(
  href: string,
  opts: { target?: string; download?: boolean; opt?: boolean; html?: string } = {},
): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  if (opts.target) a.setAttribute('target', opts.target);
  if (opts.download) a.setAttribute('download', '');
  if (opts.opt) a.setAttribute('data-no-intercept', '');
  if (opts.html) a.innerHTML = opts.html;
  document.body.appendChild(a);
  return a;
}

describe('interceptLinks() — default predicate', () => {
  it('intercepts a plain same-origin <a> click', () => {
    teardown = interceptLinks();
    const a = makeLink('/about');
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(true);
    expect(currentPath()).toBe('/about');
  });

  it('finds the <a> when the click target is a nested element', () => {
    teardown = interceptLinks();
    const a = makeLink('/nested', { html: '<span>Click <strong>me</strong></span>' });
    const inner = a.querySelector('strong')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    inner.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(currentPath()).toBe('/nested');
  });

  it('skips middle / right-button clicks', () => {
    teardown = interceptLinks();
    const a = makeLink('/x');
    const middle = clickLink(a, { button: 1 });
    expect(middle.defaultPrevented).toBe(false);
    expect(currentPath()).toBe('/');
  });

  it('skips clicks with modifier keys', () => {
    teardown = interceptLinks();
    const a = makeLink('/x');
    for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      const event = clickLink(a, { [mod]: true });
      expect(event.defaultPrevented, `${mod} should not be intercepted`).toBe(false);
    }
    expect(currentPath()).toBe('/');
  });

  it('skips target="_blank"', () => {
    teardown = interceptLinks();
    const a = makeLink('/x', { target: '_blank' });
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(false);
  });

  it('intercepts target="_self" (treats as default)', () => {
    teardown = interceptLinks();
    const a = makeLink('/self-target', { target: '_self' });
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(true);
    expect(currentPath()).toBe('/self-target');
  });

  it('skips download links', () => {
    teardown = interceptLinks();
    const a = makeLink('/file.pdf', { download: true });
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(false);
  });

  it('honors the data-no-intercept opt-out', () => {
    teardown = interceptLinks();
    const a = makeLink('/external-flow', { opt: true });
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(false);
  });

  it('skips cross-origin hrefs', () => {
    teardown = interceptLinks();
    const a = makeLink('https://other.example.com/whatever');
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(false);
  });

  it('skips same-page hash-only links', () => {
    teardown = interceptLinks();
    const a = makeLink('#section-2');
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(false);
  });

  it('skips clicks already defaultPrevented by another listener', () => {
    teardown = interceptLinks();
    const a = makeLink('/x');
    a.addEventListener('click', (e) => e.preventDefault());
    clickLink(a);
    // Other listener prevented it; our interception bails — currentPath
    // didn't change.
    expect(currentPath()).toBe('/');
  });
});

describe('interceptLinks() — custom predicate', () => {
  it('replaces the default predicate entirely', () => {
    // Custom predicate accepts everything (even cross-origin) — proves the
    // default-replace semantics rather than additive.
    teardown = interceptLinks({ shouldIntercept: () => true });
    const a = makeLink('/whatever', { target: '_blank' });
    const event = clickLink(a);
    expect(event.defaultPrevented).toBe(true);
  });

  it('predicate receives the click event and the matching anchor', () => {
    const seen: Array<[MouseEvent, HTMLAnchorElement]> = [];
    teardown = interceptLinks({
      shouldIntercept: (e, a) => {
        seen.push([e, a]);
        return false; // skip nav so currentPath doesn't change
      },
    });
    const link = makeLink('/y');
    clickLink(link);
    expect(seen).toHaveLength(1);
    expect(seen[0][1]).toBe(link);
  });
});

describe('interceptLinks() — lifecycle', () => {
  it('returns a teardown that removes the listener', () => {
    teardown = interceptLinks();
    const a = makeLink('/before-teardown');
    clickLink(a);
    expect(currentPath()).toBe('/before-teardown');

    // Tear down — subsequent clicks navigate natively (jsdom does not).
    teardown();
    teardown = null;
    navigate('/');
    const a2 = makeLink('/after-teardown');
    const event = clickLink(a2);
    expect(event.defaultPrevented).toBe(false);
    expect(currentPath()).toBe('/');
  });

  it('warns and no-ops on a second concurrent install', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    teardown = interceptLinks();
    const secondTeardown = interceptLinks();
    expect(warn).toHaveBeenCalled();
    // Second teardown is a no-op — clicking still navigates via the first
    // listener.
    secondTeardown();
    const a = makeLink('/still-works');
    clickLink(a);
    expect(currentPath()).toBe('/still-works');
    warn.mockRestore();
  });
});
