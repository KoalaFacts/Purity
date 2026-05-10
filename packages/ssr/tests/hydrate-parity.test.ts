// @vitest-environment jsdom
// End-to-end parity test for marker-walking hydration.
//
// Renders a component to a string via `renderToString`, parses it into the
// DOM, then hydrates with the same component using the client-side `html`
// tag. Asserts (a) the SSR-rendered nodes survive hydration with their
// identity intact (no rebuild) and (b) reactive bindings attach to those
// surviving nodes.
//
// User code in real apps shares `html` across server and client (the Vite
// plugin AOT-compiles per target). Here we simulate that by parameterizing
// the user's component on the `html` tag — the test then drives it with
// the SSR variant for renderToString and the core variant for hydrate.

import { each, eachSSR, html as clientHtml, hydrate, state } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html as ssrHtml, renderToString } from '../src/index.ts';

type AnyHtml = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

async function ssrThenHydrate(
  Component: (htmlTag: AnyHtml, deps: unknown) => unknown,
  deps: unknown,
): Promise<{ host: HTMLElement; firstChildAfterSSR: ChildNode | null }> {
  const ssrOutput = await renderToString(() => Component(ssrHtml as AnyHtml, deps));
  const host = document.createElement('div');
  host.innerHTML = ssrOutput;
  document.body.appendChild(host);
  const firstChildAfterSSR = host.firstChild;
  hydrate(host, () => Component(clientHtml as AnyHtml, deps) as Node);
  return { host, firstChildAfterSSR };
}

describe('SSR → hydrate parity (marker-walking)', () => {
  it('preserves SSR root nodes and binds reactive text', async () => {
    const count = state(0);
    const App = (h: AnyHtml, _deps: unknown) => h`<div><p>Count: ${() => count()}</p></div>`;

    const { host, firstChildAfterSSR } = await ssrThenHydrate(App, null);

    // The outer <div> survives — same node reference.
    expect(host.firstChild).toBe(firstChildAfterSSR);
    expect(host.textContent).toBe('Count: 0');

    count(42);
    await Promise.resolve();
    expect(host.textContent).toBe('Count: 42');
  });

  it('preserves SSR DOM through nested templates', async () => {
    const name = state('Ada');
    const App = (h: AnyHtml, _deps: unknown) =>
      h`<section><header>${h`<h1>${() => name()}</h1>`}</header></section>`;

    const { host, firstChildAfterSSR } = await ssrThenHydrate(App, null);

    const ssrSection = firstChildAfterSSR as HTMLElement;
    const ssrHeader = ssrSection.querySelector('header');
    const ssrH1 = ssrSection.querySelector('h1');
    expect(ssrH1).not.toBeNull();
    expect(host.textContent).toBe('Ada');

    name('Bea');
    await Promise.resolve();
    // Same section + header + h1 survive.
    expect(host.firstChild).toBe(ssrSection);
    expect(ssrSection.querySelector('header')).toBe(ssrHeader);
    expect(ssrSection.querySelector('h1')).toBe(ssrH1);
    expect(host.textContent).toBe('Bea');
  });

  it('binds events to existing SSR elements', async () => {
    let clicks = 0;
    const App = (h: AnyHtml, _deps: unknown) => h`<button @click=${() => clicks++}>Click</button>`;

    const { host, firstChildAfterSSR } = await ssrThenHydrate(App, null);

    const btn = firstChildAfterSSR as HTMLButtonElement;
    expect(host.firstChild).toBe(btn);
    btn.click();
    btn.click();
    expect(clicks).toBe(2);
  });

  it('re-applies dynamic attributes reactively without replacing the element', async () => {
    const cls = state('warn');
    const App = (h: AnyHtml, _deps: unknown) => h`<p class=${() => cls()}>x</p>`;

    const { host, firstChildAfterSSR } = await ssrThenHydrate(App, null);

    const p = firstChildAfterSSR as HTMLElement;
    expect(p.getAttribute('class')).toBe('warn');

    cls('ok');
    await Promise.resolve();
    expect(host.firstChild).toBe(p);
    expect(p.getAttribute('class')).toBe('ok');
  });

  it('handles adjacent expression slots (comment-placeholder path)', async () => {
    const a = state('A');
    const b = state('B');
    const App = (h: AnyHtml, _deps: unknown) => h`<p>${() => a()}-${() => b()}</p>`;

    const { host, firstChildAfterSSR } = await ssrThenHydrate(App, null);
    const p = firstChildAfterSSR as HTMLElement;

    expect(host.textContent).toBe('A-B');
    a('X');
    b('Y');
    await Promise.resolve();
    expect(host.firstChild).toBe(p);
    expect(host.textContent).toBe('X-Y');
  });
});

// ---------------------------------------------------------------------------
// each() per-row hydration adoption
//
// Closes the ADR 0005 "Out of scope: Per-slot lossy fallback for control-flow
// helpers" gap. Without these, hydrating an `each()` slot rebuilt the whole
// list — a visible flash on long lists. With per-row markers + a deferred-
// each handle, the hydrator adopts existing SSR rows in place.
// ---------------------------------------------------------------------------

interface Todo {
  id: number;
  text: string;
}

function eachApp(items: ReturnType<typeof state<Todo[]>>): (h: AnyHtml) => unknown {
  return (h) => {
    // The SSR / client variants of each are dispatched by the @purityjs/vite-
    // plugin in real apps; here we resolve manually by checking which `h` is
    // bound. We rely on the fact that `eachSSR` is used in SSR-rendered code
    // and `each()` in client code, both with identical signatures.
    const list = h === (ssrHtml as AnyHtml) ? eachSSR : each;
    return h`<ul>${list(
      () => items(),
      (todo: () => Todo) => h`<li class="row">${() => todo().text}</li>`,
      (todo: Todo) => todo.id,
    )}</ul>`;
  };
}

describe('SSR → hydrate parity (each per-row reconciliation)', () => {
  it('adopts SSR rows in place — same node identities, no rebuild', async () => {
    const items = state<Todo[]>([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
      { id: 3, text: 'C' },
    ]);
    const App = eachApp(items);

    const ssrOutput = await renderToString(() => App(ssrHtml as AnyHtml));
    const host = document.createElement('div');
    host.innerHTML = ssrOutput;
    const ul = host.querySelector('ul')!;
    const ssrLis = Array.from(ul.querySelectorAll('li.row'));
    expect(ssrLis).toHaveLength(3);
    expect(ssrLis.map((li) => li.textContent)).toEqual(['A', 'B', 'C']);

    hydrate(host, () => App(clientHtml as AnyHtml) as Node);

    // Identical node references — no rebuild.
    const postLis = Array.from(ul.querySelectorAll('li.row'));
    expect(postLis).toEqual(ssrLis);
    expect(host.textContent?.replace(/\s+/g, '')).toBe('ABC');
  });

  it('re-renders text reactively against adopted SSR rows', async () => {
    const items = state<Todo[]>([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    const App = eachApp(items);

    const ssrOutput = await renderToString(() => App(ssrHtml as AnyHtml));
    const host = document.createElement('div');
    host.innerHTML = ssrOutput;
    const ssrLis = Array.from(host.querySelectorAll('li.row'));

    hydrate(host, () => App(clientHtml as AnyHtml) as Node);

    items([
      { id: 1, text: 'X' },
      { id: 2, text: 'Y' },
    ]);
    await Promise.resolve();

    // Same nodes — text mutated in place.
    const postLis = Array.from(host.querySelectorAll('li.row'));
    expect(postLis).toEqual(ssrLis);
    expect(postLis.map((li) => li.textContent)).toEqual(['X', 'Y']);
  });

  it('reorders adopted rows by key without recreating DOM', async () => {
    const items = state<Todo[]>([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
      { id: 3, text: 'C' },
    ]);
    const App = eachApp(items);

    const ssrOutput = await renderToString(() => App(ssrHtml as AnyHtml));
    const host = document.createElement('div');
    host.innerHTML = ssrOutput;
    const [li1, li2, li3] = Array.from(host.querySelectorAll('li.row'));

    hydrate(host, () => App(clientHtml as AnyHtml) as Node);

    items([
      { id: 3, text: 'C' },
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    await Promise.resolve();

    const after = Array.from(host.querySelectorAll('li.row'));
    expect(after).toEqual([li3, li1, li2]);
    expect(after.map((li) => li.textContent)).toEqual(['C', 'A', 'B']);
  });

  it('keeps SSR rows on append; new rows fill in', async () => {
    const items = state<Todo[]>([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    const App = eachApp(items);

    const ssrOutput = await renderToString(() => App(ssrHtml as AnyHtml));
    const host = document.createElement('div');
    host.innerHTML = ssrOutput;
    const [li1, li2] = Array.from(host.querySelectorAll('li.row'));

    hydrate(host, () => App(clientHtml as AnyHtml) as Node);

    items([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
      { id: 3, text: 'C' },
    ]);
    await Promise.resolve();

    const after = Array.from(host.querySelectorAll('li.row'));
    expect(after[0]).toBe(li1);
    expect(after[1]).toBe(li2);
    expect(after).toHaveLength(3);
    expect(after[2].textContent).toBe('C');
  });

  it('removes adopted rows when an item is dropped', async () => {
    const items = state<Todo[]>([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
      { id: 3, text: 'C' },
    ]);
    const App = eachApp(items);

    const ssrOutput = await renderToString(() => App(ssrHtml as AnyHtml));
    const host = document.createElement('div');
    host.innerHTML = ssrOutput;
    const [li1, , li3] = Array.from(host.querySelectorAll('li.row'));

    hydrate(host, () => App(clientHtml as AnyHtml) as Node);

    items([
      { id: 1, text: 'A' },
      { id: 3, text: 'C' },
    ]);
    await Promise.resolve();

    const after = Array.from(host.querySelectorAll('li.row'));
    expect(after).toEqual([li1, li3]);
  });

  it('handles empty SSR list followed by client-side append', async () => {
    const items = state<Todo[]>([]);
    const App = eachApp(items);

    const ssrOutput = await renderToString(() => App(ssrHtml as AnyHtml));
    const host = document.createElement('div');
    host.innerHTML = ssrOutput;
    expect(host.querySelectorAll('li.row')).toHaveLength(0);

    hydrate(host, () => App(clientHtml as AnyHtml) as Node);

    items([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    await Promise.resolve();

    expect(Array.from(host.querySelectorAll('li.row')).map((li) => li.textContent)).toEqual([
      'A',
      'B',
    ]);
  });

  it('handles keys with dashes, slashes and unicode without collisions', async () => {
    interface Tagged {
      id: string;
      label: string;
    }
    const items = state<Tagged[]>([
      { id: 'a-b', label: 'one' },
      { id: 'a--b', label: 'two' },
      { id: 'café/3', label: 'three' },
    ]);
    const App = (h: AnyHtml) => {
      const list = h === (ssrHtml as AnyHtml) ? eachSSR : each;
      return h`<ul>${list(
        () => items(),
        (item: () => Tagged) => h`<li class="row">${() => item().label}</li>`,
        (item: Tagged) => item.id,
      )}</ul>`;
    };

    const ssrOutput = await renderToString(() => App(ssrHtml as AnyHtml));
    const host = document.createElement('div');
    host.innerHTML = ssrOutput;
    const ssrLis = Array.from(host.querySelectorAll('li.row'));
    expect(ssrLis.map((li) => li.textContent)).toEqual(['one', 'two', 'three']);

    hydrate(host, () => App(clientHtml as AnyHtml) as Node);

    const postLis = Array.from(host.querySelectorAll('li.row'));
    // Same SSR nodes adopted — encoding round-tripped each key intact.
    expect(postLis).toEqual(ssrLis);
  });

  it('falls back to fresh DOM when hydration data diverges from SSR', async () => {
    const ssrItems: Todo[] = [
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ];
    const clientItems: Todo[] = [
      { id: 10, text: 'X' },
      { id: 20, text: 'Y' },
    ];

    // Render SSR with one set of data, then hydrate with a different list —
    // simulates real-world data drift. Adoption should fall through to the
    // fresh-DOM path per row, and the page should still end up correct.
    const ssrOutput = await renderToString(
      () =>
        ssrHtml`<ul>${eachSSR(
          () => ssrItems,
          (item: () => Todo) => ssrHtml`<li class="row">${() => item().text}</li>`,
          (item: Todo) => item.id,
        )}</ul>`,
    );
    const host = document.createElement('div');
    host.innerHTML = ssrOutput;

    const items = state(clientItems);
    hydrate(
      host,
      () =>
        clientHtml`<ul>${each(
          () => items(),
          (item: () => Todo) => clientHtml`<li class="row">${() => item().text}</li>`,
          (item: Todo) => item.id,
        )}</ul>` as Node,
    );

    expect(Array.from(host.querySelectorAll('li.row')).map((li) => li.textContent)).toEqual([
      'X',
      'Y',
    ]);
  });
});
