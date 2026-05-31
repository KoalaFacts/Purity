import { describe, expect, it } from 'vitest';
import { generateSSR } from '../src/compiler/codegen.ts';
import { parse } from '../src/compiler/parser.ts';
import {
  isSSRHtml,
  markSSRHtml,
  type SSRComponentRenderer,
  setSSRComponentRenderer,
  ssrElement,
  ssrHelpers,
  valueToAttr,
  valueToHtml,
} from '../src/compiler/ssr-runtime.ts';
import { eachSSR, listSSR, matchSSR, whenSSR } from '../src/control.ts';

type SSRFactory = (
  values: unknown[],
  helpers: typeof ssrHelpers,
) => { __purity_ssr_html__: string };

function compileSSR(strings: TemplateStringsArray | string[], ...values: unknown[]): string {
  const arr = Array.isArray(strings) ? strings : Array.from(strings);
  const ast = parse(arr as unknown as TemplateStringsArray);
  const code = generateSSR(ast);
  const factory = new Function(`return ${code}`)() as SSRFactory;
  return factory(values, ssrHelpers).__purity_ssr_html__;
}

describe('generateSSR — static templates', () => {
  it('renders an empty fragment', () => {
    expect(compileSSR([''])).toBe('');
  });

  it('renders a single element', () => {
    expect(compileSSR(['<div></div>'])).toBe('<div></div>');
  });

  it('renders nested elements', () => {
    expect(compileSSR(['<div><p>hi</p></div>'])).toBe('<div><p>hi</p></div>');
  });

  it('renders text with HTML escaping (& becomes &amp;)', () => {
    // The parser treats `<` as a tag start, so we test ampersand escaping in
    // text content. Element-like input (`<c>`) is actually an element, not
    // text — that path is separately covered by the static-attrs case.
    expect(compileSSR(['<p>a & b</p>'])).toBe('<p>a &amp; b</p>');
  });

  it('renders static attributes with escaping', () => {
    expect(compileSSR(['<div class="a&b" data-x="<>"></div>'])).toBe(
      '<div class="a&amp;b" data-x="&lt;&gt;"></div>',
    );
  });

  it('renders boolean static attributes with no value', () => {
    expect(compileSSR(['<input disabled />'])).toBe('<input disabled/>');
  });

  it('self-closes void elements', () => {
    expect(compileSSR(['<br><hr><img src="x.png">'])).toBe('<br/><hr/><img src="x.png"/>');
  });

  it('emits `<!doctype html>` verbatim (raw text, not escaped)', () => {
    // ADR 0033 follow-up: regression test for the parser's doctype
    // handling. Before the fix, an html`` template that started with
    // `<!doctype html>` infinite-looped the parser; this test pins the
    // emit shape so SSR output ships a valid doctype.
    expect(compileSSR(['<!doctype html><html><body></body></html>'])).toBe(
      '<!doctype html><html><body></body></html>',
    );
  });

  it('emits `<!DOCTYPE html>` (uppercase) verbatim', () => {
    expect(compileSSR(['<!DOCTYPE html>'])).toBe('<!DOCTYPE html>');
  });

  it('emits doctype + expression interpolation correctly', () => {
    // The two paths (buildStaticHtml fast-path vs buildSSRBody slow-path
    // with expressions) both need the raw-emit branch. Force the slow
    // path by including a `${}` slot.
    expect(compileSSR(['<!doctype html><title>', '</title>'], 'Page')).toContain('<!doctype html>');
  });

  it('renders comments', () => {
    expect(compileSSR(['<!-- hi --><div></div>'])).toBe('<!-- hi --><div></div>');
  });

  it('renders multiple top-level elements as a fragment', () => {
    expect(compileSSR(['<a></a><b></b>'])).toBe('<a></a><b></b>');
  });

  it('emits a static-string fast path with no _v / _h refs', () => {
    const ast = parse(['<div>hello</div>']);
    const code = generateSSR(ast);
    expect(code).not.toContain('_v[');
    expect(code).not.toContain('_h.');
  });
});

describe('generateSSR — expression slots', () => {
  it('renders a reactive expression with hydration markers', () => {
    expect(compileSSR(['<p>', '</p>'], 'hello')).toBe('<p><!--[-->hello<!--]--></p>');
  });

  it('escapes expression text', () => {
    expect(compileSSR(['<p>', '</p>'], '<script>alert(1)</script>')).toBe(
      '<p><!--[-->&lt;script&gt;alert(1)&lt;/script&gt;<!--]--></p>',
    );
  });

  it('calls signal accessors and escapes the result', () => {
    expect(compileSSR(['<p>', '</p>'], () => '42')).toBe('<p><!--[-->42<!--]--></p>');
  });

  it('renders null / undefined / false as empty string', () => {
    expect(compileSSR(['<p>', '</p>'], null)).toBe('<p><!--[--><!--]--></p>');
    expect(compileSSR(['<p>', '</p>'], undefined)).toBe('<p><!--[--><!--]--></p>');
    expect(compileSSR(['<p>', '</p>'], false)).toBe('<p><!--[--><!--]--></p>');
  });

  it('concatenates branded SSR HTML wrappers raw', () => {
    const inner = markSSRHtml('<span>raw</span>');
    expect(compileSSR(['<div>', '</div>'], inner)).toBe(
      '<div><!--[--><span>raw</span><!--]--></div>',
    );
  });

  it('renders an array of mixed values', () => {
    expect(compileSSR(['<ul>', '</ul>'], ['a', markSSRHtml('<li>b</li>'), 1])).toBe(
      '<ul><!--[-->a<li>b</li>1<!--]--></ul>',
    );
  });

  it('places adjacent expressions side-by-side with paired markers', () => {
    expect(compileSSR(['<p>', ' ', '</p>'], 'a', 'b')).toBe(
      '<p><!--[-->a<!--]--> <!--[-->b<!--]--></p>',
    );
  });
});

describe('generateSSR — dynamic attributes', () => {
  it('renders a dynamic attribute with a literal value', () => {
    expect(compileSSR(['<div class=', '></div>'], 'box')).toBe('<div class="box"></div>');
  });

  it('omits a dynamic attribute when value is null', () => {
    expect(compileSSR(['<div class=', '></div>'], null)).toBe('<div></div>');
  });

  it('omits a dynamic attribute when value is false', () => {
    expect(compileSSR(['<div class=', '></div>'], false)).toBe('<div></div>');
  });

  it('renders an empty-string dynamic attribute as boolean form', () => {
    expect(compileSSR(['<div class=', '></div>'], '')).toBe('<div class></div>');
  });

  it('escapes dynamic attribute values', () => {
    expect(compileSSR(['<div title=', '></div>'], 'a"b<c')).toBe(
      '<div title="a&quot;b&lt;c"></div>',
    );
  });

  it('calls signal accessors for dynamic attributes', () => {
    expect(compileSSR(['<div class=', '></div>'], () => 'live')).toBe('<div class="live"></div>');
  });

  it('renders ?bool attributes as bare names when truthy', () => {
    expect(compileSSR(['<input ?disabled=', ' />'], true)).toBe('<input disabled/>');
    expect(compileSSR(['<input ?disabled=', ' />'], false)).toBe('<input/>');
  });

  it('?bool attributes render as bare name for any truthy value (matches client setAttribute, no hydration drift)', () => {
    // Boolean attributes have presence-only semantics per HTML spec, and
    // the client codegen uses `truthy → setAttribute('')` regardless of
    // the value's shape. The SSR side must agree — otherwise a truthy
    // non-boolean value (e.g. `?disabled=${'yes'}`) renders as
    // `disabled="yes"` on the server but `disabled=""` on the client, a
    // silent hydration mismatch.
    expect(compileSSR(['<input ?disabled=', ' />'], 'yes')).toBe('<input disabled/>');
    expect(compileSSR(['<input ?disabled=', ' />'], 1)).toBe('<input disabled/>');
    expect(compileSSR(['<input ?disabled=', ' />'], {})).toBe('<input disabled/>');
    // Falsy non-boolean: omitted (matches removeAttribute on client).
    expect(compileSSR(['<input ?disabled=', ' />'], 0)).toBe('<input/>');
    expect(compileSSR(['<input ?disabled=', ' />'], '')).toBe('<input/>');
    expect(compileSSR(['<input ?disabled=', ' />'], null)).toBe('<input/>');
    expect(compileSSR(['<input ?disabled=', ' />'], undefined)).toBe('<input/>');
  });

  it('?bool attributes on custom elements also collapse to bare name for any truthy value', () => {
    // Custom elements flow through emitCustomElement → plainElement →
    // valueToAttr, which doesn't know about boolean semantics and would
    // emit `disabled="yes"` for a truthy non-boolean. Client setAttribute
    // emits `disabled=""`. Same hydration drift as above, just routed
    // through a different code path.
    expect(compileSSR(['<my-el ?disabled=', '></my-el>'], 'yes')).toBe('<my-el disabled></my-el>');
    expect(compileSSR(['<my-el ?disabled=', '></my-el>'], 1)).toBe('<my-el disabled></my-el>');
    expect(compileSSR(['<my-el ?disabled=', '></my-el>'], true)).toBe('<my-el disabled></my-el>');
    expect(compileSSR(['<my-el ?disabled=', '></my-el>'], false)).toBe('<my-el></my-el>');
    expect(compileSSR(['<my-el ?disabled=', '></my-el>'], null)).toBe('<my-el></my-el>');
  });

  it('emits a nested dynamic attr into the custom element slot, not the outer buffer (no fragment leak)', () => {
    // emitCustomElement captures children into a per-instance `_slot<id>`
    // buffer by swapping `ctx.out`. emitSSRAttr's dynamic/prop/bind + bool
    // branches previously hardcoded the literal `_o` instead of `ctx.out`, so a
    // nested element's attribute fragment leaked OUT of the slot and appeared
    // before the custom element opened (audit codegen.ts:1230,1237). Both the
    // quoted-attr and bool branches are exercised here.
    expect(compileSSR(['<my-el><span :class=', '>x</span></my-el>'], 'red')).toBe(
      '<my-el><span class="red">x</span></my-el>',
    );
    expect(compileSSR(['<my-el><input ?disabled=', ' /></my-el>'], true)).toBe(
      '<my-el><input disabled/></my-el>',
    );
  });

  it('renders .prop attributes as quoted attribute on the server', () => {
    expect(compileSSR(['<input .value=', ' />'], 'hi')).toBe('<input value="hi"/>');
  });

  it('renders :reactive-prop attributes', () => {
    expect(compileSSR(['<p-card :title=', '></p-card>'], 'hi')).toBe(
      '<p-card title="hi"></p-card>',
    );
  });

  it('renders :: bind by reading the current signal value', () => {
    expect(compileSSR(['<input ::value=', ' />'], () => 'typed')).toBe('<input value="typed"/>');
  });

  it('skips @event attributes entirely', () => {
    const handler = () => {};
    expect(compileSSR(['<button @click=', '>X</button>'], handler)).toBe('<button>X</button>');
  });

  it('combines multiple static and dynamic attributes', () => {
    expect(compileSSR(['<a href=', ' class="link" ?disabled=', '>Go</a>'], '/x', false)).toBe(
      '<a href="/x" class="link">Go</a>',
    );
  });

  // ::group is radio/checkbox group binding (client sets `_e.checked` from the
  // signal), NOT a real attribute. SSR must resolve it to `checked` server-side
  // — it previously emitted a bogus `group="…"` attribute with no `checked`, so
  // a prerendered group showed no selection until hydration ran (audit
  // codegen.ts:1229).
  it('::group radio binding emits `checked` when the signal matches value (no `group` attr)', () => {
    const out = compileSSR(['<input type="radio" name="g" value="a" ::group=', ' />'], () => 'a');
    expect(out).toBe('<input type="radio" name="g" value="a" checked/>');
    expect(out).not.toContain('group=');
  });

  it('::group radio binding omits `checked` when the signal does not match value', () => {
    expect(compileSSR(['<input type="radio" name="g" value="a" ::group=', ' />'], () => 'b')).toBe(
      '<input type="radio" name="g" value="a"/>',
    );
  });

  it('::group checkbox binding emits `checked` when value is in the signal array', () => {
    expect(
      compileSSR(['<input type="checkbox" name="g" value="a" ::group=', ' />'], () => ['a', 'c']),
    ).toBe('<input type="checkbox" name="g" value="a" checked/>');
    expect(
      compileSSR(['<input type="checkbox" name="g" value="a" ::group=', ' />'], () => ['c']),
    ).toBe('<input type="checkbox" name="g" value="a"/>');
  });

  it('::group with no static value defers selection to the client (no `checked`, no `group`)', () => {
    // Server can't resolve which input is selected without a concrete value to
    // compare against — omit `checked` and let hydration set it, but never emit
    // the bogus `group` attribute.
    const out = compileSSR(['<input type="radio" name="g" ::group=', ' />'], () => 'a');
    expect(out).toBe('<input type="radio" name="g"/>');
    expect(out).not.toContain('group=');
    expect(out).not.toContain('checked');
  });

  // Non-reflecting DOM properties (`.innerHTML`, `.textContent`, …) are assigned
  // as properties on the client; serializing them as same-named attributes is a
  // no-op the browser never interprets — and for `.innerHTML` the markup is
  // HTML-escaped into a dead attribute. Skip them server-side (audit
  // codegen.ts:1222-1232). The property assignment runs at hydration.
  it('skips non-reflecting `.innerHTML` prop server-side (no dead escaped attribute)', () => {
    expect(compileSSR(['<div .innerHTML=', '></div>'], '<b>x</b>')).toBe('<div></div>');
  });

  it('skips non-reflecting `.textContent` / `.innerText` / `.outerHTML` props server-side', () => {
    expect(compileSSR(['<div .textContent=', '></div>'], 'hi')).toBe('<div></div>');
    expect(compileSSR(['<div .innerText=', '></div>'], 'hi')).toBe('<div></div>');
    expect(compileSSR(['<div .outerHTML=', '></div>'], '<i>x</i>')).toBe('<div></div>');
  });

  it('skips a non-reflecting prop via :reactive-prop and :: bind too', () => {
    expect(compileSSR(['<div :innerHTML=', '></div>'], '<b>x</b>')).toBe('<div></div>');
    expect(compileSSR(['<div ::innerHTML=', '></div>'], () => '<b>x</b>')).toBe('<div></div>');
  });

  it('still emits reflecting `.value` prop server-side (allowlist of skipped props is narrow)', () => {
    expect(compileSSR(['<input .value=', ' />'], 'hi')).toBe('<input value="hi"/>');
  });

  it('keeps setAttribute semantics for a `dynamic` attr that happens to be named innerHTML', () => {
    // Only the property-ish kinds (.prop / :reactive-prop / ::bind) skip
    // non-reflecting names. A plain dynamic attr keeps true setAttribute output.
    expect(compileSSR(['<div innerHTML=', '></div>'], 'x')).toBe('<div innerHTML="x"></div>');
  });
});

describe('generateSSR — safety', () => {
  // Bypass the parser to construct ASTs that contain unsafe names — the
  // parser's own validation would reject these inputs first, so we can't
  // exercise the codegen guard via parse().
  it('rejects unsafe tag names at codegen time', () => {
    const bad: import('../src/compiler/ast.ts').FragmentNode = {
      type: 'fragment',
      children: [
        {
          type: 'element',
          tag: "div'><script>",
          attributes: [],
          children: [],
          isVoid: false,
        },
      ],
    };
    expect(() => generateSSR(bad)).toThrow(/Invalid tag name/);
  });

  it('rejects unsafe attribute names at codegen time', () => {
    const bad: import('../src/compiler/ast.ts').FragmentNode = {
      type: 'fragment',
      children: [
        {
          type: 'element',
          tag: 'div',
          attributes: [{ kind: 'dynamic', name: 'a"b', index: 0 }],
          children: [],
          isVoid: false,
        },
      ],
    };
    expect(() => generateSSR(bad)).toThrow(/Invalid attribute name/);
  });
});

describe('ssr-runtime helpers', () => {
  it('isSSRHtml returns true for branded wrappers only', () => {
    expect(isSSRHtml(markSSRHtml('x'))).toBe(true);
    expect(isSSRHtml({ __purity_ssr_html__: 'x' })).toBe(true);
    expect(isSSRHtml('x')).toBe(false);
    expect(isSSRHtml(null)).toBe(false);
    expect(isSSRHtml({})).toBe(false);
  });

  it('valueToHtml escapes primitives', () => {
    expect(valueToHtml('a&b')).toBe('a&amp;b');
    expect(valueToHtml(42)).toBe('42');
    expect(valueToHtml(null)).toBe('');
    expect(valueToHtml(undefined)).toBe('');
    expect(valueToHtml(false)).toBe('');
    expect(valueToHtml(true)).toBe('true');
  });

  it('valueToHtml unwraps signal accessors', () => {
    expect(valueToHtml(() => 'live')).toBe('live');
  });

  it('valueToHtml flattens arrays', () => {
    expect(valueToHtml(['a', 1, markSSRHtml('<b>!</b>')])).toBe('a1<b>!</b>');
  });

  it('valueToHtml terminates on self-referential array (cycle guard)', () => {
    // Regression: prior to the WeakSet guard, a cyclic array stack-overflowed
    // the SSR render. Repeat occurrences of an already-visited array now
    // render as empty so the surrounding render stays correct.
    const a: unknown[] = ['x'];
    a.push(a);
    a.push('y');
    expect(valueToHtml(a)).toBe('xy');
  });

  it('valueToHtml handles mutually recursive arrays without overflow', () => {
    const a: unknown[] = ['a'];
    const b: unknown[] = ['b', a];
    a.push(b);
    expect(() => valueToHtml(a)).not.toThrow();
  });

  it('valueToAttr returns null for omitted, empty for boolean-true', () => {
    expect(valueToAttr(null)).toBe(null);
    expect(valueToAttr(undefined)).toBe(null);
    expect(valueToAttr(false)).toBe(null);
    expect(valueToAttr(true)).toBe('');
    expect(valueToAttr('a"b')).toBe('a&quot;b');
  });

  it('setSSRComponentRenderer is idempotent for the same function reference', () => {
    // Regression: prior to the idempotency guard, re-importing @purityjs/ssr
    // (test setup churn, ESM dual instantiation) would silently overwrite the
    // renderer. Same-reference re-install is now a no-op so double-imports
    // are harmless.
    const renderer: SSRComponentRenderer = () => null;
    setSSRComponentRenderer(null);
    setSSRComponentRenderer(renderer);
    expect(() => setSSRComponentRenderer(renderer)).not.toThrow();
    // Cleanup so subsequent tests / other suites in this process see a clean slate.
    setSSRComponentRenderer(null);
  });

  it('setSSRComponentRenderer throws on a conflicting renderer', () => {
    // A real conflict (two different SSR implementations racing to register)
    // must surface loudly instead of silent last-write-wins.
    const a: SSRComponentRenderer = () => null;
    const b: SSRComponentRenderer = () => null;
    setSSRComponentRenderer(null);
    setSSRComponentRenderer(a);
    expect(() => setSSRComponentRenderer(b)).toThrow(/different renderer is already installed/);
    // Cleanup — null is always accepted, and re-installing `a` is a no-op now.
    setSSRComponentRenderer(null);
  });

  it('ssrElement skips attribute keys that would break out of the name', () => {
    // Defense-in-depth on the public `_h.element` entry point: caller-
    // controlled attr keys (e.g. spread from JSON) containing `=`, `>`, or
    // whitespace would otherwise inject raw HTML via the plainElement
    // fallback. They are now dropped instead of emitted.
    const out = ssrElement(
      'x-card',
      {
        'safe-attr': 'ok',
        'evil onmouseover=alert(1) x': 'pwn',
        'a">b': 'pwn',
        'with space': 'pwn',
      },
      '',
    );
    expect(out).toBe('<x-card safe-attr="ok"></x-card>');
  });
});

describe('SSR control flow', () => {
  it('matchSSR renders the active case wrapped in markers', () => {
    const out = matchSSR(() => 'b' as string, {
      a: () => 'A',
      b: () => 'B',
    });
    expect(out.__purity_ssr_html__).toBe('<!--m:b-->B<!--/m-->');
  });

  it('matchSSR uses fallback when no case matches', () => {
    const out = matchSSR(
      () => 'z' as string,
      { a: () => 'A' },
      () => 'F',
    );
    expect(out.__purity_ssr_html__).toBe('<!--m:z-->F<!--/m-->');
  });

  it('matchSSR with no case and no fallback renders empty markers', () => {
    const out = matchSSR(() => 'z' as string, {});
    expect(out.__purity_ssr_html__).toBe('<!--m:z--><!--/m-->');
  });

  it('whenSSR picks the then branch', () => {
    const out = whenSSR(
      () => true,
      () => 'YES',
      () => 'NO',
    );
    expect(out.__purity_ssr_html__).toBe('<!--m:true-->YES<!--/m-->');
  });

  it('whenSSR picks the else branch', () => {
    const out = whenSSR(
      () => false,
      () => 'YES',
      () => 'NO',
    );
    expect(out.__purity_ssr_html__).toBe('<!--m:false-->NO<!--/m-->');
  });

  it('whenSSR with no else renders empty markers', () => {
    const out = whenSSR(
      () => false,
      () => 'YES',
    );
    expect(out.__purity_ssr_html__).toBe('<!--m:false--><!--/m-->');
  });

  it('eachSSR concatenates mapped items', () => {
    const items = ['a', 'b', 'c'];
    const out = eachSSR(items, (item) => item());
    expect(out.__purity_ssr_html__).toBe(
      '<!--e--><!--er:a-->a<!--/er--><!--er:b-->b<!--/er--><!--er:c-->c<!--/er--><!--/e-->',
    );
  });

  it('eachSSR escapes string returns', () => {
    const out = eachSSR(['<x>'], (item) => item());
    expect(out.__purity_ssr_html__).toBe('<!--e--><!--er:%3Cx%3E-->&lt;x&gt;<!--/er--><!--/e-->');
  });

  it('eachSSR concatenates branded HTML returns raw', () => {
    const out = eachSSR([1, 2], (item) => markSSRHtml(`<li>${item()}</li>`));
    expect(out.__purity_ssr_html__).toBe(
      '<!--e--><!--er:1--><li>1</li><!--/er--><!--er:2--><li>2</li><!--/er--><!--/e-->',
    );
  });

  it('eachSSR passes index to mapFn', () => {
    const out = eachSSR(['a', 'b'], (item, i) => `${i}:${item()}`);
    expect(out.__purity_ssr_html__).toBe(
      '<!--e--><!--er:a-->0:a<!--/er--><!--er:b-->1:b<!--/er--><!--/e-->',
    );
  });

  it('eachSSR encodes keys safely (dashes, slashes, unicode)', () => {
    const out = eachSSR(
      [
        { id: 'a-b', label: 'one' },
        { id: 'a--b', label: 'two' },
        { id: 'café/3', label: 'three' },
      ],
      (item) => item().label,
      (item) => item.id,
    );
    // - is rewritten to %2D so two consecutive dashes can never appear, and
    // unicode + slashes go through encodeURIComponent.
    expect(out.__purity_ssr_html__).toBe(
      '<!--e-->' +
        '<!--er:a%2Db-->one<!--/er-->' +
        '<!--er:a%2D%2Db-->two<!--/er-->' +
        '<!--er:caf%C3%A9%2F3-->three<!--/er-->' +
        '<!--/e-->',
    );
  });

  it('listSSR builds simple text rows', () => {
    const out = listSSR('li', ['a', 'b'], (s) => s);
    expect(out.__purity_ssr_html__).toBe('<!--l--><li>a</li><li>b</li><!--/l-->');
  });

  it('listSSR escapes text + attributes', () => {
    const out = listSSR('li', ['<x>'], {
      text: (s) => s,
      class: () => 'a"b',
    });
    expect(out.__purity_ssr_html__).toBe('<!--l--><li class="a&quot;b">&lt;x&gt;</li><!--/l-->');
  });

  it('listSSR handles attrs object and skips events', () => {
    const out = listSSR('li', [{ id: 1 }], {
      text: (item) => String(item.id),
      attrs: { 'data-id': (item) => String(item.id) },
      events: { click: () => () => {} },
    });
    expect(out.__purity_ssr_html__).toBe('<!--l--><li data-id="1">1</li><!--/l-->');
  });

  it('listSSR rejects or escapes hostile attribute NAMES (no XSS via attrs key)', () => {
    // The attrs object key was interpolated raw into the tag, so a hostile
    // name like `foo"><script>alert(1)</script>` could break out of the
    // opening tag. Validate that listSSR doesn't emit a tag-attribute name
    // that contains characters which can terminate the tag context.
    const out = listSSR('li', [{ id: 1 }], {
      text: (item) => String(item.id),
      attrs: { 'foo"><script>alert(1)</script>': () => 'x' },
    });
    const html = out.__purity_ssr_html__;
    // The literal `"><script>` MUST NOT appear unescaped inside the tag.
    expect(html).not.toMatch(/<li[^>]*"><script/);
    // Either the bad name is skipped entirely or its quote/angle-bracket
    // chars are escaped; in both cases the script tag literal is absent.
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('listSSR rejects hostile tag NAMES (no XSS via tag arg)', () => {
    // Sibling to the attrs-key fix: the `tag` parameter was raw-
    // interpolated into the opening + closing tag positions, so a
    // hostile string escapes the tag context and injects markup.
    // listSSR(userTag, …) is reachable when the tag comes from a
    // dynamic dispatch / loop over manifest entries.
    const out = listSSR('li><script>alert(1)</script><li', [{ id: 1 }], {
      text: (item) => String(item.id),
    });
    const html = out.__purity_ssr_html__;
    expect(html).not.toContain('<script>alert(1)</script>');
    // The hostile tag must be dropped — emit empty list rather than
    // half-rendered markup.
    expect(html).toBe('<!--l--><!--/l-->');
  });
});

describe('generateSSR — integration with control flow', () => {
  it('embeds eachSSR output via a reactive expression', () => {
    const out = compileSSR(
      ['<ul>', '</ul>'],
      eachSSR(['a', 'b'], (item) => markSSRHtml(`<li>${item()}</li>`)),
    );
    expect(out).toBe(
      '<ul><!--[--><!--e-->' +
        '<!--er:a--><li>a</li><!--/er-->' +
        '<!--er:b--><li>b</li><!--/er-->' +
        '<!--/e--><!--]--></ul>',
    );
  });

  it('embeds whenSSR output', () => {
    const out = compileSSR(
      ['<div>', '</div>'],
      whenSSR(
        () => true,
        () => markSSRHtml('<p>shown</p>'),
      ),
    );
    expect(out).toBe('<div><!--[--><!--m:true--><p>shown</p><!--/m--><!--]--></div>');
  });
});
