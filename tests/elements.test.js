import { describe, expect, it, vi } from 'vitest';
import { mount, onDestroy, onMount } from '../src/component.ts';
import { component, reactiveTeleport, teleport } from '../src/elements.ts';
import { html } from '../src/render.ts';
import { state } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('component()', () => {
  it('creates a reusable component with props', () => {
    const Greeting = component((props) => {
      return html`<p>Hello, ${props.name}!</p>`;
    });

    const container = document.createElement('div');
    const fragment = html`<div>${Greeting({ name: 'World' })}</div>`;
    container.appendChild(fragment);

    expect(container.textContent).toContain('Hello, World!');
  });

  it('supports default slot', () => {
    const Card = component((props, slot) => {
      return html`<div class="card"><h2>${props.title}</h2>${slot()}</div>`;
    });

    const container = document.createElement('div');
    const fragment = html`${Card({ title: 'My Card' }, html`<p>Body content</p>`)}`;
    container.appendChild(fragment);

    expect(container.querySelector('h2').textContent).toBe('My Card');
    expect(container.querySelector('p').textContent).toBe('Body content');
  });

  it('supports named slots', () => {
    const Layout = component((props, slot) => {
      return html`
        <header>${slot('header')}</header>
        <main>${slot()}</main>
        <footer>${slot('footer')}</footer>
      `;
    });

    const container = document.createElement('div');
    const fragment = html`${Layout(
      {},
      {
        header: html`<h1>Title</h1>`,
        default: html`<p>Main content</p>`,
        footer: html`<small>Footer text</small>`,
      },
    )}`;
    container.appendChild(fragment);

    expect(container.querySelector('header h1').textContent).toBe('Title');
    expect(container.querySelector('main p').textContent).toBe('Main content');
    expect(container.querySelector('footer small').textContent).toBe('Footer text');
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

  it('renders empty slot as null', () => {
    const Box = component((props, slot) => {
      const header = slot('header');
      return html`<div>${header}${slot()}</div>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`${Box({}, html`<p>Default only</p>`)}`);

    expect(container.querySelector('p').textContent).toBe('Default only');
  });

  it('supports string slot content', () => {
    const Tag = component((props, slot) => {
      return html`<span>${slot()}</span>`;
    });

    const container = document.createElement('div');
    container.appendChild(html`${Tag({}, 'hello text')}`);

    expect(container.textContent).toContain('hello text');
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
