import { describe, expect, it } from 'vite-plus/test';
import { state } from '@purityjs/signals';
import { html } from '../src/compiler/compile.ts';
import { each, match, when } from '../src/control.ts';
import { component } from '../src/elements.ts';

let tagCounter = 0;
const tag = (base: string) => `p-types-${base}-${tagCounter++}`;

// CQ-09b: core tests are type-checked in CI (`tsconfig.tests.json`). These
// cases are the README's untyped patterns; each line below failed to compile
// under `strict` before (props defaulted to `Record<string, never>`, slots to
// `never`, control flow returned an internal union).
describe('public types — README patterns compile without generics', () => {
  it('destructures props and calls the default slot of an untyped component', () => {
    const Card = component(tag('card'), ({ title }, { default: body, header }) => {
      return html`<h2>${title}</h2>
        <header>${header()}</header>
        ${body()}`;
    });
    const host = document.createElement('div');
    host.appendChild(Card({ title: 'Hello' }, 'Body'));
    expect(host.textContent).toContain('Hello');
  });

  it('appends each(), when() and match() results directly', () => {
    const items = state([1, 2]);
    const on = state(true);
    const host = document.createElement('div');
    host.appendChild(
      each(items, (item) =>
        when(
          () => on(),
          () => html`<b>${item()}</b>`,
        ),
      ),
    );
    host.appendChild(match(() => (on() ? 'a' : 'b'), { a: () => html`<i>a</i>` }));
    expect(host.querySelectorAll('b').length).toBe(2);
    expect(host.querySelector('i')?.textContent).toBe('a');
  });
});
