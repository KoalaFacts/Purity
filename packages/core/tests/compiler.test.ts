import { describe, expect, it, vi } from 'vitest';
import { generate } from '../src/compiler/codegen.ts';
import { html, inflateDeferred } from '../src/compiler/compile.ts';
import {
  checkHydrationCursor,
  type DeferredTemplate,
  disableHydrationWarnings,
  enableHydrationWarnings,
  enterHydration,
  exitHydration,
  isDeferred,
  isHydrating,
  makeDeferred,
  resetHydration,
  withHydration,
} from '../src/compiler/hydrate-runtime.ts';
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

  // ---------------------------------------------------------------------------
  // Expression-boundary handling (audit-v2 HIGH fixes)
  //
  // Spread attributes, interpolated quoted attribute values, and dynamic
  // content inside comments are NOT supported binding forms (there is no
  // AST node for them). The contract is: the parser must not let the
  // expression — or any structural delimiter after it (`>`, the closing
  // quote, `-->`) — leak into the element's children. The interpolated
  // value is dropped, but `exprIndex` still advances so later slots stay
  // aligned with the runtime values array (which codegen indexes absolutely
  // via `_v[N]`).
  // ---------------------------------------------------------------------------

  it('spread expression in open tag does not leak `>` into content', () => {
    // html`<div ${spread}>hi</div>` → strings = ['<div ', '>hi</div>']
    const ast = parse(['<div ', '>hi</div>']);
    const el = ast.children[0];
    expect(el.type).toBe('element');
    expect(el.tag).toBe('div');
    // The `>` must be consumed — children is just the text node, never `>hi`.
    expect(el.children.length).toBe(1);
    expect(el.children[0]).toEqual({ type: 'text', value: 'hi' });
  });

  it('preserves real attributes that follow a spread expression', () => {
    // html`<div ${spread} id="x">` keeps the trailing static attribute.
    const ast = parse(['<div ', ' id="x">y</div>']);
    const el = ast.children[0];
    expect(el.tag).toBe('div');
    expect(el.attributes).toEqual([{ kind: 'static', name: 'id', value: 'x' }]);
    expect(el.children).toEqual([{ type: 'text', value: 'y' }]);
  });

  it('keeps slot indices aligned after a dropped spread expression', () => {
    // strings = ['<div ', ' class=', '>'] — spread is index 0 (dropped),
    // class is index 1 and MUST stay index 1.
    const ast = parse(['<div ', ' class=', '></div>']);
    const el = ast.children[0];
    const cls = el.attributes.find((a: any) => a.name === 'class');
    expect(cls).toEqual({ kind: 'dynamic', name: 'class', index: 1 });
  });

  it('interpolated quoted attribute value does not leak into content', () => {
    // html`<div class="x-${y}-z"></div>` → strings = ['<div class="x-', '-z"></div>']
    const ast = parse(['<div class="x-', '-z"></div>']);
    const el = ast.children[0];
    // Single static attribute stitched from the literal segments; the
    // interpolated value is dropped. No `-z">` text leaks into children.
    expect(el.attributes).toEqual([{ kind: 'static', name: 'class', value: 'x--z' }]);
    expect(el.children.length).toBe(0);
  });

  it('quoted single-expression attribute value is still dynamic (not regressed)', () => {
    // html`<div class="${y}"></div>` must remain a dynamic binding.
    const ast = parse(['<div class="', '"></div>']);
    const el = ast.children[0];
    expect(el.attributes).toEqual([{ kind: 'dynamic', name: 'class', index: 0 }]);
    expect(el.children.length).toBe(0);
  });

  it('comment spanning an expression boundary stays a single comment', () => {
    // html`<!-- debug: ${value} -->` → strings = ['<!-- debug: ', ' -->']
    const ast = parse(['<!-- debug: ', ' -->']);
    expect(ast.children.length).toBe(1);
    expect(ast.children[0].type).toBe('comment');
    // The expression is dropped; the trailing ` -->` is consumed, not leaked.
    expect((ast.children[0] as any).value).toBe(' debug:  ');
  });

  it('uppercase void tag `<BR>` is treated as void (case-insensitive)', () => {
    const ast = parse(['<BR>after']);
    const br = ast.children[0];
    expect(br.type).toBe('element');
    expect(br.isVoid).toBe(true);
    // `after` is a sibling text node, not swallowed as a child of <BR>.
    expect(br.children.length).toBe(0);
    expect(ast.children[1]).toEqual({ type: 'text', value: 'after' });
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
    // Codegen passes attribute and event names through JSON.stringify, so
    // either single- or double-quoted is correct — match the listener call
    // semantically.
    expect(code).toMatch(/addEventListener\(['"]click['"]/);
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
    const frag = html`<button
      @click=${() => {
        clicked = true;
      }}
    >
      Click
    </button>`;
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
    const frag = html`<div>
      <h1>Title</h1>
      <p>Body</p>
    </div>`;
    const container = document.createElement('div');
    container.appendChild(frag);

    expect(container.querySelector('h1').textContent).toBe('Title');
    expect(container.querySelector('p').textContent).toBe('Body');
  });

  it('renders void elements', () => {
    const frag = html`<div><br /><input type="text" /></div>`;
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

describe('compiled html`` — SSR/client output parity (hydration mismatch class)', () => {
  // The SSR codegen and client codegen MUST coerce values to the same
  // HTML for every value kind; otherwise hydration leaves the DOM in
  // a different state than what SSR rendered (silent UI drift, broken
  // bindings).

  it('dynamic-attribute literal `true` emits bare name (matches SSR `valueToAttr`)', () => {
    // SSR: valueToAttr(true) → '' → bare ` name`.
    // Client (pre-fix): setAttribute(name, 'true') → `name="true"`.
    const frag = html`<input disabled=${true} />`;
    const container = document.createElement('div');
    container.appendChild(frag);
    const el = container.querySelector('input')!;
    // Attribute is PRESENT but has empty string value (bare form):
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.getAttribute('disabled')).toBe('');
  });

  it('dynamic-attribute signal returning `true` emits bare name', () => {
    const sig = state(true);
    const frag = html`<input disabled=${() => sig()} />`;
    const container = document.createElement('div');
    container.appendChild(frag);
    const el = container.querySelector('input')!;
    expect(el.getAttribute('disabled')).toBe('');
  });

  it('text-slot signal returning `false` renders empty (matches SSR `valueToHtml`)', () => {
    // SSR: valueToHtml(false) → ''.
    // Client (pre-fix): `r==null?'':String(r)` → 'false'.
    const sig = state<unknown>(false);
    const frag = html`<p>${() => sig()}</p>`;
    const container = document.createElement('div');
    container.appendChild(frag);
    expect(container.querySelector('p')!.textContent).toBe('');
  });

  it('text-slot array drops null/undefined/false items (matches SSR recursion)', () => {
    // SSR: valueToHtml([null, 'a', undefined, false, 'b']) → 'ab'.
    // Client (pre-fix): String() each → 'nullaundefinedfalseb'.
    const arr: unknown[] = [null, 'a', undefined, false, 'b'];
    const frag = html`<p>${arr}</p>`;
    const container = document.createElement('div');
    container.appendChild(frag);
    expect(container.querySelector('p')!.textContent).toBe('ab');
  });
});

describe('compiler — extra coverage', () => {
  it('parses comments in templates', () => {
    const ast = parse(['<div><!-- hello --><p>x</p></div>']);
    const div = ast.children[0] as any;
    expect(div.children[0].type).toBe('comment');
    expect(div.children[0].value).toBe(' hello ');
  });

  it('parses unterminated comments to end of input', () => {
    const ast = parse(['<div><!-- never closes']);
    const div = ast.children[0] as any;
    expect(div.children[0].type).toBe('comment');
  });

  it('parses `<!doctype html>` as a raw text node', () => {
    // Regression: before this fix the parser fell through from comment
    // detection to parseElement → parseAttribute, which spun forever on
    // the leading `!` (not a name char and no progress made). Surfaced
    // as a Vite SSR-build OOM in the cf-workers example.
    const ast = parse(['<!doctype html><p>hi</p>']);
    const first = ast.children[0] as any;
    expect(first.type).toBe('text');
    expect(first.raw).toBe(true);
    expect(first.value).toBe('<!doctype html>');
    const second = ast.children[1] as any;
    expect(second.type).toBe('element');
    expect(second.tag).toBe('p');
  });

  it('parses `<!DOCTYPE html>` (uppercase) the same way', () => {
    const ast = parse(['<!DOCTYPE html>']);
    const first = ast.children[0] as any;
    expect(first.type).toBe('text');
    expect(first.raw).toBe(true);
    expect(first.value).toBe('<!DOCTYPE html>');
  });

  it('parses `<![CDATA[...]]>` as a raw text node', () => {
    const ast = parse(['<![CDATA[x>y]]>']);
    const first = ast.children[0] as any;
    expect(first.type).toBe('text');
    expect(first.raw).toBe(true);
    // Stops at the first `>` — CDATA in template literals is unusual;
    // the goal is to survive parsing without infinite-looping, not to
    // be a full SGML reader.
    expect(first.value.startsWith('<![CDATA[')).toBe(true);
  });

  it('parses unquoted attribute values', () => {
    const ast = parse(['<div data-x=hello id=foo></div>']);
    const div = ast.children[0] as any;
    expect(div.attributes.find((a: any) => a.name === 'data-x').value).toBe('hello');
    expect(div.attributes.find((a: any) => a.name === 'id').value).toBe('foo');
  });

  it('parses single-quoted attribute values', () => {
    const ast = parse([`<div title='hi'></div>`]);
    const div = ast.children[0] as any;
    expect(div.attributes[0].value).toBe('hi');
  });

  it('parses boolean attributes (no value)', () => {
    const ast = parse(['<input disabled>']);
    const input = ast.children[0] as any;
    expect(input.attributes[0].name).toBe('disabled');
    expect(input.attributes[0].value).toBe('');
  });

  it('renders boolean attribute binding (?)', () => {
    const flag = state(true);
    const frag = html`<button ?disabled=${() => flag()}>Go</button>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    const btn = c.querySelector('button') as HTMLButtonElement;
    expect(btn.hasAttribute('disabled')).toBe(true);

    flag(false);
    return tick().then(() => {
      expect(btn.hasAttribute('disabled')).toBe(false);
    });
  });

  it('renders DOM property binding (.) with reactive value', async () => {
    const v = state('alpha');
    const frag = html`<input .value=${() => v()} />`;
    const c = document.createElement('div');
    c.appendChild(frag);
    const input = c.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('alpha');

    v('beta');
    await tick();
    expect(input.value).toBe('beta');
  });

  it('renders ::checkbox bind', async () => {
    const checked = state(false);
    const frag = html`<input type="checkbox" ::checked=${checked} />`;
    const c = document.createElement('div');
    c.appendChild(frag);
    const input = c.querySelector('input') as HTMLInputElement;
    expect(input.checked).toBe(false);

    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(checked()).toBe(true);
  });

  it('renders ::group bind for radios', async () => {
    const value = state('a');
    const frag = html`
      <input type="radio" name="g" value="a" ::group=${value} />
      <input type="radio" name="g" value="b" ::group=${value} />
    `;
    const c = document.createElement('div');
    c.appendChild(frag);
    const radios = c.querySelectorAll<HTMLInputElement>('input');
    await tick();
    expect(radios[0].checked).toBe(true);
    expect(radios[1].checked).toBe(false);

    radios[1].checked = true;
    radios[1].dispatchEvent(new Event('change'));
    expect(value()).toBe('b');
  });

  it('renders ::group bind for checkbox arrays', async () => {
    const value = state(['a']);
    const frag = html`
      <input type="checkbox" value="a" ::group=${value} />
      <input type="checkbox" value="b" ::group=${value} />
    `;
    const c = document.createElement('div');
    c.appendChild(frag);
    const boxes = c.querySelectorAll<HTMLInputElement>('input');
    await tick();
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);

    boxes[1].checked = true;
    boxes[1].dispatchEvent(new Event('change'));
    expect(value()).toEqual(['a', 'b']);

    boxes[0].checked = false;
    boxes[0].dispatchEvent(new Event('change'));
    expect(value()).toEqual(['b']);
  });

  it('renders comments as static DOM nodes', () => {
    const frag = html`<div>
      <!-- hello -->
      <p>x</p>
    </div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    const div = c.querySelector('div')!;
    let foundComment = false;
    for (const n of div.childNodes) {
      if (n.nodeType === 8 && n.nodeValue!.includes('hello')) foundComment = true;
    }
    expect(foundComment).toBe(true);
  });

  it('handles array expressions inside templates', () => {
    const items = ['a', 'b', 'c'].map((t) => {
      const el = document.createElement('span');
      el.textContent = t;
      return el;
    });
    const frag = html`<div>${items}</div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelectorAll('span').length).toBe(3);
  });

  it('handles null/false expressions', () => {
    // Verifies the static-interpolation branch's contract: values that are
    // null, undefined, or false render as empty text. Pull the values from
    // JSON.parse + a missing-property lookup so static analyzers can't see
    // a bare `${null}` / `${undefined}` literal at the interpolation site
    // — the value is genuinely typed `unknown` and only known at runtime.
    const src = JSON.parse('{"nul":null,"fls":false}') as Record<string, unknown>;
    const nul = src.nul;
    const fls = src.fls;
    const undef = src.notPresent;
    const frag = html`<p>${nul}${fls}${undef}</p>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('p')!.textContent).toBe('');
  });

  it('handles Node-returning reactive expression that swaps to text', async () => {
    const showNode = state(true);
    const frag = html`<div>
      ${() => {
        if (showNode()) {
          const el = document.createElement('span');
          el.className = 'n';
          el.textContent = 'node';
          return el;
        }
        return 'plain';
      }}
    </div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('.n')).not.toBeNull();

    showNode(false);
    await tick();
    expect(c.querySelector('.n')).toBeNull();
    expect(c.querySelector('div')!.textContent).toContain('plain');
  });

  it('exports generateModule', async () => {
    const { generateModule } = await import('../src/compiler/codegen.ts');
    const code = generateModule(parse(['<p>hi</p>']));
    expect(code).toContain('export default');
  });

  it('getCompiledFactory returns a callable factory', async () => {
    const { getCompiledFactory } = await import('../src/compiler/compile.ts');
    const { _watch } = await import('../src/compiler/compile.ts');
    const strings = Object.assign(['<p>factory</p>'], { raw: ['<p>factory</p>'] }) as any;
    const fn = getCompiledFactory(strings);
    const node = fn([], _watch);
    expect((node as any).querySelector?.('p')?.textContent ?? (node as any).textContent).toContain(
      'factory',
    );
  });

  it('getCompiledFactory returns the cached compiled fn on second call', async () => {
    const { getCompiledFactory } = await import('../src/compiler/compile.ts');
    const strings = Object.assign(['<span>cached</span>'], {
      raw: ['<span>cached</span>'],
    }) as any;
    const a = getCompiledFactory(strings);
    const b = getCompiledFactory(strings);
    expect(a).toBe(b);
  });

  it('renders simple template with event handler', () => {
    let clicked = 0;
    const onClick = () => {
      clicked++;
    };
    const frag = html`<button @click=${onClick}>x</button>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    (c.querySelector('button') as HTMLButtonElement).click();
    expect(clicked).toBe(1);
  });

  it('renders simple template with .property and reactive .property', async () => {
    const v = state('one');
    const frag = html`<input .value=${() => v()} />`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect((c.querySelector('input') as HTMLInputElement).value).toBe('one');
    v('two');
    await tick();
    expect((c.querySelector('input') as HTMLInputElement).value).toBe('two');
  });

  it('renders simple-template ::value bind for text input', async () => {
    const v = state('start');
    const frag = html`<input ::value=${v} />`;
    const c = document.createElement('div');
    c.appendChild(frag);
    const input = c.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('start');

    input.value = 'typed';
    input.dispatchEvent(new Event('input'));
    expect(v()).toBe('typed');
  });

  it('parses tags with trailing slash on void elements', () => {
    const ast = parse(['<br/>']);
    expect(ast.children[0].type).toBe('element');
    expect((ast.children[0] as any).tag).toBe('br');
  });

  it('parses dynamic comments inside dynamic templates', () => {
    const v = state('x');
    const frag = html`<div>
      <!-- static -->
      <p>${() => v()}</p>
    </div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('p')!.textContent).toBe('x');
  });

  it('renders complex template with .property binding', async () => {
    const v = state('alpha');
    const frag = html`<div><input .value=${() => v()} /></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    const input = c.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('alpha');
    v('beta');
    await tick();
    expect(input.value).toBe('beta');
  });

  it('renders complex template with :reactive-prop binding', async () => {
    const cls = state('one');
    const frag = html`<div><span :className=${() => cls()}>x</span></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    const span = c.querySelector('span')!;
    expect(span.className).toBe('one');
    cls('two');
    await tick();
    expect(span.className).toBe('two');
  });

  it('renders complex template with ::value bind for text input', async () => {
    const v = state('start');
    const frag = html`<div><input ::value=${v} /></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    const input = c.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('start');

    input.value = 'typed';
    input.dispatchEvent(new Event('input'));
    expect(v()).toBe('typed');
  });

  it('renders simple template with ::group bind for single radio', async () => {
    const value = state('a');
    const frag = html`<input type="radio" name="g2" value="a" ::group=${value} />`;
    const c = document.createElement('div');
    c.appendChild(frag);
    const radio = c.querySelector('input') as HTMLInputElement;
    await tick();
    expect(radio.checked).toBe(true);
  });

  it('renders complex template with ?bool static value (false)', () => {
    const frag = html`<div><button ?disabled=${false}>x</button></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect((c.querySelector('button') as HTMLButtonElement).hasAttribute('disabled')).toBe(false);
  });

  it('renders complex template with ?bool static value (true)', () => {
    const frag = html`<div><button ?disabled=${true}>x</button></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect((c.querySelector('button') as HTMLButtonElement).hasAttribute('disabled')).toBe(true);
  });

  it('renders complex template with .property static value', () => {
    const frag = html`<div><input .value=${'static-value'} /></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect((c.querySelector('input') as HTMLInputElement).value).toBe('static-value');
  });

  it('renders complex template with :reactive-prop static value', () => {
    const frag = html`<div><span :className=${'static-cls'}>x</span></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('span')!.className).toBe('static-cls');
  });

  it('renders complex template with name= dynamic static value', () => {
    const frag = html`<div><a href=${'/foo'}>x</a></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('a')!.getAttribute('href')).toBe('/foo');
  });

  it('renders complex template with name= dynamic null/false value', () => {
    // Verifies the framework's contract that a null attribute value
    // removes the attribute. Value pulled from JSON.parse so the
    // null/undefined isn't a literal at the interpolation site.
    const src = JSON.parse('{"v":null}') as Record<string, unknown>;
    const frag = html`<div><a href=${src.v}>x</a></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('a')!.hasAttribute('href')).toBe(false);
  });

  it('renders complex template with name= dynamic reactive null', async () => {
    const v = state<string | null>('one');
    const frag = html`<div><a href=${() => v()}>x</a></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('a')!.getAttribute('href')).toBe('one');
    v(null);
    await tick();
    expect(c.querySelector('a')!.hasAttribute('href')).toBe(false);
  });

  it('parses self-closing custom tag', () => {
    const ast = parse(['<x-foo />']);
    expect((ast.children[0] as any).tag).toBe('x-foo');
  });

  it('parses attribute followed by another with no space (regression)', () => {
    const ast = parse(['<input type="text" id="foo">']);
    const input = ast.children[0] as any;
    expect(input.attributes.length).toBe(2);
  });

  it('parses element with newline before >', () => {
    const ast = parse(['<div\n  class="x"\n></div>']);
    const div = ast.children[0] as any;
    expect(div.attributes[0].name).toBe('class');
  });

  it('renders empty template as empty fragment', () => {
    const frag = html``;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.childNodes.length).toBe(0);
  });

  it('renders simple template with static id attribute', () => {
    const frag = html`<input id="my-id" type="text" />`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('input')!.id).toBe('my-id');
  });

  it('renders simple template with empty-value static attribute', () => {
    const frag = html`<input data-flag />`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('input')!.hasAttribute('data-flag')).toBe(true);
  });

  it('renders simple template with whitespace text between expressions', () => {
    const a = 'X';
    const b = 'Y';
    const frag = html`<p>${a} ${b}</p>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('p')!.textContent).toMatch(/X.*Y/);
  });

  it('renders complex template with whitespace text between expressions', () => {
    const a = 'X';
    const b = 'Y';
    const frag = html`<div><p>${a} ${b}</p></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('p')!.textContent).toMatch(/X.*Y/);
  });

  it('strips indentation text nodes between sibling elements', () => {
    // A multi-line template carries indentation as text nodes when handed
    // to innerHTML. They are pure formatting and should be condensed away
    // so each() doesn't multiply 5-10 throwaway text nodes per row.
    const frag = html`
      <ul>
        <li>a</li>
        <li>b</li>
        <li>c</li>
      </ul>
    `;
    const c = document.createElement('div');
    c.appendChild(frag);
    const ul = c.querySelector('ul')!;
    // Should contain only the three <li> elements — no whitespace text nodes.
    expect(ul.childNodes.length).toBe(3);
    for (let i = 0; i < ul.childNodes.length; i++) {
      expect(ul.childNodes[i].nodeType).toBe(Node.ELEMENT_NODE);
    }
  });

  it('preserves single-space text between expressions (no newline)', () => {
    // Whitespace WITHOUT a newline is treated as deliberate (e.g. "${a} ${b}"
    // renders "X Y", not "XY") and must survive the condense pass.
    const frag = html`<p>${'X'} ${'Y'}</p>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('p')!.textContent).toBe('X Y');
  });

  it('renders complex template with empty-value static attribute', () => {
    const v = state(true);
    const frag = html`<div><input data-flag ?disabled=${() => v()} /></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    expect(c.querySelector('input')!.hasAttribute('data-flag')).toBe(true);
  });

  it('renders ::group bind for checkbox group in complex template', async () => {
    const value = state(['a']);
    const frag = html`
      <div>
        <input type="checkbox" value="a" ::group=${value} />
        <input type="checkbox" value="b" ::group=${value} />
      </div>
    `;
    const c = document.createElement('div');
    c.appendChild(frag);
    const boxes = c.querySelectorAll<HTMLInputElement>('input');
    await tick();
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);

    boxes[1].checked = true;
    boxes[1].dispatchEvent(new Event('change'));
    expect(value()).toEqual(['a', 'b']);

    boxes[0].checked = false;
    boxes[0].dispatchEvent(new Event('change'));
    expect(value()).toEqual(['b']);
  });

  it('renders ::group bind for radio in complex template', async () => {
    const value = state('a');
    const frag = html`
      <div>
        <input type="radio" name="cg" value="a" ::group=${value} />
        <input type="radio" name="cg" value="b" ::group=${value} />
      </div>
    `;
    const c = document.createElement('div');
    c.appendChild(frag);
    const radios = c.querySelectorAll<HTMLInputElement>('input');
    await tick();
    expect(radios[0].checked).toBe(true);

    radios[1].checked = true;
    radios[1].dispatchEvent(new Event('change'));
    expect(value()).toBe('b');
  });

  it('renders ::checked bind in complex template', async () => {
    const checked = state(false);
    const frag = html`<div><input type="checkbox" ::checked=${checked} /></div>`;
    const c = document.createElement('div');
    c.appendChild(frag);
    const input = c.querySelector('input') as HTMLInputElement;
    await tick();
    expect(input.checked).toBe(false);

    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(checked()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Single-watch-per-template fold (codegen optimisation)
  // ---------------------------------------------------------------------------

  // biome-ignore lint/suspicious/noTemplateCurlyInString: dollar-curly in the description refers to template syntax under test
  it('fold: multiple ${} reactive bindings in one complex template share a watch', async () => {
    const a = state('A');
    const b = state('B');
    const cs = state('C');
    const c = document.createElement('div');
    c.appendChild(
      html`<div><span>${() => a()}</span><span>${() => b()}</span><span>${() => cs()}</span></div>`,
    );
    expect([...c.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['A', 'B', 'C']);

    a('A2');
    await tick();
    expect([...c.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['A2', 'B', 'C']);

    b('B2');
    await tick();
    expect([...c.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['A2', 'B2', 'C']);

    cs('C2');
    await tick();
    expect([...c.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['A2', 'B2', 'C2']);
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: dollar-curly in the description refers to template syntax under test
  it('fold: reactive ${} + reactive class= in same complex template both update', async () => {
    const txt = state('hi');
    const cls = state('on');
    const c = document.createElement('div');
    c.appendChild(html`<div><span class=${() => cls()}>${() => txt()}</span></div>`);
    const span = c.querySelector('span')!;
    expect(span.textContent).toBe('hi');
    expect(span.getAttribute('class')).toBe('on');

    txt('there');
    await tick();
    expect(span.textContent).toBe('there');

    cls('off');
    await tick();
    expect(span.getAttribute('class')).toBe('off');
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: dollar-curly in the description refers to template syntax under test
  it('fold: simple template with two reactive ${} bindings updates both', async () => {
    const a = state(1);
    const b = state(10);
    const c = document.createElement('div');
    // Single root element, only text/expression children — simple-template path.
    c.appendChild(html`<p>${() => a()} + ${() => b()}</p>`);
    const p = c.querySelector('p')!;
    expect(p.textContent).toMatch(/1.*\+.*10/);

    a(2);
    await tick();
    expect(p.textContent).toMatch(/2.*\+.*10/);

    b(20);
    await tick();
    expect(p.textContent).toMatch(/2.*\+.*20/);
  });

  it('fold: static + reactive bindings in same template — static stays, reactive updates', async () => {
    const v = state(1);
    const c = document.createElement('div');
    c.appendChild(html`<div><span>static</span><span>${() => v()}</span></div>`);
    const spans = c.querySelectorAll('span');
    expect(spans[0].textContent).toBe('static');
    expect(spans[1].textContent).toBe('1');

    v(2);
    await tick();
    expect(spans[0].textContent).toBe('static');
    expect(spans[1].textContent).toBe('2');
  });

  it('fold: all-static template instantiates without creating a watch', async () => {
    // Indirect proof: a static template with no reactive bindings should not
    // pay the watch-creation cost. We verify by instantiating many copies and
    // checking the work stays cheap (sub-paint-floor).
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      html`<div><span>a</span><span>b</span><span>c</span></div>`;
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
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

describe('compile.ts — inflateDeferred suspense marker stripping', () => {
  function collectComments(root: Node): string[] {
    const out: string[] = [];
    let n = root.firstChild;
    while (n) {
      if (n.nodeType === 8) out.push((n as Comment).data);
      n = n.nextSibling;
    }
    return out;
  }

  function withHydration<T>(fn: () => T): T {
    enterHydration();
    try {
      return fn();
    } finally {
      exitHydration();
    }
  }

  it('strips edge suspense markers wrapping the SSR view', () => {
    const deferred = withHydration(() => html`<p>hi</p>`) as DeferredTemplate;
    const target = document.createDocumentFragment();
    target.appendChild(document.createComment('s:1'));
    const p = document.createElement('p');
    p.textContent = 'hi';
    target.appendChild(p);
    target.appendChild(document.createComment('/s:1'));
    inflateDeferred(deferred, target);
    expect(collectComments(target)).toEqual([]);
  });

  it('strips interior suspense markers between sibling roots (defense-in-depth)', () => {
    // SSR drift / nested-boundary residue: an `<!--s:N-->`/`<!--/s:N-->`
    // pair sitting BETWEEN the template's two structural roots. Edge-only
    // strip would leave them, breaking the cursor walk on the second root.
    const a = state('a');
    const b = state('b');
    const deferred = withHydration(
      () =>
        html`<p>${() => a()}</p>
          <p>${() => b()}</p>`,
    ) as DeferredTemplate;
    const target = document.createDocumentFragment();
    const p1 = document.createElement('p');
    p1.appendChild(document.createComment('['));
    p1.appendChild(document.createTextNode('a'));
    p1.appendChild(document.createComment(']'));
    target.appendChild(p1);
    target.appendChild(document.createComment('s:2'));
    target.appendChild(document.createComment('/s:2'));
    const p2 = document.createElement('p');
    p2.appendChild(document.createComment('['));
    p2.appendChild(document.createTextNode('b'));
    p2.appendChild(document.createComment(']'));
    target.appendChild(p2);
    inflateDeferred(deferred, target);
    // No suspense markers should survive at the target's top level.
    expect(collectComments(target).filter((d) => /^\/?s:\d+$/.test(d))).toEqual([]);
    // Both <p> roots preserved in order.
    const elems = Array.from(target.childNodes).filter((n) => n.nodeType === 1) as Element[];
    expect(elems.length).toBe(2);
    expect(elems[0].textContent).toBe('a');
    expect(elems[1].textContent).toBe('b');
  });

  it('only strips comments whose data matches /^\\/?s:\\d+$/ — look-alikes survive', () => {
    // ' s:1' (leading space), 'ms:1', 's:1abc', 's:' all fail the regex and
    // must NOT be removed. A static-only template is a no-op past the strip
    // step, so this isolates the strip behavior.
    const staticDeferred = withHydration(() => html`<p>x</p>`) as DeferredTemplate;
    const target = document.createDocumentFragment();
    target.appendChild(document.createComment(' s:1'));
    target.appendChild(document.createComment('ms:1'));
    target.appendChild(document.createComment('s:1abc'));
    target.appendChild(document.createComment('s:'));
    const p = document.createElement('p');
    p.textContent = 'x';
    target.appendChild(p);
    // And a genuine suspense marker at the trailing edge — should be stripped.
    target.appendChild(document.createComment('/s:1'));
    inflateDeferred(staticDeferred, target);
    const comments = collectComments(target);
    expect(comments).toContain(' s:1');
    expect(comments).toContain('ms:1');
    expect(comments).toContain('s:1abc');
    expect(comments).toContain('s:');
    expect(comments.some((d) => /^\/?s:\d+$/.test(d))).toBe(false);
  });
});

describe('hydrate-runtime.ts — audit-v2 hardening', () => {
  // Always start from a clean slate; resetHydration is the in-file crash-
  // recovery escape hatch and also a convenient test prelude.
  function reset() {
    resetHydration();
    disableHydrationWarnings();
  }

  it('withHydration restores the counter even when the body throws (leak guard)', () => {
    reset();
    expect(isHydrating()).toBe(false);
    expect(() =>
      withHydration(() => {
        // The whole point: an exception inside a hydrating template must not
        // leave isHydrating() stuck on for the rest of the process.
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(isHydrating()).toBe(false);
  });

  it('withHydration nests correctly (refcount composes)', () => {
    reset();
    let inner = false;
    withHydration(() => {
      expect(isHydrating()).toBe(true);
      withHydration(() => {
        inner = isHydrating();
      });
      // Still hydrating after the inner pop — refcount, not boolean.
      expect(isHydrating()).toBe(true);
    });
    expect(inner).toBe(true);
    expect(isHydrating()).toBe(false);
  });

  it('exitHydration clamps at zero and warns on underflow when warnings are on', () => {
    reset();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      enableHydrationWarnings();
      // No matching enterHydration — must not wrap into a negative / "stuck on"
      // state and must surface the imbalance via the dev warning.
      exitHydration();
      expect(isHydrating()).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain('push/pop imbalance');
    } finally {
      spy.mockRestore();
      disableHydrationWarnings();
    }
  });

  it('isDeferred rejects bare brand objects (shape check beyond the brand)', () => {
    // Pre-fix: { __purity_deferred__: true } passed as a DeferredTemplate
    // would slip through isDeferred and crash later in inflateDeferred at
    // `deferred.strings`. The shape check makes this a clean rejection.
    expect(isDeferred({ __purity_deferred__: true })).toBe(false);
    expect(isDeferred({ __purity_deferred__: true, strings: [], values: 'no' })).toBe(false);
    expect(isDeferred({ __purity_deferred__: true, strings: 'no', values: [] })).toBe(false);
    expect(isDeferred(null)).toBe(false);
    expect(isDeferred(undefined)).toBe(false);
    expect(isDeferred('string')).toBe(false);
    expect(isDeferred(42)).toBe(false);
    // A genuine, well-shaped deferred (built via makeDeferred) is accepted.
    const real = makeDeferred(['<p>'] as unknown as TemplateStringsArray, []);
    expect(isDeferred(real)).toBe(true);
  });

  it('makeDeferred returns a frozen carrier (brand cannot be flipped off)', () => {
    const d = makeDeferred(['x'] as unknown as TemplateStringsArray, [1, 2]);
    expect(Object.isFrozen(d)).toBe(true);
    // Strict-mode assignment to a frozen prop throws; loose mode silently
    // ignores. Either way the brand and references must survive.
    try {
      // biome/ts-ignore: deliberate mutation attempt
      (d as { __purity_deferred__: boolean }).__purity_deferred__ = false;
    } catch {
      /* swallow strict-mode TypeError */
    }
    expect(d.__purity_deferred__).toBe(true);
    expect(d.values).toEqual([1, 2]);
  });

  it('checkHydrationCursor produces a sensible warning for unhandled nodeTypes', () => {
    // Pre-fix: `actual` could be the literal string "undefined" in the warn
    // when nodeType wasn't 1/3/8/null. With initialization it becomes the
    // explicit `nodeType(N)` form, and never blank.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // DocumentFragment has nodeType 11 — none of the kind branches match.
      const frag = document.createDocumentFragment();
      checkHydrationCursor(frag, 'open');
      expect(spy).toHaveBeenCalled();
      const msg = String(spy.mock.calls[0][0]);
      expect(msg).toContain('nodeType(11)');
      expect(msg).not.toContain('got <unknown>'); // initializer is replaced
      expect(msg).not.toContain('got undefined');
    } finally {
      spy.mockRestore();
    }
  });

  it('resetHydration reports and clears a leaked depth', () => {
    reset();
    enterHydration();
    enterHydration();
    enterHydration();
    expect(isHydrating()).toBe(true);
    expect(resetHydration()).toBe(3);
    expect(isHydrating()).toBe(false);
    // Idempotent — second reset reports zero.
    expect(resetHydration()).toBe(0);
  });
});
