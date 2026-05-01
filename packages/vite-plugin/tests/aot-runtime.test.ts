// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
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
    const fn = new Function('__purity_w__', 'document', `${body}\nreturn make;`);
    return {
      make: fn((cb: () => void) => {
        cb();
        return () => {};
      }, globalThis.document),
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

  it('hoisted template with reactive expression invokes the watch import', () => {
    const watches: Array<() => void> = [];
    const result = plugin.transform(
      `import { html } from '@purityjs/core';\nconst make = (fn) => html\`<div><p>\${fn}</p></div>\`;`,
      'app.ts',
    );
    const body = result!.code
      .replace(/^import .+$/gm, '')
      .replace(/^export /gm, '')
      .trim();
    const factory = new Function('__purity_w__', 'document', `${body}\nreturn make;`);
    const make = factory((cb: () => void) => {
      watches.push(cb);
      cb();
      return () => {};
    }, globalThis.document);
    const el = make(() => 'reactive-text') as HTMLElement;
    expect(watches.length).toBe(1);
    expect((el.querySelector('p') as HTMLElement).textContent).toBe('reactive-text');
  });
});
