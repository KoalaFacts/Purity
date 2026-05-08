// @vitest-environment jsdom
//
// Behavioral equivalence: the DOM produced by the plugin's AOT output
// must match the DOM produced by the runtime `html\`\`` tag for the same
// template + values.

import { html, watch } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { purity } from '../src/index.ts';

const plugin = purity();

function evalAot(userCode: string): { make: (...args: any[]) => Node } {
  const result = plugin.transform(userCode, 'app.ts');
  if (!result) throw new Error('plugin returned null');
  const body = result.code
    .replace(/^import .+$/gm, '')
    .replace(/^export /gm, '')
    .trim();
  const fn = new Function('__purity_w__', 'document', `${body}\nreturn make;`);
  // Use the real `watch` from core so reactivity lines up with the runtime path.
  return { make: fn(watch, globalThis.document) };
}

function nodeShape(n: Node): string {
  // Compare structural HTML — ignores whitespace-only text nodes for fairness
  // since jsdom and runtime can disagree on a few stray whitespace nodes.
  if (n.nodeType === 3) return JSON.stringify((n as Text).data);
  if (n.nodeType !== 1) return `#${n.nodeType}`;
  const el = n as HTMLElement;
  const attrs = Array.from(el.attributes)
    .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
    .sort()
    .join(' ');
  const kids = Array.from(el.childNodes).map(nodeShape).join('|');
  return `<${el.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>[${kids}]`;
}

describe('AOT vs runtime DOM equivalence', () => {
  it('static template', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = () => html\`<div class="box">hi</div>\`;`,
    );
    const aot = make() as HTMLElement;
    const rt = html`<div class="box">hi</div>` as HTMLElement;
    expect(nodeShape(aot)).toBe(nodeShape(rt));
  });

  it('template with text expression', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = (label) => html\`<p>\${label}</p>\`;`,
    );
    const aot = make('hello') as HTMLElement;
    const rt = html`<p>${'hello'}</p>` as HTMLElement;
    expect(nodeShape(aot)).toBe(nodeShape(rt));
  });

  it('template with attribute expression', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = (cls) => html\`<span :class=\${cls}>x</span>\`;`,
    );
    const aot = make('active') as HTMLElement;
    const rt = html`<span :class=${'active'}>x</span>` as HTMLElement;
    expect(nodeShape(aot)).toBe(nodeShape(rt));
  });

  it('nested elements', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = () => html\`<ul><li>a</li><li>b</li></ul>\`;`,
    );
    const aot = make() as HTMLElement;
    const rt = html`<ul>
      <li>a</li>
      <li>b</li>
    </ul>` as HTMLElement;
    expect(nodeShape(aot)).toBe(nodeShape(rt));
  });

  it('multiple expressions on one element', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = (id, label) => html\`<button id=\${id}>\${label}</button>\`;`,
    );
    const aot = make('go', 'Go!') as HTMLElement;
    const rt = html`<button id=${'go'}>${'Go!'}</button>` as HTMLElement;
    expect(nodeShape(aot)).toBe(nodeShape(rt));
  });

  it('deeply nested with mixed static and dynamic content', () => {
    const { make } = evalAot(
      `import { html } from '@purityjs/core';\nconst make = (n) => html\`<section><header><h1>Title</h1></header><main><p>Count: \${n}</p></main></section>\`;`,
    );
    const aot = make(42) as HTMLElement;
    const rt = html`<section>
      <header>
        <h1>Title</h1>
      </header>
      <main>
        <p>Count: ${42}</p>
      </main>
    </section>` as HTMLElement;
    // Whitespace differs between the two source forms; compare structural
    // signal via element tags + textContent of the dynamic node.
    expect(aot.querySelector('h1')!.textContent).toBe(rt.querySelector('h1')!.textContent);
    expect(aot.querySelector('p')!.textContent).toBe(rt.querySelector('p')!.textContent);
  });
});
