// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { state } from '@purityjs/core';
import {
  enterHydration,
  exitHydration,
  inflateDeferred,
  isDeferred,
  renderCompiledTemplate,
} from '@purityjs/core/compiler';
import { purity } from '../src/index.ts';

describe('AOT output runs correctly under jsdom', () => {
  const plugin = purity();

  function evalAot(userCode: string): { make: (...args: any[]) => Node } {
    const result = plugin.transform(userCode, 'app.ts');
    if (!result) throw new Error('plugin returned null');
    // Strip top-level imports; expose the user-code body as a function we can call.
    const body = result.code
      .replace(/^import .+$/gm, '')
      .replace(/^export /gm, '')
      .trim();
    const fn = new Function('__purity_renderCompiled__', 'document', `${body}\nreturn make;`);
    return {
      make: fn(renderCompiledTemplate, globalThis.document),
    };
  }

  it('hoisted template produces correct DOM and reuses across calls', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = (label) => html\`<div><span>\${label}</span></div>\`;`,
    );
    const a = make('Hi') as HTMLElement;
    const b = make('Bye') as HTMLElement;
    expect((a.querySelector('span') as HTMLElement).textContent).toBe('Hi');
    expect((b.querySelector('span') as HTMLElement).textContent).toBe('Bye');
    // Both calls produce <div><span>...</span></div>
    expect(a.firstChild!.nodeName).toBe('DIV');
    expect(b.firstChild!.nodeName).toBe('DIV');
    // Different DOM trees — cloneNode produces fresh nodes per call
    expect(a).not.toBe(b);
  });

  it('hoisted simple template (single element) still works', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = (text) => html\`<p>\${text}</p>\`;`,
    );
    const a = make('first') as HTMLElement;
    const b = make('second') as HTMLElement;
    expect((a.firstChild as HTMLElement).textContent).toBe('first');
    expect((b.firstChild as HTMLElement).textContent).toBe('second');
  });

  it('hoisted template with reactive expression updates from a signal', async () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = (fn) => html\`<div><p>\${fn}</p></div>\`;`,
    );
    const value = state('reactive-text');
    const el = make(value) as HTMLElement;
    expect((el.querySelector('p') as HTMLElement).textContent).toBe('reactive-text');
    value('updated');
    await vi.waitFor(() =>
      expect((el.querySelector('p') as HTMLElement).textContent).toBe('updated'),
    );
  });

  it('hydrates the existing nodes without runtime code generation', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = (label) => html\`<p>\${label}</p>\`;`,
    );
    const root = document.createElement('div');
    root.innerHTML = '<p><!--[-->hello<!--]--></p>';
    const paragraph = root.firstChild;
    const text = paragraph?.childNodes[1];
    const originalFunction = globalThis.Function;
    try {
      globalThis.Function = (() => {
        throw new Error('runtime code generation during AOT hydration');
      }) as FunctionConstructor;
      enterHydration();
      let deferred: unknown;
      try {
        deferred = make('hello');
      } finally {
        exitHydration();
      }
      expect(isDeferred(deferred)).toBe(true);
      inflateDeferred(deferred as Parameters<typeof inflateDeferred>[0], root);
    } finally {
      globalThis.Function = originalFunction;
    }
    expect(root.firstChild).toBe(paragraph);
    expect(paragraph?.childNodes[1]).toBe(text);
    expect(paragraph?.textContent).toBe('hello');
  });

  it('creates an AOT template and nested template when no SSR nodes exist', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = (label) => html\`<li><strong>\${html\`<span>\${label}</span>\`}</strong></li>\`;`,
    );
    enterHydration();
    let deferred: unknown;
    try {
      deferred = make('new row');
    } finally {
      exitHydration();
    }
    const root = document.createDocumentFragment();
    inflateDeferred(deferred as Parameters<typeof inflateDeferred>[0], root);
    expect(root.querySelector('li strong span')?.textContent).toBe('new row');
  });

  it('starts after stripped suspense markers and the retained SSR style', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = (label) => html\`<button>\${label}</button>\`;`,
    );
    const root = document.createElement('div');
    root.innerHTML =
      '<!--s:0--><style>.x{color:red}</style><button><!--[-->Go<!--]--></button><!--/s:0-->';
    const button = root.querySelector('button')!;
    enterHydration();
    let deferred: unknown;
    try {
      deferred = make('Go');
    } finally {
      exitHydration();
    }
    inflateDeferred(deferred as Parameters<typeof inflateDeferred>[0], root, true);
    expect(root.querySelector('button')).toBe(button);
    expect(root.firstChild?.nodeName).toBe('STYLE');
    expect(root.querySelectorAll('button')).toHaveLength(1);
  });
});
