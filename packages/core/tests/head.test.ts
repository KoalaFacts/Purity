// @vitest-environment jsdom
// Tests for `head()` — ADR 0008 Phase 1.
//
// SSR collection is covered in @purityjs/ssr's head.test.ts. This file
// covers the client-side contract: when there's no SSRRenderContext on
// the stack, head() is a no-op (the SSR-rendered <head> stays put).

import { describe, expect, it } from 'vitest';
import { head, html } from '../src/index.ts';

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
