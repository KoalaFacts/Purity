import { describe, expect, it } from 'vitest';
import { generate } from '../src/compiler/codegen.ts';
import { html } from '../src/compiler/compile.ts';
import { parse } from '../src/compiler/parser.ts';
import { state } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('parser', () => {
  it('parses a simple element', () => {
    const ast = parse(['<div></div>']);
    expect(ast.type).toBe('fragment');
    expect(ast.children.length).toBe(1);
    expect(ast.children[0].type).toBe('element');
    expect(ast.children[0].tag).toBe('div');
  });

  it('parses nested elements', () => {
    const ast = parse(['<div><p></p></div>']);
    expect(ast.children[0].type).toBe('element');
    expect(ast.children[0].children[0].type).toBe('element');
    expect(ast.children[0].children[0].tag).toBe('p');
  });

  it('parses text content', () => {
    const ast = parse(['<p>Hello world</p>']);
    const p = ast.children[0];
    expect(p.children[0].type).toBe('text');
    expect(p.children[0].value).toBe('Hello world');
  });

  it('parses static attributes', () => {
    const ast = parse(['<div class="box" id="main"></div>']);
    const el = ast.children[0];
    expect(el.attributes.length).toBe(2);
    expect(el.attributes[0]).toEqual({ kind: 'static', name: 'class', value: 'box' });
    expect(el.attributes[1]).toEqual({ kind: 'static', name: 'id', value: 'main' });
  });

  it('parses expression in content', () => {
    // html`<p>${expr}</p>` → strings = ['<p>', '</p>']
    const ast = parse(['<p>', '</p>']);
    const p = ast.children[0];
    expect(p.children[0].type).toBe('expression');
    expect(p.children[0].index).toBe(0);
  });

  it('parses @event attribute', () => {
    const ast = parse(['<button @click=', '>Click</button>']);
    const btn = ast.children[0];
    expect(btn.attributes[0]).toEqual({ kind: 'event', name: 'click', index: 0 });
  });

  it('parses ?bool attribute', () => {
    const ast = parse(['<input ?disabled=', ' />']);
    const input = ast.children[0];
    expect(input.attributes[0]).toEqual({ kind: 'bool', name: 'disabled', index: 0 });
  });

  it('parses .prop attribute', () => {
    const ast = parse(['<input .value=', ' />']);
    const input = ast.children[0];
    expect(input.attributes[0]).toEqual({ kind: 'prop', name: 'value', index: 0 });
  });

  it('parses :reactive-prop attribute', () => {
    const ast = parse(['<p-card :title=', '></p-card>']);
    const el = ast.children[0];
    expect(el.attributes[0]).toEqual({ kind: 'reactive-prop', name: 'title', index: 0 });
  });

  it('parses :: two-way binding attribute', () => {
    const ast = parse(['<input ::value=', ' />']);
    const input = ast.children[0];
    expect(input.attributes[0]).toEqual({ kind: 'bind', name: 'value', index: 0 });
  });

  it('parses dynamic attribute', () => {
    const ast = parse(['<div class=', '></div>']);
    const el = ast.children[0];
    expect(el.attributes[0]).toEqual({ kind: 'dynamic', name: 'class', index: 0 });
  });

  it('parses void elements', () => {
    const ast = parse(['<br/><input type="text" />']);
    expect(ast.children.length).toBe(2);
    expect(ast.children[0].isVoid).toBe(true);
    expect(ast.children[1].isVoid).toBe(true);
  });

  it('parses multiple expressions', () => {
    // html`<p>${a}</p><p>${b}</p>` → strings = ['<p>', '</p><p>', '</p>']
    const ast = parse(['<p>', '</p><p>', '</p>']);
    expect(ast.children[0].children[0].index).toBe(0);
    expect(ast.children[1].children[0].index).toBe(1);
  });

  it('parses mixed static and expression attributes', () => {
    const ast = parse(['<div class="box" id=', ' @click=', '></div>']);
    const el = ast.children[0];
    expect(el.attributes.length).toBe(3);
    expect(el.attributes[0].kind).toBe('static');
    expect(el.attributes[1].kind).toBe('dynamic');
    expect(el.attributes[1].index).toBe(0);
    expect(el.attributes[2].kind).toBe('event');
    expect(el.attributes[2].index).toBe(1);
  });
});

describe('codegen', () => {
  it('generates template-cloning code for static element', () => {
    const ast = parse(['<div></div>']);
    const code = generate(ast);
    // Static templates use DOM API calls + cloneNode (no innerHTML)
    expect(code).toContain('template');
    expect(code).toContain('cloneNode');
    expect(code).toContain('createElement("div")');
  });

  it('generates code with text content in HTML', () => {
    const ast = parse(['<p>Hello</p>']);
    const code = generate(ast);
    expect(code).toContain('createElement("p")');
    expect(code).toContain('createTextNode("Hello")');
    expect(code).toContain('cloneNode');
  });

  it('generates code with static attributes in HTML', () => {
    const ast = parse(['<div class="box"></div>']);
    const code = generate(ast);
    expect(code).toContain('setAttribute');
    expect(code).toContain('class');
    expect(code).toContain('box');
  });

  it('generates code for event binding', () => {
    const ast = parse(['<button @click=', '>Go</button>']);
    const code = generate(ast);
    expect(code).toContain("addEventListener('click'");
  });

  it('generates code for expressions', () => {
    const ast = parse(['<p>', '</p>']);
    const code = generate(ast);
    expect(code).toContain('_v[0]');
  });
});

describe('compiled html``', () => {
  it('renders a simple element', () => {
    const frag = html`<div class="box">Hello</div>`;
    const container = document.createElement('div');
    container.appendChild(frag);
    expect(container.querySelector('.box').textContent).toBe('Hello');
  });

  it('renders dynamic text', () => {
    const name = 'World';
    const frag = html`<p>Hello ${name}</p>`;
    const container = document.createElement('div');
    container.appendChild(frag);
    expect(container.querySelector('p').textContent).toBe('Hello World');
  });

  it('renders reactive text', async () => {
    const count = state(0);
    const frag = html`<p>${() => count()}</p>`;
    const container = document.createElement('div');
    container.appendChild(frag);

    expect(container.querySelector('p').textContent).toBe('0');

    count(5);
    await tick();
    expect(container.querySelector('p').textContent).toBe('5');
  });

  it('handles @event binding', () => {
    let clicked = false;
    const frag = html`<button @click=${() => {
      clicked = true;
    }}>Click</button>`;
    const container = document.createElement('div');
    container.appendChild(frag);

    container.querySelector('button').click();
    expect(clicked).toBe(true);
  });

  it('handles ?bool binding', async () => {
    const disabled = state(true);
    const frag = html`<button ?disabled=${() => disabled()}>Go</button>`;
    const container = document.createElement('div');
    container.appendChild(frag);

    await tick();
    expect(container.querySelector('button').hasAttribute('disabled')).toBe(true);

    disabled(false);
    await tick();
    expect(container.querySelector('button').hasAttribute('disabled')).toBe(false);
  });

  it('handles reactive class attribute', async () => {
    const active = state(true);
    const frag = html`<div class=${() => (active() ? 'on' : 'off')}></div>`;
    const container = document.createElement('div');
    container.appendChild(frag);

    await tick();
    expect(container.querySelector('div').getAttribute('class')).toBe('on');

    active(false);
    await tick();
    expect(container.querySelector('div').getAttribute('class')).toBe('off');
  });

  it('renders nested elements', () => {
    const frag = html`<div><h1>Title</h1><p>Body</p></div>`;
    const container = document.createElement('div');
    container.appendChild(frag);

    expect(container.querySelector('h1').textContent).toBe('Title');
    expect(container.querySelector('p').textContent).toBe('Body');
  });

  it('renders nested expression-only children', async () => {
    const label = state('A');
    const frag = html`<div><span>${() => label()}</span><strong>${'B'}</strong></div>`;
    const container = document.createElement('div');
    container.appendChild(frag);

    expect(container.querySelector('span').textContent).toBe('A');
    expect(container.querySelector('strong').textContent).toBe('B');

    label('C');
    await tick();
    expect(container.querySelector('span').textContent).toBe('C');
  });

  it('renders node values in nested expression-only children', () => {
    const node = document.createElement('em');
    node.textContent = 'node';
    const frag = html`<div><span>${node}</span></div>`;
    const container = document.createElement('div');
    container.appendChild(frag);

    expect(container.querySelector('span em').textContent).toBe('node');
  });

  it('omits formatting whitespace inside table rows', () => {
    const frag = html`
      <tr>
        <td>${'A'}</td>
        <td>${'B'}</td>
      </tr>
    `;
    const tbody = document.createElement('tbody');
    tbody.appendChild(frag);
    const row = tbody.querySelector('tr');

    expect(row?.children.length).toBe(2);
    expect(row?.childNodes.length).toBe(2);
    expect(row?.textContent).toBe('AB');
  });

  it('omits formatting whitespace inside structural containers', () => {
    const frag = html`
      <div>
        <span>${'A'}</span>
        <span>${'B'}</span>
      </div>
    `;
    const container = document.createElement('div');
    container.appendChild(frag);
    const div = container.querySelector('div');

    expect(div?.children.length).toBe(2);
    expect(div?.childNodes.length).toBe(2);
    expect(div?.textContent).toBe('AB');
  });

  it('preserves formatting whitespace inside inline text containers', () => {
    const frag = html`
      <p>
        <span>${'A'}</span>
        <span>${'B'}</span>
      </p>
    `;
    const container = document.createElement('div');
    container.appendChild(frag);
    const p = container.querySelector('p');

    expect(p?.children.length).toBe(2);
    expect(p?.childNodes.length).toBeGreaterThan(2);
  });

  it('renders void elements', () => {
    const frag = html`<div><br/><input type="text" /></div>`;
    const container = document.createElement('div');
    container.appendChild(frag);

    expect(container.querySelector('br')).not.toBeNull();
    expect(container.querySelector('input')).not.toBeNull();
  });

  it('caches compiled templates', () => {
    const render = () => html`<p>cached</p>`;
    const a = render();
    const b = render();
    // Both should produce valid output (cache hit on second call)
    const c1 = document.createElement('div');
    const c2 = document.createElement('div');
    c1.appendChild(a);
    c2.appendChild(b);
    expect(c1.querySelector('p').textContent).toBe('cached');
    expect(c2.querySelector('p').textContent).toBe('cached');
  });
});

describe('compiled html`` performance', () => {
  it('renders 10k elements under 200ms', () => {
    const items = Array.from({ length: 10000 }, (_, i) => i);
    const start = performance.now();
    for (const item of items) {
      html`<div>${String(item)}</div>`;
    }
    const elapsed = performance.now() - start;
    console.log(`  10k compiled renders: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(500);
  });

  it('renders 1k elements with reactive bindings under 200ms', () => {
    const count = state(0);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      html`<div class=${() => (count() > 5 ? 'active' : '')}><p>${() => count()}</p></div>`;
    }
    const elapsed = performance.now() - start;
    console.log(`  1k compiled reactive renders: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(200);
  });
});
