import { describe, expect, it, vi } from 'vite-plus/test';
import { html } from '../src/compiler/compile.ts';
import { mount, onDestroy, onDispose, onError, onMount } from '../src/component.ts';
import { component, slot, teleport } from '../src/elements.ts';
import { onFormDisabled, onFormReset } from '../src/forms.ts';
import { compute, state } from '@purityjs/signals';

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
      return html`<div class="card">
        <h2>${title}</h2>
        ${body()}
      </div>`;
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
  it('reuses named accessors while exposing each discovered name to the consumer', () => {
    let sameAccessor = false;
    const Card = component(tag('slot-cache'), (_props, slots) => {
      sameAccessor = slots.header === slots.header;
      return html`<header>${slots.header()}</header><main>${slots.default()}</main>`;
    });
    const result = Card({}, ({ header, default: fill }) => {
      header('Title');
      fill('Body');
    });

    expect(sameAccessor).toBe(true);
    expect(result.textContent).toBe('TitleBody');
  });

  it('consumer fills default slot via callback', () => {
    const Card = component(tag('sc1'), ({ title }, { default: body }) => {
      return html`<div class="card">
        <h2>${title}</h2>
        ${body()}
      </div>`;
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
      return html`<header>${header()}</header>
        <main>${body()}</main>`;
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
  it('clones DocumentFragments returned by raw slot callbacks on repeated reads', () => {
    const original = document.createDocumentFragment();
    const span = document.createElement('span');
    span.textContent = 'shared fragment';
    original.appendChild(span);

    const rendered: (Node | null)[] = [];
    const Card = component(tag('raw-callback-fragment'), () => {
      const content = slot('body');
      rendered.push(content(), content());
      return document.createElement('section');
    });

    Card({}, { body: () => original });
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toBeInstanceOf(DocumentFragment);
    expect(rendered[1]).toBeInstanceOf(DocumentFragment);
    expect(rendered[0]).not.toBe(rendered[1]);
    expect(rendered[0]).not.toBe(original);
    expect(rendered[0]?.textContent).toBe('shared fragment');
    expect(rendered[1]?.textContent).toBe('shared fragment');
    expect(original.textContent).toBe('shared fragment');
  });

  it('still works as context-aware primitive', () => {
    const Card = component(tag('ss1'), ({ title }) => {
      const body = slot();
      return html`<div>
        <h2>${title}</h2>
        ${body()}
      </div>`;
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

  it('disposes a teleport when its first view unmounts the owner', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const source = state(0);
    const container = document.createElement('div');
    let unmount = () => {};
    let renders = 0;
    const result = mount(
      () =>
        teleport(target, () => {
          source();
          renders++;
          unmount();
          return document.createElement('span');
        }),
      container,
    );
    unmount = result.unmount;

    await tick();
    expect(target.childNodes.length).toBe(0);
    source(1);
    await tick();
    expect(renders).toBe(1);
    expect(target.childNodes.length).toBe(0);
    target.remove();
  });

  it('does not reinsert teleport DOM when a reactive view unmounts its owner', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const source = state(0);
    const container = document.createElement('div');
    let unmount = () => {};
    let renders = 0;
    const result = mount(
      () =>
        teleport(target, () => {
          const value = source();
          renders++;
          if (value === 1) unmount();
          const child = document.createElement('span');
          child.textContent = String(value);
          return child;
        }),
      container,
    );
    unmount = result.unmount;

    await tick();
    expect(target.textContent).toBe('0');
    source(1);
    await tick();
    expect(target.textContent).toBe('');
    source(2);
    await tick();
    expect(renders).toBe(2);
    expect(target.childNodes.length).toBe(0);
    target.remove();
  });

  it('does not leak when the owner unmounts before the deferred setup runs', async () => {
    const target = document.createElement('div');
    target.id = `tpre-${tagCounter++}`;
    document.body.appendChild(target);

    const container = document.createElement('div');
    const { unmount } = mount(
      () => teleport(`#${target.id}`, () => html`<p class="ported">early</p>`),
      container,
    );
    // Unmount synchronously — BEFORE the teleport's queueMicrotask setup
    // has had a chance to run. The deferred setup must bail; otherwise it
    // would append teleported DOM that nothing ever disposes.
    unmount();
    await tick();
    await tick();

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
  for (const child of [false, true]) {
    it(`reports ${child ? 'factory child' : 'host'} destroy errors during disconnect`, async () => {
      const failure = new Error('destroy failed');
      const seen: unknown[] = [];
      const render = () => {
        onError((error) => seen.push(error));
        onDestroy(() => {
          throw failure;
        });
        return html`<p>owned</p>`;
      };
      const name = tag('cel-destroy-error');
      if (child) {
        const Child = component(tag('cel-destroy-error-child'), render);
        component(name, () => html`<div>${Child({})}</div>`);
      } else component(name, render);

      const el = document.createElement(name);
      document.body.appendChild(el);
      await tick();
      el.remove();
      await tick();
      expect(seen).toEqual([failure]);
    });
  }

  it('delivers factory child destroy errors to the host and still tears down siblings', async () => {
    const failure = new Error('factory teardown');
    const seen: unknown[] = [];
    const order: string[] = [];
    const Child = component(tag('cel-shared-teardown-child'), () => {
      onDispose(() => order.push('dispose'));
      onDestroy(() => {
        order.push('first-destroy');
        throw failure;
      });
      onDestroy(() => order.push('second-destroy'));
      return html`<p>child</p>`;
    });
    const name = tag('cel-shared-teardown-host');
    component(name, () => {
      onError((error) => seen.push(error));
      onDestroy(() => order.push('host-destroy'));
      return html`<div>${Child({})}</div>`;
    });

    const el = document.createElement(name);
    document.body.appendChild(el);
    await tick();
    el.remove();
    await tick();

    expect(seen).toEqual([failure]);
    expect(order).toEqual(['dispose', 'first-destroy', 'second-destroy', 'host-destroy']);
  });

  it('releases disconnected owner node references without removing shadow DOM', async () => {
    const name = tag('cel-detached-nodes');
    component(name, () => html`<p>preserved</p>`);
    const el = document.createElement(name);
    document.body.appendChild(el);
    await tick();

    const previousOwner = (el as any)._ctx;
    const paragraph = el.shadowRoot!.querySelector('p');
    expect(previousOwner.nodes).toContain(paragraph);
    expect(previousOwner._shadowRoot).toBe(el.shadowRoot);

    el.remove();

    // A detached host retains its DOM for reconnection, but a stale retained
    // owner must not also keep those DOM descendants or their host alive.
    expect(el.shadowRoot!.querySelector('p')).toBe(paragraph);
    expect(previousOwner.nodes).toBeNull();
    expect(previousOwner._shadowRoot).toBeUndefined();
    expect(previousOwner._internals).toBeNull();
  });

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

  it('recurses into factory-rendered child contexts on host disconnect', async () => {
    const calls: string[] = [];

    // A child component rendered programmatically (the factory return value),
    // NOT as its own custom element child in light DOM. Its ComponentContext
    // is linked into the host ctx.children list during render.
    const Child = component(tag('cel-child'), () => {
      onDestroy(() => calls.push('child-destroyed'));
      onDispose(() => calls.push('child-disposed'));
      return html`<span class="child">child</span>`;
    });

    const hostName = tag('cel-host');
    component(hostName, () => {
      onDestroy(() => calls.push('host-destroyed'));
      // Render the child factory inside the host's render scope so the child
      // ctx is parented to the host ctx (non-custom-element child context).
      return html`<div>${Child({})}</div>`;
    });

    const el = document.createElement(hostName);
    document.body.appendChild(el);
    await tick();
    expect(el.shadowRoot!.querySelector('.child')).not.toBeNull();

    document.body.removeChild(el);
    await tick();

    // Child disposers + destroyed must fire (child-first), then host destroyed.
    expect(calls).toContain('child-disposed');
    expect(calls).toContain('child-destroyed');
    expect(calls).toContain('host-destroyed');
    // Child must be torn down before (or with) the host — child-first ordering.
    expect(calls.indexOf('child-destroyed')).toBeLessThan(calls.indexOf('host-destroyed'));
  });

  it('recurses into deeply nested factory-rendered child contexts on disconnect', async () => {
    const calls: string[] = [];

    const Grandchild = component(tag('cel-gchild'), () => {
      onDestroy(() => calls.push('gchild-destroyed'));
      return html`<i class="gchild">g</i>`;
    });
    const Child = component(tag('cel-child2'), () => {
      onDestroy(() => calls.push('child-destroyed'));
      return html`<span class="child2">${Grandchild({})}</span>`;
    });
    const hostName = tag('cel-host2');
    component(hostName, () => {
      onDestroy(() => calls.push('host-destroyed'));
      return html`<div>${Child({})}</div>`;
    });

    const el = document.createElement(hostName);
    document.body.appendChild(el);
    await tick();
    expect(el.shadowRoot!.querySelector('.gchild')).not.toBeNull();

    document.body.removeChild(el);
    await tick();

    expect(calls).toContain('gchild-destroyed');
    expect(calls).toContain('child-destroyed');
    expect(calls).toContain('host-destroyed');
  });

  it('does not fire child destroy twice on host disconnect', async () => {
    const calls: string[] = [];
    const Child = component(tag('cel-child-once'), () => {
      onDestroy(() => calls.push('child-destroyed'));
      return html`<span class="once">x</span>`;
    });
    const hostName = tag('cel-host-once');
    component(hostName, () => html`<div>${Child({})}</div>`);

    const el = document.createElement(hostName);
    document.body.appendChild(el);
    await tick();
    document.body.removeChild(el);
    await tick();

    expect(calls.filter((c) => c === 'child-destroyed')).toHaveLength(1);
  });

  it('re-renders cleanly on disconnect-then-reconnect (no re-hydration crash)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const count = state(0);
    const hostName = tag('cel-reconnect');
    component(hostName, () => {
      return html`<button @click=${() => count((v) => v + 1)}>val:${() => count()}</button>`;
    });

    const el = document.createElement(hostName);
    document.body.appendChild(el);
    await tick();
    expect(el.shadowRoot!.querySelectorAll('button')).toHaveLength(1);
    expect(el.shadowRoot!.textContent).toContain('val:0');

    // Detach and re-attach (e.g. each() remove-then-readd). The shadow still
    // holds the prior render, which must NOT be treated as DSD/SSR content.
    document.body.removeChild(el);
    await tick();
    document.body.appendChild(el);
    await tick();

    // No uncaught hydration error, and exactly one button (no duplicate render).
    expect(err).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelectorAll('button')).toHaveLength(1);

    // Reactivity is re-established against the fresh render.
    el.shadowRoot!.querySelector('button')!.dispatchEvent(new Event('click'));
    await tick();
    expect(el.shadowRoot!.textContent).toContain('val:1');
    err.mockRestore();
  });

  it('does not create a second owner during reentrant light DOM slot extraction', async () => {
    const hostName = tag('cel-light-reconnect');
    const childName = tag('cel-light-child');
    const events: string[] = [];
    let host!: HTMLElement;
    let reconnected = false;
    let renders = 0;

    customElements.define(
      childName,
      class extends HTMLElement {
        disconnectedCallback() {
          if (reconnected || !host.isConnected) return;
          reconnected = true;
          // Moving a connected light child into the temporary slot fragment
          // fires disconnectedCallback while its host is still rendering.
          host.remove();
          document.body.appendChild(host);
        }
      },
    );

    component(hostName, (_props, { default: body }) => {
      const generation = ++renders;
      onMount(() => events.push(`mounted:${generation}`));
      onDestroy(() => events.push(`destroyed:${generation}`));
      const view = document.createElement('section');
      view.append(body() ?? '');
      return view;
    });

    host = document.createElement(hostName);
    host.appendChild(document.createElement(childName));
    document.body.appendChild(host);
    await tick();

    expect(reconnected).toBe(true);
    expect(renders).toBe(1);
    expect(host.shadowRoot!.querySelectorAll(childName)).toHaveLength(1);
    expect(events).toEqual(['mounted:1']);

    host.remove();
    await tick();
    expect(events).toEqual(['mounted:1', 'destroyed:1']);
  });

  it('does not append stale DOM when a custom element reconnects during render', async () => {
    const hostName = tag('cel-render-reconnect');
    const events: string[] = [];
    let host!: HTMLElement;
    let renders = 0;

    component(hostName, () => {
      const generation = ++renders;
      onMount(() => events.push(`mounted:${generation}`));
      onDestroy(() => events.push(`destroyed:${generation}`));
      if (generation === 1) {
        host.remove();
        document.body.appendChild(host);
      }
      const node = document.createElement('span');
      node.textContent = `render:${generation}`;
      return node;
    });

    host = document.createElement(hostName);
    document.body.appendChild(host);
    await tick();

    expect(renders).toBe(2);
    expect(host.shadowRoot!.textContent).toBe('render:2');
    expect(host.shadowRoot!.querySelectorAll('span')).toHaveLength(1);
    expect(events).toEqual(['destroyed:1', 'mounted:2']);

    host.remove();
    await tick();
    expect(events).toEqual(['destroyed:1', 'mounted:2', 'destroyed:2']);
  });

  it('does not remount an obsolete owner when a child reconnects the host during append', async () => {
    const hostName = tag('cel-append-reconnect');
    const childName = tag('cel-reentrant-child');
    const events: string[] = [];
    let host!: HTMLElement;
    let reconnected = false;
    const obsoleteOwners: { _isMounted: boolean }[] = [];

    customElements.define(
      childName,
      class extends HTMLElement {
        connectedCallback() {
          if (reconnected) return;
          reconnected = true;
          obsoleteOwners.push((host as any)._ctx);
          host.remove();
          document.body.appendChild(host);
        }
      },
    );

    let renders = 0;
    component(hostName, () => {
      const generation = ++renders;
      onMount(() => events.push(`mounted:${generation}`));
      onDestroy(() => events.push(`destroyed:${generation}`));
      const container = document.createElement('div');
      container.textContent = `render:${generation}`;
      container.appendChild(document.createElement(childName));
      return container;
    });

    host = document.createElement(hostName);
    document.body.appendChild(host);
    await tick();

    expect(renders).toBe(2);
    expect(obsoleteOwners[0]?._isMounted).toBe(false);
    expect(host.shadowRoot!.textContent).toBe('render:2');
    expect(events).toEqual(['destroyed:1', 'mounted:2']);

    host.remove();
    await tick();
    expect(events).toEqual(['destroyed:1', 'mounted:2', 'destroyed:2']);
  });

  it('preserves a replacement owner when shadow child removal reconnects the host', async () => {
    const hostName = tag('cel-teardown-reconnect');
    const childName = tag('cel-teardown-child');
    const events: string[] = [];
    const interruptedOwners: { _isDestroyed: boolean }[] = [];
    let host!: HTMLElement;
    let relocated = false;

    customElements.define(
      childName,
      class extends HTMLElement {
        disconnectedCallback() {
          if (relocated || !host.isConnected) return;
          relocated = true;
          interruptedOwners.push((host as any)._ctx);
          host.remove();
          document.body.appendChild(host);
        }
      },
    );

    let renders = 0;
    component(hostName, () => {
      const generation = ++renders;
      onMount(() => events.push(`mounted:${generation}`));
      onDestroy(() => events.push(`destroyed:${generation}`));
      const view = document.createElement('section');
      view.append(`render:${generation}`, document.createElement(childName));
      return view;
    });

    host = document.createElement(hostName);
    document.body.appendChild(host);
    await tick();
    expect(host.shadowRoot!.textContent).toBe('render:1');

    host.remove();
    document.body.appendChild(host);
    await tick();

    expect(relocated).toBe(true);
    expect(interruptedOwners[0]?._isDestroyed).toBe(true);
    // The obsolete render is not invoked after its owner was replaced.
    expect(renders).toBe(2);
    expect(host.shadowRoot!.textContent).toBe('render:2');
    expect(events).toEqual(['mounted:1', 'destroyed:1', 'mounted:2']);

    host.remove();
    await tick();
    expect(events).toEqual(['mounted:1', 'destroyed:1', 'mounted:2', 'destroyed:2']);
  });

  it('rejects an invalid (non-hyphenated / unsafe) component tag name', () => {
    expect(() => component('nohyphen', () => html`<i></i>`)).toThrow(/invalid custom element/i);
    expect(() => component('bad><script>', () => html`<i></i>`)).toThrow(/invalid custom element/i);
    expect(() => component('1-bad', () => html`<i></i>`)).toThrow(/invalid custom element/i);
    // A valid hyphenated name does not throw.
    expect(() => component(tag('ok'), () => html`<i></i>`)).not.toThrow();
  });

  it('does not invoke form-associated handlers after disconnect', async () => {
    const onReset = vi.fn();
    const onDisabled = vi.fn();
    const hostName = tag('cel-form-dead');
    component(
      hostName,
      () => {
        onFormReset(onReset);
        onFormDisabled(onDisabled);
        return html`<input />`;
      },
      { formAssociated: true },
    );

    const form = document.createElement('form');
    const el = document.createElement(hostName) as HTMLElement & {
      formResetCallback: () => void;
      formDisabledCallback: (d: boolean) => void;
    };
    form.appendChild(el);
    document.body.appendChild(form);
    await tick();

    // Detach the host — ctx is now destroyed but not nulled.
    form.removeChild(el);
    await tick();

    // A late spec-dispatched form callback (race with disconnect) must no-op.
    el.formResetCallback();
    el.formDisabledCallback(true);
    expect(onReset).not.toHaveBeenCalled();
    expect(onDisabled).not.toHaveBeenCalled();
    document.body.removeChild(form);
  });

  it('hydrates against DSD-staged shadow content on the first connect', async () => {
    const hostName = tag('cel-dsd');
    component(hostName, () => html`<span>${'fresh'}</span>`);

    // Stage what DSD parsing would leave in the shadow before the first connect.
    const el = document.createElement(hostName);
    el.shadowRoot!.innerHTML = '<span><!--[-->fresh<!--]--></span>';
    const ssrSpan = el.shadowRoot!.firstChild;

    document.body.appendChild(el);
    await tick();

    // First connect hydrated in place — same node reference is preserved.
    expect(el.shadowRoot!.firstChild).toBe(ssrSpan);
    expect(el.shadowRoot!.querySelector('span')!.textContent).toBe('fresh');
    document.body.removeChild(el);
  });
});

describe('prototype-sensitive raw and consumer slots', () => {
  it('does not treat inherited Object prototype functions as supplied raw slots', () => {
    const render = component(tag('raw-prototype-slot'), () => {
      return slot('toString')() ?? document.createTextNode('empty');
    });
    expect(render({}, {}).textContent).toBe('empty');
  });

  it('retains an own __proto__ slot name in the consumer bag', () => {
    const render = component(tag('consumer-prototype-slot'), (_props, slots) => {
      void (slots as Record<string, () => Node | null>)['__proto__'];
      return document.createElement('div');
    });
    let hasReservedSlot = false;
    render({}, (bag: Record<string, unknown>) => {
      hasReservedSlot = Object.hasOwn(bag, '__proto__');
      return null;
    });
    expect(hasReservedSlot).toBe(true);
  });
});
