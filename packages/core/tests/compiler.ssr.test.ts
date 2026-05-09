import { describe, expect, it } from 'vitest';
import { generateSSR } from '../src/compiler/codegen.ts';
import { parse } from '../src/compiler/parser.ts';
import {
  isSSRHtml,
  markSSRHtml,
  ssrHelpers,
  valueToAttr,
  valueToHtml,
} from '../src/compiler/ssr-runtime.ts';
import { eachSSR, listSSR, matchSSR, whenSSR } from '../src/control.ts';

type SSRFactory = (values: unknown[], helpers: typeof ssrHelpers) => string;

function compileSSR(strings: TemplateStringsArray | string[], ...values: unknown[]): string {
  const arr = Array.isArray(strings) ? strings : Array.from(strings);
  const ast = parse(arr as unknown as TemplateStringsArray);
  const code = generateSSR(ast);
  const factory = new Function(`return ${code}`)() as SSRFactory;
  return factory(values, ssrHelpers);
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

  it('valueToAttr returns null for omitted, empty for boolean-true', () => {
    expect(valueToAttr(null)).toBe(null);
    expect(valueToAttr(undefined)).toBe(null);
    expect(valueToAttr(false)).toBe(null);
    expect(valueToAttr(true)).toBe('');
    expect(valueToAttr('a"b')).toBe('a&quot;b');
  });
});

describe('SSR control flow', () => {
  it('matchSSR renders the active case wrapped in markers', () => {
    const out = matchSSR(() => 'b' as string, {
      a: () => 'A',
      b: () => 'B',
    });
    expect(out.__purity_ssr_html__).toBe('<!--m-->B<!--/m-->');
  });

  it('matchSSR uses fallback when no case matches', () => {
    const out = matchSSR(
      () => 'z' as string,
      { a: () => 'A' },
      () => 'F',
    );
    expect(out.__purity_ssr_html__).toBe('<!--m-->F<!--/m-->');
  });

  it('matchSSR with no case and no fallback renders empty markers', () => {
    const out = matchSSR(() => 'z' as string, {});
    expect(out.__purity_ssr_html__).toBe('<!--m--><!--/m-->');
  });

  it('whenSSR picks the then branch', () => {
    const out = whenSSR(
      () => true,
      () => 'YES',
      () => 'NO',
    );
    expect(out.__purity_ssr_html__).toBe('<!--m-->YES<!--/m-->');
  });

  it('whenSSR picks the else branch', () => {
    const out = whenSSR(
      () => false,
      () => 'YES',
      () => 'NO',
    );
    expect(out.__purity_ssr_html__).toBe('<!--m-->NO<!--/m-->');
  });

  it('whenSSR with no else renders empty markers', () => {
    const out = whenSSR(
      () => false,
      () => 'YES',
    );
    expect(out.__purity_ssr_html__).toBe('<!--m--><!--/m-->');
  });

  it('eachSSR concatenates mapped items', () => {
    const items = ['a', 'b', 'c'];
    const out = eachSSR(items, (item) => item());
    expect(out.__purity_ssr_html__).toBe('<!--e-->abc<!--/e-->');
  });

  it('eachSSR escapes string returns', () => {
    const out = eachSSR(['<x>'], (item) => item());
    expect(out.__purity_ssr_html__).toBe('<!--e-->&lt;x&gt;<!--/e-->');
  });

  it('eachSSR concatenates branded HTML returns raw', () => {
    const out = eachSSR([1, 2], (item) => markSSRHtml(`<li>${item()}</li>`));
    expect(out.__purity_ssr_html__).toBe('<!--e--><li>1</li><li>2</li><!--/e-->');
  });

  it('eachSSR passes index to mapFn', () => {
    const out = eachSSR(['a', 'b'], (item, i) => `${i}:${item()}`);
    expect(out.__purity_ssr_html__).toBe('<!--e-->0:a1:b<!--/e-->');
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
});

describe('generateSSR — integration with control flow', () => {
  it('embeds eachSSR output via a reactive expression', () => {
    const out = compileSSR(
      ['<ul>', '</ul>'],
      eachSSR(['a', 'b'], (item) => markSSRHtml(`<li>${item()}</li>`)),
    );
    expect(out).toBe('<ul><!--[--><!--e--><li>a</li><li>b</li><!--/e--><!--]--></ul>');
  });

  it('embeds whenSSR output', () => {
    const out = compileSSR(
      ['<div>', '</div>'],
      whenSSR(
        () => true,
        () => markSSRHtml('<p>shown</p>'),
      ),
    );
    expect(out).toBe('<div><!--[--><!--m--><p>shown</p><!--/m--><!--]--></div>');
  });
});
