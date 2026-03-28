import { describe, expect, it, vi } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { mount, onDestroy, onMount } from '../src/component.ts';
import { component, slot, teleport } from '../src/elements.ts';
import { compute, state } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));
let tagCounter = 0;
const tag = (base) => `p-${base}-${tagCounter++}`;

describe('component() with tag name', () => {
  it('creates a component with props (programmatic)', () => {
    const Greeting = component(tag('greeting'), ({ name }) => {
      return html`<p>Hello, ${name}!</p>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`<div>${Greeting({ name: 'World' })}</div>`);
    expect(container.textContent).toContain('Hello, World!');
  });

  it('supports lifecycle hooks', async () => {
    const mounted = vi.fn();

    const Widget = component(tag('widget'), ({ text }) => {
      onMount(mounted);
      return html`<span>${text}</span>`;
    });

    const container = document.createElement('div');
    mount(() => html`<div>${Widget({ text: 'hi' })}</div>`, container);

    await tick();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('registers as a custom element', () => {
    const name = tag('regtest');
    component(name, () => html`<p>test</p>`);

    expect(customElements.get(name)).toBeDefined();
  });

  it('works as custom element in HTML', async () => {
    const name = tag('card');
    component(name, ({ title }, { default: body }) => {
      return html`<div class="card"><h2>${title}</h2>${body()}</div>`;
    });

    const container = document.createElement('div');
    const el = document.createElement(name);
    el.title = 'My Card';
    el.textContent = 'Body content';
    container.appendChild(el);
    document.body.appendChild(container);

    await tick();

    // Custom element should have rendered
    expect(el.shadowRoot.querySelector('.card')).not.toBeNull();

    document.body.removeChild(container);
  });
});

describe('slots — callback syntax', () => {
  it('consumer fills default slot via callback', () => {
    const Card = component(tag('sc1'), ({ title }, { default: body }) => {
      return html`<div class="card"><h2>${title}</h2>${body()}</div>`;
    });

    const container = document.createElement('div');
    container.appendChild(
      html`${Card({ title: 'Hi' }, ({ default: fill }) => fill(html`<p>Body</p>`))}`,
    );

    expect(container.querySelector('h2').textContent).toBe('Hi');
    expect(container.querySelector('p').textContent).toBe('Body');
  });

  it('consumer fills named slots via callback', () => {
    const Layout = component(tag('sc2'), (_props, { header, default: body, footer }) => {
      return html`
        <header>${header()}</header>
        <main>${body()}</main>
        <footer>${footer()}</footer>
      `;
    });

    const container = document.createElement('div');
    container.appendChild(
      html`${Layout({}, ({ header, default: body, footer }) => {
        header(html`<h1>Title</h1>`);
        body(html`<p>Main</p>`);
        footer(html`<small>Foot</small>`);
      })}`,
    );

    expect(container.querySelector('header h1').textContent).toBe('Title');
    expect(container.querySelector('main p').textContent).toBe('Main');
    expect(container.querySelector('footer small').textContent).toBe('Foot');
  });

  it('component exposes data to consumer callback', () => {
    const Form = component(tag('sc3'), (_props, { default: body }) => {
      const isValid = compute(() => true);
      return {
        view: html`<form>${body()}</form>`,
        expose: { validate: isValid },
      };
    });

    const container = document.createElement('div');
    container.appendChild(
      html`${Form({}, ({ validate }) => {
        return html`<span class="v">${() => (validate() ? 'valid' : 'invalid')}</span>`;
      })}`,
    );

    expect(container.querySelector('.v').textContent).toBe('valid');
  });
});

describe('slots — map syntax', () => {
  it('renders with map-style slots', () => {
    const Layout = component(tag('sm1'), (_props, { header, default: body }) => {
      return html`<header>${header()}</header><main>${body()}</main>`;
    });

    const container = document.createElement('div');
    container.appendChild(
      html`${Layout(
        {},
        {
          header: html`<h1>Title</h1>`,
          default: html`<p>Main</p>`,
        },
      )}`,
    );

    expect(container.querySelector('h1').textContent).toBe('Title');
    expect(container.querySelector('p').textContent).toBe('Main');
  });

  it('renders with plain content as default slot', () => {
    const Box = component(tag('sm2'), (_props, { default: body }) => {
      return html`<div class="box">${body()}</div>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`${Box({}, html`<p>Content</p>`)}`);

    expect(container.querySelector('.box p').textContent).toBe('Content');
  });
});

describe(':prop binding', () => {
  it('sets JS property on element via :prop', () => {
    const div = document.createElement('div');
    div.appendChild(html`<input type="text" :value=${'hello'} />`);

    const input = div.querySelector('input');
    expect(input.value).toBe('hello');
  });

  it('reactive :prop updates', async () => {
    const val = state('initial');
    const div = document.createElement('div');
    div.appendChild(html`<input type="text" :value=${() => val()} />`);

    const input = div.querySelector('input');
    expect(input.value).toBe('initial');

    val('updated');
    await tick();
    expect(input.value).toBe('updated');
  });
});

describe('@event on components', () => {
  it('addEventListener works', () => {
    const handler = vi.fn();
    const div = document.createElement('div');
    div.appendChild(html`<button @click=${handler}>Test</button>`);

    const btn = div.querySelector('button');
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('slot() standalone', () => {
  it('still works as context-aware primitive', () => {
    const Card = component(tag('ss1'), ({ title }) => {
      const body = slot();
      return html`<div><h2>${title}</h2>${body()}</div>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`${Card({ title: 'Hi' }, html`<p>Works</p>`)}`);
    expect(container.querySelector('p').textContent).toBe('Works');
  });

  it('throws when called outside a component', () => {
    expect(() => slot()).toThrow('must be called inside a component');
  });
});

describe('teleport()', () => {
  it('renders content to a target element', async () => {
    const target = document.createElement('div');
    target.id = `tp-${tagCounter++}`;
    document.body.appendChild(target);

    const container = document.createElement('div');
    container.appendChild(
      html`<div>${teleport(`#${target.id}`, () => html`<p class="ported">Teleported!</p>`)}</div>`,
    );

    await tick();
    expect(target.querySelector('.ported').textContent).toBe('Teleported!');
    document.body.removeChild(target);
  });

  it('errors when target not found', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = document.createElement('div');
    container.appendChild(html`${teleport('#nonexistent-xyz', () => html`<p>Lost</p>`)}`);

    await tick();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('not found'));
    err.mockRestore();
  });
});

describe('teleport() reactive', () => {
  it('updates teleported content when signals change', async () => {
    const target = document.createElement('div');
    target.id = `rtp-${tagCounter++}`;
    document.body.appendChild(target);

    const visible = state(true);
    const container = document.createElement('div');
    container.appendChild(
      html`${teleport(`#${target.id}`, () =>
        visible() ? html`<p class="modal">Visible</p>` : null,
      )}`,
    );

    await tick();
    expect(target.querySelector('.modal')).not.toBeNull();

    visible(false);
    await tick();
    expect(target.querySelector('.modal')).toBeNull();

    document.body.removeChild(target);
  });
});
