// @vitest-environment jsdom
// ADR 0041 — localeSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localeSignal } from '../src/index.ts';
import { _resetLocaleSignal } from '../src/locale-signal.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

function makeSSRContext(): SSRRenderContext {
  return {
    pendingPromises: [],
    resolvedData: [],
    resolvedErrors: [],
    resourceCounter: 0,
    resolvedDataByKey: {},
    resolvedErrorsByKey: {},
    suspenseCounter: 0,
    boundaryStartTimes: new Map(),
  };
}

function setLanguage(lang: string): void {
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
});
