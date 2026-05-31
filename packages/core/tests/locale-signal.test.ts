// @vitest-environment jsdom
// ADR 0041 — localeSignal tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localeSignal, watch } from '../src/index.ts';
import { _resetLocaleSignal } from '../src/locale-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

function setLanguage(lang: unknown): void {
  Object.defineProperty(navigator, 'language', { configurable: true, get: () => lang });
}

beforeEach(() => {
  _resetLocaleSignal();
  setLanguage('en-US');
});

afterEach(() => {
  _resetLocaleSignal();
});

describe('localeSignal (ADR 0041)', () => {
  it('returns a constant `en` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(localeSignal()()).toBe('en');
    } finally {
      popSSRRenderContext();
    }
  });

  it('reflects navigator.language on first read', () => {
    setLanguage('fr-FR');
    expect(localeSignal()()).toBe('fr-FR');
  });

  it('updates on languagechange event', () => {
    setLanguage('en-US');
    const s = localeSignal();
    expect(s()).toBe('en-US');
    setLanguage('de-DE');
    window.dispatchEvent(new Event('languagechange'));
    expect(s()).toBe('de-DE');
  });

  it('returns the same singleton across calls', () => {
    expect(localeSignal()).toBe(localeSignal());
  });

  it('does not throw when `navigator` is undefined', () => {
    const orig = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
    try {
      expect(() => localeSignal()()).not.toThrow();
      expect(localeSignal()()).toBe('en');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: orig });
    }
  });

  it('coerces a non-string `navigator.language` to a string (`en` fallback)', () => {
    setLanguage(undefined);
    const v = localeSignal()();
    expect(typeof v).toBe('string');
    expect(v).toBe('en');
  });

  it('coerces a null `navigator.language` to the `en` fallback', () => {
    setLanguage(null);
    expect(localeSignal()()).toBe('en');
  });

  it('coerces an empty-string `navigator.language` to the `en` fallback', () => {
    setLanguage('');
    expect(localeSignal()()).toBe('en');
  });

  it('coerces a non-string (e.g. array) `navigator.language` to the `en` fallback', () => {
    setLanguage(['en-US'] as unknown as string);
    expect(localeSignal()()).toBe('en');
  });

  it('_resetLocaleSignal detaches the listener (no leak across resets)', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    try {
      localeSignal();
      const addsAfterFirst = addSpy.mock.calls.filter((c) => c[0] === 'languagechange').length;
      expect(addsAfterFirst).toBe(1);

      _resetLocaleSignal();
      const removes = removeSpy.mock.calls.filter((c) => c[0] === 'languagechange').length;
      expect(removes).toBe(1);

      // Re-binding after reset adds exactly one more listener — no drift.
      localeSignal();
      const addsAfterSecond = addSpy.mock.calls.filter((c) => c[0] === 'languagechange').length;
      expect(addsAfterSecond).toBe(2);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it('does not double-bind the listener on repeated calls', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    try {
      localeSignal();
      localeSignal();
      localeSignal();
      const adds = addSpy.mock.calls.filter((c) => c[0] === 'languagechange').length;
      expect(adds).toBe(1);
    } finally {
      addSpy.mockRestore();
    }
  });

  it('rolls back cleanly if `addEventListener` throws (no half-bound state)', () => {
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string) => {
      if (type === 'languagechange') throw new Error('boom');
    }) as unknown as typeof window.addEventListener);
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      setLanguage('fr-FR');
      // Must not throw to the caller — falls back to a non-reactive computed.
      const s = localeSignal();
      expect(s()).toBe('fr-FR');
      // Singleton was rolled back: a follow-up call retries and is not pinned
      // to a stale, listener-less computed.
      addSpy.mockRestore();
      const addSpy2 = vi.spyOn(window, 'addEventListener');
      const s2 = localeSignal();
      const adds = addSpy2.mock.calls.filter((c) => c[0] === 'languagechange').length;
      expect(adds).toBe(1);
      setLanguage('de-DE');
      window.dispatchEvent(new Event('languagechange'));
      expect(s2()).toBe('de-DE');
      addSpy2.mockRestore();
    } finally {
      consoleErr.mockRestore();
    }
  });

  it('isolates throws inside a downstream watcher from the dispatch loop', async () => {
    setLanguage('en-US');
    const s = localeSignal();
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    let threwOnce = false;
    const dispose = watch(() => {
      const v = s();
      seen.push(v);
      if (v === 'de-DE' && !threwOnce) {
        threwOnce = true;
        throw new Error('boom');
      }
    });
    try {
      setLanguage('de-DE');
      window.dispatchEvent(new Event('languagechange'));
      await tick();
      // Signal still reactive after a watcher throws — flip to fr-FR still observable.
      setLanguage('fr-FR');
      window.dispatchEvent(new Event('languagechange'));
      await tick();
      expect(seen).toContain('de-DE');
      expect(seen[seen.length - 1]).toBe('fr-FR');
    } finally {
      dispose();
      consoleErr.mockRestore();
    }
  });
});
