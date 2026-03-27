import { describe, expect, it, vi } from 'vitest';
import { mount, onDestroy, onMount } from '../src/component.ts';
import { component, reactiveTeleport, slot, teleport } from '../src/elements.ts';
import { html } from '../src/render.ts';
import { compute, state } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('component()', () => {
  it('creates a reusable component with props', () => {
    const Greeting = component((props) => {
      return html`<p>Hello, ${props.name}!</p>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`<div>${Greeting({ name: 'World' })}</div>`);

    expect(container.textContent).toContain('Hello, World!');
  });

  it('supports lifecycle hooks', async () => {
    const mounted = vi.fn();
    const destroyed = vi.fn();

    const Widget = component((props) => {
      onMount(mounted);
      onDestroy(destroyed);
      return html`<span>${props.text}</span>`;
    });

    const container = document.createElement('div');
    mount(() => html`<div>${Widget({ text: 'hi' })}</div>`, container);

    await tick();
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});

describe('slot()', () => {
  it('renders default slot with static content', () => {
    const Card = component((props) => {
      const body = slot();
      return html`<div class="card"><h2>${props.title}</h2>${body()}</div>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`${Card({ title: 'My Card' }, html`<p>Body content</p>`)}`);

    expect(container.querySelector('h2').textContent).toBe('My Card');
    expect(container.querySelector('p').textContent).toBe('Body content');
  });

  it('renders named slots', () => {
    const Layout = component(() => {
      const header = slot('header');
      const body = slot();
      const footer = slot('footer');

      return html`
        <header>${header()}</header>
        <main>${body()}</main>
        <footer>${footer()}</footer>
      `;
    });

    const container = document.createElement('div');
    container.appendChild(
      html`${Layout(
        {},
        {
          header: html`<h1>Title</h1>`,
          default: html`<p>Main content</p>`,
          footer: html`<small>Footer text</small>`,
        },
      )}`,
    );

    expect(container.querySelector('header h1').textContent).toBe('Title');
    expect(container.querySelector('main p').textContent).toBe('Main content');
    expect(container.querySelector('footer small').textContent).toBe('Footer text');
  });

  it('returns null for missing named slot', () => {
    const Box = component(() => {
      const header = slot('header');
      const body = slot();
      return html`<div>${header()}${body()}</div>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`${Box({}, html`<p>Default only</p>`)}`);

    expect(container.querySelector('p').textContent).toBe('Default only');
  });

  it('supports string slot content', () => {
    const Tag = component(() => {
      const body = slot();
      return html`<span>${body()}</span>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`${Tag({}, 'hello text')}`);

    expect(container.textContent).toContain('hello text');
  });

  it('OUT: component exposes data through slot', () => {
    const DataProvider = component(() => {
      const data = { message: 'from child', count: 42 };
      const body = slot();
      return html`<div>${body(data)}</div>`;
    });

    const container = document.createElement('div');
    container.appendChild(
      html`${DataProvider({}, ({ message, count }) => html`<p>${message} - ${count}</p>`)}`,
    );

    expect(container.textContent).toContain('from child - 42');
  });

  it('BOTH: component exposes state accessor, parent reads and writes', () => {
    const SearchBox = component(() => {
      const query = state('');
      const body = slot();
      return html`<div>
        <input class="search" bind:value=${query} />
        ${body({ query })}
      </div>`;
    });

    const container = document.createElement('div');
    container.appendChild(
      html`${SearchBox(
        {},
        ({ query }) => html`
        <span class="display">${() => query()}</span>
        <button class="clear" @click=${() => query('')}>Clear</button>
      `,
      )}`,
    );

    const clearBtn = container.querySelector('.clear');
    expect(clearBtn).not.toBeNull();
  });

  it('named scoped slots with exposed props', () => {
    const Table = component(() => {
      const cols = ['Name', 'Age'];
      const rows = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ];
      const header = slot('header');
      const row = slot('row');
      return html`<table>
        <thead>${header({ cols })}</thead>
        <tbody>${rows.map((r) => row({ row: r }))}</tbody>
      </table>`;
    });

    const container = document.createElement('div');
    container.appendChild(
      html`${Table(
        {},
        {
          header: ({ cols }) => html`<tr>${cols.map((c) => html`<th>${c}</th>`)}</tr>`,
          row: ({ row }) => html`<tr><td>${row.name}</td><td>${String(row.age)}</td></tr>`,
        },
      )}`,
    );

    expect(container.querySelectorAll('th').length).toBe(2);
    expect(container.querySelectorAll('td').length).toBe(4);
    expect(container.querySelector('th').textContent).toBe('Name');
    expect(container.querySelector('td').textContent).toBe('Alice');
  });

  it('slot render fn receives undefined when no exposed props', () => {
    const Wrapper = component(() => {
      const body = slot();
      return html`<div>${body()}</div>`;
    });

    const container = document.createElement('div');
    container.appendChild(
      html`${Wrapper(
        {},
        (exposed) => html`<p>${exposed === undefined ? 'no props' : 'has props'}</p>`,
      )}`,
    );

    expect(container.textContent).toContain('no props');
  });

  it('throws when called outside a component', () => {
    expect(() => slot()).toThrow('must be called inside a component');
  });
});

describe('teleport()', () => {
  it('renders content to a target element', async () => {
    const target = document.createElement('div');
    target.id = 'portal';
    document.body.appendChild(target);

    const container = document.createElement('div');
    container.appendChild(
      html`<div>${teleport('#portal', () => html`<p class="ported">Teleported!</p>`)}</div>`,
    );

    await tick();
    expect(target.querySelector('.ported')).not.toBeNull();
    expect(target.querySelector('.ported').textContent).toBe('Teleported!');

    document.body.removeChild(target);
  });

  it('accepts an Element as target', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const container = document.createElement('div');
    container.appendChild(html`<div>${teleport(target, () => html`<span>Direct</span>`)}</div>`);

    await tick();
    expect(target.querySelector('span').textContent).toBe('Direct');

    document.body.removeChild(target);
  });

  it('warns when target not found', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const container = document.createElement('div');
    container.appendChild(html`${teleport('#nonexistent', () => html`<p>Lost</p>`)}`);

    await tick();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
    warn.mockRestore();
  });

  it('works inside a component with slot', async () => {
    const target = document.createElement('div');
    target.id = 'modal-target';
    document.body.appendChild(target);

    const Modal = component(() => {
      const content = slot();
      teleport('#modal-target', () => content());
      return html`<!--modal-->`;
    });

    const container = document.createElement('div');
    mount(() => html`${Modal({}, html`<p class="modal-body">Hello Modal</p>`)}`, container);

    await tick();
    expect(target.querySelector('.modal-body')).not.toBeNull();
    expect(target.querySelector('.modal-body').textContent).toBe('Hello Modal');

    document.body.removeChild(target);
  });
});

describe('reactiveTeleport()', () => {
  it('updates teleported content reactively', async () => {
    const target = document.createElement('div');
    target.id = 'reactive-portal';
    document.body.appendChild(target);

    const visible = state(true);

    const container = document.createElement('div');
    container.appendChild(
      html`${reactiveTeleport('#reactive-portal', () =>
        visible() ? html`<p class="modal">Visible</p>` : null,
      )}`,
    );

    await tick();
    expect(target.querySelector('.modal')).not.toBeNull();

    visible(false);
    await tick();
    expect(target.querySelector('.modal')).toBeNull();

    visible(true);
    await tick();
    expect(target.querySelector('.modal')).not.toBeNull();

    document.body.removeChild(target);
  });
});
