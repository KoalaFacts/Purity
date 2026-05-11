// @vitest-environment jsdom
// ADR 0030 — manageTitle() tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { manageTitle, state } from '../src/index.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

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
});
