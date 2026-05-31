// @vitest-environment jsdom
// ADR 0030 — manageTitle() tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { manageTitle, state } from '../src/index.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

let teardown: (() => void) | null = null;

beforeEach(() => {
  document.title = 'INITIAL';
});

afterEach(() => {
  teardown?.();
  teardown = null;
});

describe('manageTitle — SSR path (ADR 0030)', () => {
  it('emits a <title> tag into the SSR head accumulator', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      manageTitle(() => 'Hello World');
    } finally {
      popSSRRenderContext();
    }
    expect(ctx.head).toBeDefined();
    expect(ctx.head?.join('')).toContain('<title>Hello World</title>');
  });

  it('escapes HTML-special characters in the title', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      manageTitle(() => '<script>alert("xss")</script>');
    } finally {
      popSSRRenderContext();
    }
    const head = ctx.head?.join('') ?? '';
    expect(head).not.toContain('<script>');
    expect(head).toContain('&lt;script&gt;');
  });

  it('multiple calls emit multiple <title> tags (browser uses last per spec)', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      manageTitle(() => 'First');
      manageTitle(() => 'Second');
    } finally {
      popSSRRenderContext();
    }
    const head = ctx.head?.join('') ?? '';
    expect(head).toContain('<title>First</title>');
    expect(head).toContain('<title>Second</title>');
  });

  it('returns a no-op teardown on the server', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const td = manageTitle(() => 'X');
      expect(typeof td).toBe('function');
      // Calling it shouldn't throw.
      td();
    } finally {
      popSSRRenderContext();
    }
  });

  it('isolates throws from the title fn during SSR (no head entry added)', () => {
    // Regression: a throw inside fn() under SSR must not propagate out and
    // crash renderToString. Log via console.error and skip the entry,
    // matching head()'s own thunk-error isolation.
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(() => {
        manageTitle(() => {
          throw new Error('boom-ssr');
        });
      }).not.toThrow();
    } finally {
      popSSRRenderContext();
      console.error = origError;
    }
    expect((ctx.head ?? []).join('')).toBe('');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('coerces non-string return values to a string when emitting <title>', () => {
    // Regression: previously `escHtml` called `.replace` on the raw value;
    // a non-string return from `fn()` (e.g. a number from a signal) crashed
    // the SSR render. Should coerce safely.
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      manageTitle(() => 7 as unknown as string);
    } finally {
      popSSRRenderContext();
    }
    expect(ctx.head?.join('') ?? '').toContain('<title>7</title>');
  });
});

describe('manageTitle — client path (ADR 0030)', () => {
  it('writes document.title synchronously on first call', () => {
    teardown = manageTitle(() => 'Initial Client Title');
    expect(document.title).toBe('Initial Client Title');
  });

  it('updates document.title when a tracked signal changes', async () => {
    const name = state('Anonymous');
    teardown = manageTitle(() => `Hello ${name()}`);
    expect(document.title).toBe('Hello Anonymous');

    name('Alice');
    await tick();
    expect(document.title).toBe('Hello Alice');

    name('Bob');
    await tick();
    expect(document.title).toBe('Hello Bob');
  });

  it('returns a teardown that stops updating document.title', async () => {
    const name = state('X');
    teardown = manageTitle(() => `T: ${name()}`);
    expect(document.title).toBe('T: X');

    teardown();
    teardown = null;

    name('Y');
    await tick();
    // No update after teardown.
    expect(document.title).toBe('T: X');
  });

  it('does NOT revert document.title on teardown (per ADR 0030 non-feature)', () => {
    document.title = 'BEFORE';
    teardown = manageTitle(() => 'MANAGED');
    expect(document.title).toBe('MANAGED');
    teardown();
    teardown = null;
    // Documented: teardown stops updating but doesn't restore.
    expect(document.title).toBe('MANAGED');
  });

  it('isolates throws from the title fn on the initial client run', () => {
    // Regression: a throw inside fn() must not propagate out of
    // manageTitle on the synchronous initial run; the watch should
    // be created and the throw logged via console.error.
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    document.title = 'PRE-THROW';
    try {
      expect(() => {
        teardown = manageTitle(() => {
          throw new Error('boom-client');
        });
      }).not.toThrow();
    } finally {
      console.error = origError;
    }
    // Title left untouched on throw.
    expect(document.title).toBe('PRE-THROW');
    // A teardown was still returned so the caller can clean up.
    expect(typeof teardown).toBe('function');
    // The error was surfaced via console.error (not silently swallowed).
    expect(errors.length).toBeGreaterThan(0);
  });

  it('isolates throws from the title fn on subsequent reactive updates', async () => {
    // Regression: after a successful first run, a later throw in fn()
    // should be logged but must not break the watcher — once fn stops
    // throwing the next dep change must still drive document.title.
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const mode = state<'ok' | 'bad'>('ok');
      teardown = manageTitle(() => {
        if (mode() === 'bad') throw new Error('boom-update');
        return 'OK-TITLE';
      });
      expect(document.title).toBe('OK-TITLE');

      mode('bad');
      await tick();
      // Title untouched after the throw.
      expect(document.title).toBe('OK-TITLE');
      expect(errors.length).toBeGreaterThan(0);

      // Watcher must still be alive: fn returns clean again on next flip.
      mode('ok');
      await tick();
      expect(document.title).toBe('OK-TITLE');
    } finally {
      console.error = origError;
    }
  });

  it('coerces non-string return values to a string for document.title', async () => {
    // Regression: passing a fn that returns a non-string (e.g. number from
    // a count signal) should produce a string title, not the literal
    // `"undefined"` from setting `document.title = undefined`.
    const n = state(0);
    teardown = manageTitle(() => n() as unknown as string);
    expect(document.title).toBe('0');
    n(42);
    await tick();
    expect(document.title).toBe('42');
  });
});
