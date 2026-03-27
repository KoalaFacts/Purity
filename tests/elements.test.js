import { describe, expect, it, vi } from 'vitest';
import { mount, onDestroy, onMount } from '../src/component.ts';
import { component, reactiveTeleport, slot, teleport } from '../src/elements.ts';
import { html } from '../src/render.ts';
import { compute, state } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('component()', () => {
  it('creates a component with props', () => {
    const Greeting = component(({ name }) => {
      return html`<p>Hello, ${name}!</p>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`<div>${Greeting({ name: 'World' })}</div>`);
    expect(container.textContent).toContain('Hello, World!');
  });

  it('supports lifecycle hooks', async () => {
    const mounted = vi.fn();

    const Widget = component(({ text }) => {
      onMount(mounted);
      return html`<span>${text}</span>`;
    });

    const container = document.createElement('div');
    mount(() => html`<div>${Widget({ text: 'hi' })}</div>`, container);

    await tick();
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});

describe('slots — callback syntax', () => {
  it('consumer fills default slot via callback', () => {
    const Card = component(({ title }, { default: body }) => {
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
    const Layout = component((_props, { header, default: body, footer }) => {
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
    const Form = component((_props, { default: body }) => {
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

  it('consumer fills slot + uses exposed data', () => {
    const Search = component((_props, { default: body }) => {
      const query = state('hello');
      return {
        view: html`<div><input bind:value=${query} />${body()}</div>`,
        expose: { query },
      };
    });

    const container = document.createElement('div');
    container.appendChild(
      html`${Search({}, ({ query, default: fill }) => {
        return fill(html`<span class="q">${() => query()}</span>`);
      })}`,
    );

    expect(container.querySelector('.q').textContent).toBe('hello');
  });
});

describe('slots — map syntax (backward compat)', () => {
  it('renders with map-style slots', () => {
    const Layout = component((_props, { header, default: body }) => {
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
    const Box = component((_props, { default: body }) => {
      return html`<div class="box">${body()}</div>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`${Box({}, html`<p>Content</p>`)}`);

    expect(container.querySelector('.box p').textContent).toBe('Content');
  });
});

describe('slot() standalone', () => {
  it('still works as context-aware primitive', () => {
    const Card = component(({ title }) => {
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
    target.id = 'portal3';
    document.body.appendChild(target);

    const container = document.createElement('div');
    container.appendChild(
      html`<div>${teleport('#portal3', () => html`<p class="ported">Teleported!</p>`)}</div>`,
    );

    await tick();
    expect(target.querySelector('.ported').textContent).toBe('Teleported!');
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
});

describe('reactiveTeleport()', () => {
  it('updates teleported content reactively', async () => {
    const target = document.createElement('div');
    target.id = 'rp2';
    document.body.appendChild(target);

    const visible = state(true);
    const container = document.createElement('div');
    container.appendChild(
      html`${reactiveTeleport('#rp2', () =>
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
