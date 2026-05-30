// @vitest-environment jsdom
// Tests for `head()` — ADR 0008 Phase 1.
//
// SSR collection is covered in @purityjs/ssr's head.test.ts. This file
// covers the client-side contract: when there's no SSRRenderContext on
// the stack, head() is a no-op (the SSR-rendered <head> stays put).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { head, html } from '../src/index.ts';
import { markSSRHtml } from '../src/compiler/ssr-runtime.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

function makeCtx(): SSRRenderContext {
  return {
    pendingPromises: [],
    resolvedData: [],
    resolvedErrors: [],
    resourceCounter: 0,
    resolvedDataByKey: {},
    resolvedErrorsByKey: {},
    suspenseCounter: 0,
    islandCounter: 0,
    boundaryStartTimes: new Map(),
    boundaryDeadlines: new Map(),
    timedOutBoundaries: new Set(),
  };
}

describe('head() — client behavior (Phase 1)', () => {
  it('is a silent no-op when called outside an SSR context', () => {
    // Nothing pushes an SSRRenderContext in client-only code paths.
    expect(() => head(html`<title>Test</title>`)).not.toThrow();
  });

  it('does not mutate document.head when called on the client', () => {
    const before = document.head.innerHTML;
    head(html`<meta name="ignored" content="value" />`);
    expect(document.head.innerHTML).toBe(before);
  });

  it('accepts thunks without invoking them when there is no SSR context', () => {
    // The thunk branch only runs when an SSR ctx exists — on the client
    // we short-circuit before calling it.
    let thunkCalled = false;
    head(() => {
      thunkCalled = true;
      return html`<title>nope</title>`;
    });
    expect(thunkCalled).toBe(false);
  });
});

describe('head() — audit-v2 in-file hardening', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('isolates throws from a head() thunk — does not poison the render', () => {
    const ctx = makeCtx();
    pushSSRRenderContext(ctx);
    try {
      // Append a clean entry first.
      head(markSSRHtml('<title>before</title>'));
      // The throwing thunk must not propagate out of head().
      expect(() =>
        head(() => {
          throw new Error('boom');
        }),
      ).not.toThrow();
      // Subsequent entries still land — head() didn't abort the pass.
      head(markSSRHtml('<meta name="x" content="y">'));
    } finally {
      popSSRRenderContext();
    }
    expect(ctx.head).toEqual(['<title>before</title>', '<meta name="x" content="y">']);
    // The throw was reported via console.error, never swallowed silently.
    expect(errorSpy).toHaveBeenCalled();
    const firstArg = errorSpy.mock.calls[0]?.[0];
    expect(String(firstArg)).toContain('head()');
  });

  it('drops a Promise value with a console.error instead of injecting [object Promise]', () => {
    const ctx = makeCtx();
    pushSSRRenderContext(ctx);
    try {
      // Direct promise.
      head(Promise.resolve(markSSRHtml('<title>late</title>')));
      // Thunk-returned promise — common mistake when wrapping an async fn.
      head(() => Promise.resolve(markSSRHtml('<title>also-late</title>')));
    } finally {
      popSSRRenderContext();
    }
    expect(ctx.head ?? []).toEqual([]);
    // Both attempts must surface as errors so devs can find the bug fast.
    expect(errorSpy).toHaveBeenCalledTimes(2);
    for (const call of errorSpy.mock.calls) {
      expect(String(call[0])).toContain('Promise');
    }
  });

  it('isolates throws from valueToHtml coercion (e.g. a getter that throws)', () => {
    const ctx = makeCtx();
    pushSSRRenderContext(ctx);
    try {
      // A thunk that returns an object whose Symbol.toPrimitive / toString
      // throws during String() coercion inside valueToHtml. head() must
      // catch and skip, not propagate.
      const evil = {
        toString(): string {
          throw new Error('coerce-fail');
        },
      };
      head(markSSRHtml('<title>safe</title>'));
      expect(() => head(evil)).not.toThrow();
      head(markSSRHtml('<meta name="ok" content="ok">'));
    } finally {
      popSSRRenderContext();
    }
    expect(ctx.head).toEqual(['<title>safe</title>', '<meta name="ok" content="ok">']);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('escapes raw-string content (not branded SSRHtml) — meta-tag injection is neutralized', () => {
    const ctx = makeCtx();
    pushSSRRenderContext(ctx);
    try {
      // A user passing a plain string instead of html`...` — head() must
      // run it through the standard escaping pipeline so an attacker-
      // supplied string can't smuggle a <script> tag into <head>.
      head('<script>alert(1)</script>');
    } finally {
      popSSRRenderContext();
    }
    const joined = (ctx.head ?? []).join('');
    expect(joined).not.toContain('<script>');
    expect(joined).toContain('&lt;script&gt;');
  });

  it('drops null / undefined / false / "" silently (no entry, no error)', () => {
    const ctx = makeCtx();
    pushSSRRenderContext(ctx);
    try {
      head(null);
      head(undefined);
      head(false);
      head('');
      head(() => null);
      head(() => undefined);
    } finally {
      popSSRRenderContext();
    }
    expect(ctx.head ?? []).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('honors LIFO context stack — pushes land on the inner frame only', () => {
    // A nested SSR pass (e.g. streaming boundary re-entry) must not leak
    // its head() entries into the outer frame. The SSR context stack is
    // LIFO; head() reads top-of-stack so entries land on the inner ctx.
    const outer = makeCtx();
    const inner = makeCtx();
    pushSSRRenderContext(outer);
    try {
      head(markSSRHtml('<title>outer-1</title>'));
      pushSSRRenderContext(inner);
      try {
        head(markSSRHtml('<title>inner-1</title>'));
        head(markSSRHtml('<meta name="inner" content="2">'));
      } finally {
        popSSRRenderContext();
      }
      head(markSSRHtml('<title>outer-2</title>'));
    } finally {
      popSSRRenderContext();
    }
    expect(outer.head).toEqual(['<title>outer-1</title>', '<title>outer-2</title>']);
    expect(inner.head).toEqual(['<title>inner-1</title>', '<meta name="inner" content="2">']);
  });
});
