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

  it('teleport with view returning null renders nothing', async () => {
    const target = document.createElement('div');
    target.id = `tpnull-${tagCounter++}`;
    document.body.appendChild(target);

    const container = document.createElement('div');
    container.appendChild(html`${teleport(`#${target.id}`, () => null)}`);

    await tick();
    expect(target.children.length).toBe(0);
    document.body.removeChild(target);
  });

  it('teleport with mount auto-disposes', async () => {
    const target = document.createElement('div');
    target.id = `tpmount-${tagCounter++}`;
    document.body.appendChild(target);

    const container = document.createElement('div');
    const { unmount } = mount(
      () =>
        teleport(`#${target.id}`, () => {
          const el = document.createElement('p');
          el.className = 'ported2';
          return el;
        }),
      container,
    );
    await tick();
    expect(target.querySelector('.ported2')).not.toBeNull();
    unmount();
    expect(target.querySelector('.ported2')).toBeNull();
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

  it('teleports a single Node (not a fragment)', async () => {
    const target = document.createElement('div');
    target.id = `tpn-${tagCounter++}`;
    document.body.appendChild(target);

    const container = document.createElement('div');
    container.appendChild(
      html`${teleport(`#${target.id}`, () => {
        const el = document.createElement('p');
        el.className = 'single';
        el.textContent = 'one';
        return el;
      })}`,
    );

    await tick();
    expect(target.querySelector('.single')!.textContent).toBe('one');
    document.body.removeChild(target);
  });

  it('cleans up teleported nodes on component unmount', async () => {
    const target = document.createElement('div');
    target.id = `tpc-${tagCounter++}`;
    document.body.appendChild(target);

    const container = document.createElement('div');
    const { unmount } = mount(
      () => teleport(`#${target.id}`, () => html`<p class="ported">x</p>`),
      container,
    );
    await tick();
    expect(target.querySelector('.ported')).not.toBeNull();

    unmount();
    expect(target.querySelector('.ported')).toBeNull();
    document.body.removeChild(target);
  });
});

describe('slots — extra coverage', () => {
  it('map slot accepts a string fill', () => {
    const Card = component(tag('sm-str'), (_props, { default: body }) => {
      return html`<div class="box">${body()}</div>`;
    });
    const container = document.createElement('div');
    container.appendChild(html`${Card({}, { default: 'plain text' })}`);
    expect(container.querySelector('.box')!.textContent).toBe('plain text');
  });

  it('slot() resolves function-in-map returning a Node', () => {
    const Card = component(tag('sm-fn-node'), () => {
      const body = slot();
      return html`<div class="box">${body()}</div>`;
    });
    const container = document.createElement('div');
    container.appendChild(
      html`${Card(
        {},
        {
          default: () => {
            const el = document.createElement('span');
            el.className = 'fn-node';
            return el;
          },
        },
      )}`,
    );
    expect(container.querySelector('.fn-node')).not.toBeNull();
  });

  it('slot() resolves function-in-map returning a string', () => {
    const Card = component(tag('sm-fn-str'), () => {
      const body = slot();
      return html`<div class="box">${body()}</div>`;
    });
    const container = document.createElement('div');
    container.appendChild(html`${Card({}, { default: () => 'returned' })}`);
    expect(container.querySelector('.box')!.textContent).toBe('returned');
  });

  it('slot() resolves function-in-map returning null/non-Node', () => {
    const Card = component(tag('sm-fn-null'), () => {
      const body = slot();
      const el = body();
      return html`<div class="box">${el ?? 'fallback'}</div>`;
    });
    const container = document.createElement('div');
    container.appendChild(html`${Card({}, { default: () => 123 })}`);
    expect(container.querySelector('.box')!.textContent).toBe('fallback');
  });

  it('slot() returns null for unknown slot name in map', () => {
    const Card = component(tag('sm-unknown-named'), () => {
      const sidebar = slot('sidebar');
      const r = sidebar();
      return html`<div>${r ?? 'no-side'}</div>`;
    });
    const container = document.createElement('div');
    container.appendChild(html`${Card({}, { default: 'main' })}`);
    expect(container.textContent).toContain('no-side');
  });

  it('slot() returns plain content via resolveContent for static map value', () => {
    const Card = component(tag('sm-static'), () => {
      const body = slot();
      return html`<div class="box">${body()}</div>`;
    });
    const container = document.createElement('div');
    container.appendChild(html`${Card({}, { default: 'plain' })}`);
    expect(container.querySelector('.box')!.textContent).toBe('plain');
  });

  it('returns null for unknown named slot with no fill', () => {
    const Card = component(tag('sm-unknown'), (_props, slots: any) => {
      const sidebar = slots.sidebar();
      return html`<div>${sidebar ?? 'no-sidebar'}</div>`;
    });
    const container = document.createElement('div');
    container.appendChild(html`${Card({}, {})}`);
    expect(container.textContent).toContain('no-sidebar');
  });
});

describe('component as custom element — lifecycle', () => {
  it('runs disconnectedCallback dispose on removal', async () => {
    const name = tag('cel-dispose');
    const calls: string[] = [];

    component(name, () => {
      onDestroy(() => calls.push('destroyed'));
      return html`<p>x</p>`;
    });

    const el = document.createElement(name);
    document.body.appendChild(el);
    await tick();
    document.body.removeChild(el);
    await tick();
    expect(calls).toEqual(['destroyed']);
  });

  it('attaches custom element ctx as child of parent mount ctx', async () => {
    const name = tag('cel-nested');
    component(name, () => html`<p class="ne">x</p>`);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const { unmount } = mount(() => {
      const el = document.createElement(name);
      return el;
    }, container);
    await tick();
    expect(container.querySelector(name)).not.toBeNull();
    unmount();
    document.body.removeChild(container);
  });

  it('resolveContent returns null for non-Node, non-string values via map', () => {
    const Card = component(tag('rc-num'), () => {
      const body = slot();
      const r = body();
      return html`<div>${r ?? 'fallback'}</div>`;
    });
    const c = document.createElement('div');
    // Pass a number as the static map value — resolveContent gets a number,
    // not a Node/string/fragment, returns null → fallback rendered.
    c.appendChild(html`${Card({}, { default: 42 as any })}`);
    expect(c.textContent).toContain('fallback');
  });

  it('runs without registering any lifecycle hook (null callbacks)', async () => {
    const name = tag('cel-bare');
    component(name, () => html`<p>x</p>`);
    const el = document.createElement(name);
    document.body.appendChild(el);
    await tick();
    expect(el.shadowRoot!.querySelector('p')).not.toBeNull();
    document.body.removeChild(el);
  });

  it('slot() with default callback returning a Node', () => {
    const Card = component(tag('sf-node'), () => {
      const body = slot();
      return html`<div class="b">${body()}</div>`;
    });
    const c = document.createElement('div');
    c.appendChild(
      html`${Card({}, () => {
        const el = document.createElement('em');
        el.className = 'fn';
        return el;
      })}`,
    );
    expect(c.querySelector('.fn')).not.toBeNull();
  });

  it('slot() with default callback returning a string', () => {
    const Card = component(tag('sf-str'), () => {
      const body = slot();
      return html`<div class="b">${body()}</div>`;
    });
    const c = document.createElement('div');
    c.appendChild(html`${Card({}, () => 'returned-text')}`);
    expect(c.querySelector('.b')!.textContent).toBe('returned-text');
  });

  it('slot() with default callback returning null/non-renderable', () => {
    const Card = component(tag('sf-null'), () => {
      const body = slot();
      const r = body();
      return html`<div class="b">${r ?? 'fallback'}</div>`;
    });
    const c = document.createElement('div');
    c.appendChild(html`${Card({}, () => 42)}`);
    expect(c.querySelector('.b')!.textContent).toBe('fallback');
  });

  it('pre-fills default slot when children is a Node', () => {
    const Card = component(tag('pf-node'), () => {
      const body = slot();
      return html`<div class="b">${body()}</div>`;
    });
    const c = document.createElement('div');
    const node = document.createElement('em');
    node.className = 'pf-direct';
    node.textContent = 'direct';
    c.appendChild(html`${Card({}, node)}`);
    expect(c.querySelector('.pf-direct')).not.toBeNull();
  });

  it('pre-fills default slot when children is a string', () => {
    const Card = component(tag('pf-str'), () => {
      const body = slot();
      return html`<div class="b">${body()}</div>`;
    });
    const c = document.createElement('div');
    c.appendChild(html`${Card({}, 'plain string children')}`);
    expect(c.querySelector('.b')!.textContent).toBe('plain string children');
  });

  it('component consumer fn returning a string', () => {
    const Wrap = component(tag('cf-str'), (_props, { default: body }) => {
      return html`<section>${body()}</section>`;
    });
    const c = document.createElement('div');
    c.appendChild(html`${Wrap({}, () => 'just-text')}`);
    expect(c.querySelector('section')!.textContent).toBe('just-text');
  });

  it('mounts custom element when render returns a single Node (not fragment)', async () => {
    const name = tag('cel-node');
    component(name, () => {
      const el = document.createElement('p');
      el.className = 'single-root';
      el.textContent = 'one';
      return el;
    });
    const el = document.createElement(name);
    document.body.appendChild(el);
    await tick();
    expect(el.shadowRoot!.querySelector('.single-root')).not.toBeNull();
    document.body.removeChild(el);
  });

  it('forwards on<Event> properties from custom element instance', async () => {
    const name = tag('cel-evt');
    let received: any = null;
    component(name, ({ onClick }: { onClick?: (...a: any[]) => void }) => {
      received = onClick;
      return html`<button>x</button>`;
    });
    const el: any = document.createElement(name);
    el.__purity_event_click = () => {};
    document.body.appendChild(el);
    await tick();
    expect(typeof received).toBe('function');
    document.body.removeChild(el);
  });

  it('logs disposer errors on disconnect', async () => {
    const { onDispose } = await import('../src/component.ts');
    const name = tag('cel-err');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    component(name, () => {
      onDispose(() => {
        throw new Error('disposer-bad');
      });
      return html`<p>x</p>`;
    });

    const el = document.createElement(name);
    document.body.appendChild(el);
    await tick();
    document.body.removeChild(el);
    await tick();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
