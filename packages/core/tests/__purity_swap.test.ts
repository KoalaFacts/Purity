// @vitest-environment jsdom
// Tests for __purity_swap — ADR 0006 Phase 3 client splice helper.
//
// The helper exists in two forms: a typed TS function (`__purity_swap`) used
// by tests / non-streamed bundles, and an inline source string
// (`PURITY_SWAP_SOURCE`) injected by renderToStream(). These tests cover
// both forms and assert they share semantics, since drift between them
// silently breaks streaming hydration.
//
// Audit-v2 hardening checks:
//   - Rejects non-safe-integer ids (NaN, Infinity, negative, fractional, non-number)
//   - Treats missing document.body as a no-op (does not throw)
//   - Isolates DOM-op throws so the inline `<script>` doesn't crash
//   - Re-running on the same id is a no-op (template already consumed)
//   - Source string mirrors the typed function exactly

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __purity_swap, PURITY_SWAP_SOURCE } from '../src/__purity_swap.ts';

function setupBoundary(id: number, fallbackHTML: string, resolvedHTML: string): void {
  document.body.innerHTML =
    `<div id="root"><!--s:${id}-->${fallbackHTML}<!--/s:${id}--></div>` +
    `<template id="purity-s-${id}">${resolvedHTML}</template>`;
}

// Loads the inline source string into a fresh function bound to the current
// window. Mirrors the way renderToStream() injects PURITY_SWAP_SOURCE.
function loadSwapFromSource(): (n: number) => void {
  // The source assigns to `window.__purity_swap` as a side-effect.
  // Wipe any prior binding first so we know the source set it.
  delete (window as unknown as { __purity_swap?: unknown }).__purity_swap;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(PURITY_SWAP_SOURCE)();
  const fn = (window as unknown as { __purity_swap?: (n: number) => void }).__purity_swap;
  if (!fn) throw new Error('PURITY_SWAP_SOURCE did not install window.__purity_swap');
  return fn;
}

describe('__purity_swap — typed function', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('splices template content into the boundary, removing fallback', () => {
    setupBoundary(1, '<span class="fb">loading</span>', '<span class="ok">done</span>');
    __purity_swap(1);
    const root = document.getElementById('root')!;
    expect(root.querySelector('.fb')).toBeNull();
    expect(root.querySelector('.ok')).not.toBeNull();
    // Markers still present (only fallback between them is replaced).
    const comments: string[] = [];
    const tw = document.createTreeWalker(root, 128 /* SHOW_COMMENT */);
    let n = tw.nextNode();
    while (n) {
      comments.push((n as Comment).data);
      n = tw.nextNode();
    }
    expect(comments).toEqual(['s:1', '/s:1']);
    expect(document.getElementById('purity-s-1')).toBeNull();
  });

  it('is a no-op when the template is missing', () => {
    document.body.innerHTML = '<div id="root"><!--s:2-->fb<!--/s:2--></div>';
    expect(() => __purity_swap(2)).not.toThrow();
    expect(document.getElementById('root')!.textContent).toBe('fb');
  });

  it('is a no-op on a second call for the same id (already swapped)', () => {
    setupBoundary(3, 'fb', '<b>done</b>');
    __purity_swap(3);
    const after = document.getElementById('root')!.innerHTML;
    expect(() => __purity_swap(3)).not.toThrow();
    expect(document.getElementById('root')!.innerHTML).toBe(after);
  });

  it('rejects non-safe-integer ids without throwing or scanning', () => {
    // Build a template + matching markers that NaN/Infinity COULD accidentally
    // match via string concat ("purity-s-NaN", "s:NaN"). The hardened
    // implementation must refuse to touch them.
    document.body.innerHTML =
      '<div id="root"><!--s:NaN-->fb<!--/s:NaN--></div>' +
      '<template id="purity-s-NaN"><b>boom</b></template>';
    expect(() => __purity_swap(Number.NaN)).not.toThrow();
    expect(() => __purity_swap(Infinity)).not.toThrow();
    expect(() => __purity_swap(-1)).not.toThrow();
    expect(() => __purity_swap(1.5)).not.toThrow();
    // No-op semantics: the would-be-replaced fallback survives, and the
    // template is still in the document (untouched).
    expect(document.getElementById('root')!.textContent).toBe('fb');
    expect(document.getElementById('purity-s-NaN')).not.toBeNull();
  });

  it('does not throw when document.body is unavailable', () => {
    // Simulate a script that runs before body parsing — TreeWalker on a
    // null root throws a TypeError. The hardened helper must bail.
    // Stage a template so we get past the early-return on `!tpl`.
    document.body.innerHTML = '<template id="purity-s-99"><b>x</b></template>';
    const realBody = document.body;
    Object.defineProperty(document, 'body', { configurable: true, get: () => null });
    try {
      expect(() => __purity_swap(99)).not.toThrow();
    } finally {
      Object.defineProperty(document, 'body', { configurable: true, value: realBody });
    }
  });

  it('isolates DOM-op throws and logs via console.error', () => {
    setupBoundary(4, 'fb', '<b>ok</b>');
    const root = document.getElementById('root')!;
    // Make insertBefore on the boundary parent throw.
    const origInsertBefore = root.insertBefore;
    root.insertBefore = () => {
      throw new Error('synthetic');
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => __purity_swap(4)).not.toThrow();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      root.insertBefore = origInsertBefore;
      errSpy.mockRestore();
    }
  });

  it('only matches exact marker data (no s:1 / s:10 prefix collision)', () => {
    document.body.innerHTML =
      '<div id="root">' +
      '<!--s:10-->ten-fb<!--/s:10-->' +
      '<!--s:1-->one-fb<!--/s:1-->' +
      '</div>' +
      '<template id="purity-s-1"><span class="one">ONE</span></template>';
    __purity_swap(1);
    const root = document.getElementById('root')!;
    // s:10 boundary untouched.
    expect(root.innerHTML).toContain('ten-fb');
    expect(root.querySelector('.one')).not.toBeNull();
  });
});

describe('PURITY_SWAP_SOURCE — inline string parity', () => {
  let origSwap: unknown;

  beforeEach(() => {
    document.body.innerHTML = '';
    origSwap = (window as unknown as { __purity_swap?: unknown }).__purity_swap;
  });

  afterEach(() => {
    if (origSwap === undefined) {
      delete (window as unknown as { __purity_swap?: unknown }).__purity_swap;
    } else {
      (window as unknown as { __purity_swap: unknown }).__purity_swap = origSwap;
    }
  });

  it('installs exactly window.__purity_swap (no other globals leaked)', () => {
    const before = new Set(Object.keys(window));
    loadSwapFromSource();
    const after = new Set(Object.keys(window));
    const added = [...after].filter((k) => !before.has(k));
    expect(added).toEqual(['__purity_swap']);
  });

  it('inline source splices identically to the typed function', () => {
    setupBoundary(7, '<span class="fb">x</span>', '<span class="ok">y</span>');
    const fn = loadSwapFromSource();
    fn(7);
    const root = document.getElementById('root')!;
    expect(root.querySelector('.fb')).toBeNull();
    expect(root.querySelector('.ok')).not.toBeNull();
    expect(document.getElementById('purity-s-7')).toBeNull();
  });

  it('inline source is a no-op for missing template', () => {
    document.body.innerHTML = '<div id="root">untouched</div>';
    const fn = loadSwapFromSource();
    expect(() => fn(404)).not.toThrow();
    expect(document.getElementById('root')!.textContent).toBe('untouched');
  });

  it('inline source rejects non-safe-integer ids', () => {
    document.body.innerHTML =
      '<div id="root"><!--s:NaN-->fb<!--/s:NaN--></div>' +
      '<template id="purity-s-NaN"><b>boom</b></template>';
    const fn = loadSwapFromSource();
    expect(() => fn(Number.NaN)).not.toThrow();
    expect(() => fn(Infinity)).not.toThrow();
    expect(() => fn(-1)).not.toThrow();
    expect(document.getElementById('root')!.textContent).toBe('fb');
  });
});
