// Cross-path conformance: the same template + values must produce the same
// visible DOM whether rendered by the client (CSR `html```), rendered to a
// string by the SSR codegen, or SSR output adopted by `hydrate()`.
//
// Comparison is done on parsed DOM, not raw strings, so entity-encoding
// differences that the browser normalises away (`&quot;` vs `"`) don't count
// as drift. Hydration comment markers and each() bookkeeping comments are
// stripped; everything else (elements, attributes, text, raw-text content)
// must match exactly.

import { describe, expect, it, vi } from 'vite-plus/test';
import { generate, generateModule, generateSSR } from '../src/compiler/codegen.ts';
import { parse } from '../src/compiler/parser.ts';
import { namedReferences } from '../src/compiler/character-references.ts';
import { markSSRHtml, rawEnd, ssrHelpers } from '../src/compiler/ssr-runtime.ts';
import { eachSSR, matchSSR, whenSSR } from '../src/control.ts';
import { each, html, hydrate, mount, state, when } from '../src/index.ts';
import { tick } from './_helpers.ts';

type Mode = 'csr' | 'ssr';
type SSRFactory = (
  values: unknown[],
  helpers: typeof ssrHelpers,
) => { __purity_ssr_html__: string };

const tpl = (strings: string[]): TemplateStringsArray =>
  Object.assign([...strings], { raw: strings }) as unknown as TemplateStringsArray;

/** Compile a template through the SSR codegen and render it to a string. */
function renderSSR(strings: string[], values: unknown[]): string {
  const code = generateSSR(parse(tpl(strings)));
  const factory = new Function(`return ${code}`)() as SSRFactory;
  return factory(values, ssrHelpers).__purity_ssr_html__;
}

/** Parse markup into a detached DOM and drop comments; return canonical innerHTML. */
function normalize(markup: string): string {
  const root = document.createElement('div');
  root.innerHTML = markup;
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) child.remove();
      else walk(child);
    }
  };
  walk(root);
  // SSR writes `<` in dynamic <style> content as the CSS escape `\3c ` (same
  // CSS, but no `<` that could form a tag in any context); compare it as `<`.
  for (const style of Array.from(root.querySelectorAll('style'))) {
    style.textContent = (style.textContent ?? '').split('\\3c ').join('<');
  }
  return root.innerHTML;
}

function renderCSR(strings: string[], values: unknown[]): string {
  const host = document.createElement('div');
  host.appendChild(html(tpl(strings), ...values) as Node);
  return normalize(host.innerHTML);
}

interface Case {
  name: string;
  strings: string[];
  /** Fresh values per mode; SSR mode must use the *SSR* helpers (eachSSR, markSSRHtml). */
  values: (mode: Mode) => unknown[];
  /**
   * Set when the drift is a known, unfixed defect. The
   * case is asserted with it.fails so the suite stays green while the defect
   * exists, and turns red (prompting removal of this flag) once it is fixed.
   */
  knownDefect?: string;
}

const LI = ['<li>', '</li>'];

const cases: Case[] = [
  {
    name: 'escapes special characters in text',
    strings: ['<p>', '</p>'],
    values: () => ['<b>&"\'</b>'],
  },
  {
    name: 'escapes special characters in attribute values',
    strings: ['<a title=', ' data-q=', '>x</a>'],
    values: () => ['a"b<c>&\'', 'q"'],
  },
  {
    name: 'null, undefined, false, 0, true and empty string',
    strings: ['<p>[', '|', '|', '|', '|', '|', ']</p>'],
    values: () => [null, undefined, false, 0, true, ''],
  },
  {
    name: 'flat arrays concatenate items and skip nullish',
    strings: ['<p>', '</p>'],
    values: () => [['a', null, 'b', 1]],
  },
  {
    name: 'nested arrays flatten (simple template)',
    strings: ['<p>', '</p>'],
    values: () => [[['a', 'b'], 'c']],
  },
  {
    name: 'nested arrays flatten (complex template)',
    strings: ['<section><p>', '</p><i>', '</i></section>'],
    values: () => [[['a', 'b'], 'c'], 'z'],
  },
  {
    name: 'array items that are functions or signals are called',
    strings: ['<p>', '</p>'],
    values: () => [[() => 'fn', state('s'), 'x']],
  },
  {
    name: 'array items that are functions (complex template)',
    strings: ['<section><p>', '</p></section>'],
    values: () => [[() => 'fn', 'x']],
  },
  {
    name: 'signal returning a nested array renders flattened text',
    strings: ['<p>', '</p>'],
    values: () => [() => [['a', 'b'], 'c', null]],
  },
  {
    name: 'signal returning nodes or templates renders them',
    strings: ['<p>', '</p>'],
    values: (mode) => [
      () => [mode === 'csr' ? html(tpl(LI), 'a') : markSSRHtml(renderSSR(LI, ['a']))],
    ],
    knownDefect:
      'reactive binding stringifies Node items ("[object DocumentFragment]"); needs range reconciliation',
  },
  {
    name: 'signal returning a function renders it once, as SSR does',
    strings: ['<p>', '</p>'],
    values: () => [() => () => 'inner'],
  },
  {
    name: 'cyclic and repeated arrays render each array once',
    strings: ['<p>', '</p>'],
    values: () => {
      const a: unknown[] = ['x'];
      a.push(a);
      const b = ['y'];
      return [[a, b, b], 'z'];
    },
  },
  {
    name: 'nested templates render their own output',
    strings: ['<ul>', '</ul>'],
    values: (mode) => [mode === 'csr' ? html(tpl(LI), 'a') : markSSRHtml(renderSSR(LI, ['a']))],
  },
  {
    name: 'each() list output',
    strings: ['<ul>', '</ul>'],
    values: (mode) => {
      const items = () => ['a', 'b'];
      if (mode === 'csr') {
        return [each(items, (item) => html(tpl(LI), item))];
      }
      return [eachSSR(items, (item) => markSSRHtml(renderSSR(LI, [item])))];
    },
  },
  {
    name: 'inter-element whitespace is condensed identically',
    strings: ['<p>\n  <b>one</b>\n  <i>', '</i>\n</p>\n'],
    values: () => ['two'],
  },
  {
    name: 'SVG attributes keep their case',
    strings: ['<svg viewBox="0 0 10 10"><circle r=', '></circle></svg>'],
    values: () => [5],
  },
  {
    name: 'raw-text <style> keeps CSS verbatim',
    strings: ['<style>a > b { content: "', '" }</style>'],
    values: () => ['x&y'],
  },
  {
    name: 'raw-text <textarea> keeps angle brackets as text',
    strings: ['<textarea>', '</textarea>'],
    values: () => ['a <b> & c'],
  },
  {
    name: 'raw-text element nested in a wrapper (complex template)',
    strings: ['<div><style>a > b { color: ', ' }</style></div>'],
    values: () => ['red'],
  },
  {
    name: 'raw-text element beside other roots',
    strings: ['<style>a > b { color: ', ' }</style><p>', '</p>'],
    values: () => ['red', 'x&y'],
  },
  {
    name: 'upper-case raw-text tags match case-insensitively',
    strings: ['<STYLE>a > b { content: "', '" }</STYLE><div><TEXTAREA>', '</TEXTAREA></div>'],
    values: () => ['x&y', 'a <b> & c'],
  },
  {
    name: 'end tags other than the element own stay inert inside style',
    strings: ['<style>', '</style>'],
    values: () => ['</div>'],
  },
  {
    name: 'end tags that only start with the element name stay intact inside style',
    strings: ['<style>', '</style>'],
    values: () => ['</stylesheet></scripture>'],
  },
  {
    name: 'a comment sequence inside raw content is kept as text',
    strings: ['<div><textarea><!-- prefix -->', '</textarea></div>'],
    values: () => ['x'],
  },
  {
    name: 'tag-shaped literal text inside raw content is kept',
    strings: [
      '<div><textarea><b>x</b>',
      '</textarea><style>p::after { content: "<i>" }</style></div>',
    ],
    values: () => ['y'],
  },
  {
    name: 'a nested template inside raw content contributes its text',
    strings: ['<div><textarea>', '</textarea></div>'],
    values: (mode) => [
      mode === 'csr'
        ? html(tpl(['<b>', ' &amp; co</b>']), 'bold')
        : markSSRHtml(renderSSR(['<b>', ' &amp; co</b>'], ['bold'])),
    ],
  },
  {
    name: 'each() inside raw content contributes its rows as text',
    strings: ['<div><title>', '</title></div>'],
    values: (mode) => [
      mode === 'csr'
        ? each(
            () => ['a', 'b'],
            (item: () => string) => html(tpl(LI), item),
          )
        : eachSSR(['a', 'b'], (item) => markSSRHtml(renderSSR(LI, [item]))),
    ],
  },
  {
    name: 'when() inside raw content contributes the shown branch as text',
    strings: ['<div><textarea>', '</textarea></div>'],
    values: (mode) => [
      mode === 'csr'
        ? when(
            () => true,
            () => html(tpl(['<b>on</b>'])),
            () => 'off',
          )
        : whenSSR(
            () => true,
            () => markSSRHtml(renderSSR(['<b>on</b>'], [])),
            () => 'off',
          ),
    ],
  },
  {
    name: 'a nested raw-text element keeps tag- and comment-shaped text',
    strings: ['<div><textarea>', '</textarea></div>'],
    values: (mode) => {
      const inner = ['<style>p::after { content: "<i>" } /* <!-- x --> */</style>'];
      return [mode === 'csr' ? html(tpl(inner)) : markSSRHtml(renderSSR(inner, []))];
    },
  },
  {
    name: 'the same array in two raw-content slots renders twice',
    strings: ['<div><textarea>', '', '</textarea></div>'],
    values: () => {
      const items = ['a', 'b'];
      return [items, items];
    },
  },
  {
    name: 'an array of templates inside raw content contributes their text',
    strings: ['<div><textarea>', '</textarea></div>'],
    values: (mode) => [
      mode === 'csr'
        ? [html(tpl(['<b>x</b>'])), html(tpl(['<i>y</i>']))]
        : [markSSRHtml(renderSSR(['<b>x</b>'], [])), markSSRHtml(renderSSR(['<i>y</i>'], []))],
    ],
  },
  {
    name: 'a root raw-content element with a nested template is one text node',
    strings: ['<textarea>', '</textarea>'],
    values: (mode) => [
      mode === 'csr' ? html(tpl(['<b>bold</b>'])) : markSSRHtml(renderSSR(['<b>bold</b>'], [])),
    ],
  },
  {
    name: 'a nested raw-text element is not closed by a longer end-tag name',
    strings: ['<div><textarea>', '</textarea></div>'],
    values: (mode) => {
      const inner = ['<style>x</stylesheet>y</style>'];
      return [mode === 'csr' ? html(tpl(inner)) : markSSRHtml(renderSSR(inner, []))];
    },
  },
  {
    name: 'the same nested template in two raw-content slots renders twice',
    strings: ['<div><textarea>', '', '</textarea></div>'],
    values: (mode) => {
      const nested =
        mode === 'csr' ? html(tpl(['<b>x</b>'])) : markSSRHtml(renderSSR(['<b>x</b>'], []));
      return [nested, nested];
    },
  },
  {
    name: 'branded SSR HTML inside raw content contributes its text',
    strings: ['<div><textarea>', '</textarea></div>'],
    values: () => [markSSRHtml('<b>x</b> &amp; y')],
  },
  {
    name: 'static raw content with a comment sequence hydrates as one text node',
    strings: ['<div><style><!-- a -->b > c {}</style><p>', '</p></div>'],
    values: () => ['x'],
  },
  {
    name: 'raw-text <title> with dynamic content',
    strings: ['<title>', ' & more</title>'],
    values: () => ['Tom & <Jerry>'],
  },
];

describe('SSR / CSR / hydrate conformance', () => {
  it('escapes foreign style below annotation-xml SVG transitions', () => {
    const out = renderSSR(
      [
        '<math><annotation-xml><svg><mtext><style>',
        '</style></mtext></svg></annotation-xml></math>',
      ],
      ['<img src=x onerror=alert(1)>'],
    );
    expect(out).toContain('&lt;img');
    const host = document.createElement('div');
    host.innerHTML = out;
    expect(host.querySelector('img')).toBeNull();
  });

  it('keeps CDATA after nested same-name foreign elements', () => {
    expect(ssrHelpers.rawText([markSSRHtml('<svg><svg></svg><![CDATA[x]]></svg>')], 1)).toBe('x');
  });

  it('preserves static nested pre leading newlines', () => {
    const inner = ['<pre>\nfoo</pre>'];
    const out = renderSSR(['<textarea>', '</textarea>'], [markSSRHtml(renderSSR(inner, []))]);
    const host = document.createElement('div');
    host.innerHTML = out;
    expect(host.querySelector('textarea')?.textContent).toBe('\nfoo');
  });

  it('keeps siblings after double-escaped static script content', () => {
    const out = renderSSR(['<script><!--<script></script>--></script><p>', '</p>'], ['after']);
    const host = document.createElement('div');
    host.innerHTML = out;
    expect(host.querySelector('p')?.textContent).toBe('after');
    expect(host.querySelector('script')?.textContent).toBe('<!--<script></script>-->');
  });

  for (const c of cases) {
    // A known defect is pinned with it.fails: the assertion must keep failing.
    const check = c.knownDefect ? it.fails : it;
    check(`${c.name}: SSR matches CSR`, () => {
      const csr = renderCSR(c.strings, c.values('csr'));
      const ssr = normalize(renderSSR(c.strings, c.values('ssr')));
      expect(ssr).toBe(csr);
    });

    if (c.knownDefect) continue;
    it(`${c.name}: hydrating SSR output matches CSR`, () => {
      const csr = renderCSR(c.strings, c.values('csr'));
      const host = document.createElement('div');
      document.body.appendChild(host);
      host.innerHTML = renderSSR(c.strings, c.values('ssr'));
      // hydrate() falls back to a fresh mount when adoption throws, which would
      // hide a broken walker behind equal innerHTML. Require the SSR elements to
      // survive, i.e. adoption happened in place.
      const ssrElements = Array.from(host.querySelectorAll('*'));
      hydrate(host, () => html(tpl(c.strings), ...c.values('csr')) as Node);
      for (const el of ssrElements) expect(host.contains(el)).toBe(true);
      expect(normalize(host.innerHTML)).toBe(csr);
      host.remove();
    });
  }

  it('hydrated text binding stays live after SSR adoption', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const name = state('Ada');
    host.innerHTML = renderSSR(['<p>', '</p>'], [() => name()]);
    hydrate(host, () => html(tpl(['<p>', '</p>']), () => name()) as Node);
    expect(host.textContent).toBe('Ada');
    name('Bea');
    await tick();
    expect(host.textContent).toBe('Bea');
    host.remove();
  });

  // SSR writes no markers inside <style>, so hydrate adopts the SSR node and
  // rebuilds its text in place instead of falling back to a fresh mount.
  it('dynamic <style> SSR node is adopted by hydrate and stays live', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const css = state('a > b');
    host.innerHTML = renderSSR(['<style>', '</style>'], [() => css()]);
    const ssrStyle = host.querySelector('style');
    const mounted = hydrate(host, () => html(tpl(['<style>', '</style>']), () => css()) as Node);
    try {
      expect(ssrStyle !== null && host.contains(ssrStyle)).toBe(true);
      expect(host.querySelector('style')?.textContent).toBe('a > b');
      css('c > d');
      await tick();
      expect(host.querySelector('style')?.textContent).toBe('c > d');
    } finally {
      mounted.unmount();
      host.remove();
    }
  });

  it('a nested reactive template inside <textarea> stays live on the client and after hydration', async () => {
    const strings = ['<div><textarea>', '</textarea><p>x</p></div>'];
    const inner = ['<b>', '</b>'];
    const name = state('Ada');

    const csrHost = document.createElement('div');
    csrHost.appendChild(
      html(
        tpl(strings),
        html(tpl(inner), () => name()),
      ) as Node,
    );

    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = renderSSR(strings, [markSSRHtml(renderSSR(inner, ['Ada']))]);
    const mounted = hydrate(
      host,
      () =>
        html(
          tpl(strings),
          html(tpl(inner), () => name()),
        ) as Node,
    );
    try {
      expect(csrHost.querySelector('textarea')?.textContent).toBe('Ada');
      expect(host.querySelector('textarea')?.textContent).toBe('Ada');
      name('Bea');
      await tick();
      await tick();
      expect(csrHost.querySelector('textarea')?.textContent).toBe('Bea');
      expect(host.querySelector('textarea')?.textContent).toBe('Bea');
    } finally {
      mounted.unmount();
      host.remove();
    }
  });

  it('SSR keeps a textarea leading newline that the HTML parser would drop', () => {
    const parse = (out: string) => {
      const host = document.createElement('div');
      host.innerHTML = out;
      return host.querySelector('textarea')?.textContent;
    };
    expect(parse(renderSSR(['<div><textarea>\n', '</textarea></div>'], ['x']))).toBe('\nx');
    expect(parse(renderSSR(['<div><textarea>\nfoo</textarea><p>', '</p></div>'], ['x']))).toBe(
      '\nfoo',
    );
    expect(parse(renderSSR(['<textarea>\nfoo</textarea>'], []))).toBe('\nfoo');
  });

  it('the client cloning path keeps a textarea leading newline', () => {
    const host = document.createElement('div');
    host.appendChild(html(tpl(['<div><textarea>\nfoo</textarea><p>', '</p></div>']), 'x') as Node);
    expect(host.querySelector('textarea')?.textContent).toBe('\nfoo');
  });

  it('nested text skips template contents and declarative shadow roots', () => {
    const nested = markSSRHtml(
      '<x-card><template shadowrootmode="open"><b>shadow</b><template>t</template></template>light</x-card><template>x</template>',
    );
    expect(ssrHelpers.rawText([nested], 1)).toBe('light');
    // A tag-shaped string inside raw text in the shadow root is not a template.
    const css = markSSRHtml(
      '<x-card><template shadowrootmode="open"><style>p::after { content: "<template>" }</style></template>light</x-card>',
    );
    expect(ssrHelpers.rawText([css], 1)).toBe('light');
    // SVG <title> is foreign: its content is markup, not RCDATA.
    expect(ssrHelpers.rawText([markSSRHtml('<svg><title><b>T</b></title></svg>')], 1)).toBe('T');
    // foreignObject is an HTML integration point: its <style> is raw text again.
    const fo = markSSRHtml(
      '<svg><foreignObject><style>p{content:"<i>"}</style></foreignObject></svg>',
    );
    expect(ssrHelpers.rawText([fo], 1)).toBe('p{content:&quot;&lt;i&gt;&quot;}');
    // A foreign <template> is an ordinary element; CDATA in foreign content is text.
    const svg = markSSRHtml('<svg><template>x</template><![CDATA[a < b]]></svg>');
    expect(ssrHelpers.rawText([svg], 1)).toBe('xa &lt; b');
    // A nested same-name element does not end the outer namespace early.
    expect(ssrHelpers.rawText([markSSRHtml('<svg><svg></svg><![CDATA[x]]></svg>')], 1)).toBe('x');
    // Invalid numeric references become U+FFFD instead of throwing.
    expect(ssrHelpers.rawText([markSSRHtml('<b>&#x110000;&#0;</b>')])).toBe('��');
  });

  it('nested text drops a nested textarea leading newline like the HTML parser', () => {
    expect(ssrHelpers.rawText([markSSRHtml('<textarea>\n\nfoo</textarea>')], 1)).toBe('\nfoo');
  });

  it('nested text decodes named and numeric references like the HTML tokenizer', () => {
    const references =
      '&copy;&NotEqualTilde;&CounterClockwiseContourIntegral;&AMP;&amP;&notit;&copy= &#128 &#x80; &#0; &#xD800; &#x110000; &unknown; &amp;copy;';
    const source = `<b>${references}</b>`;
    const native = document.createElement('template');
    native.innerHTML = source;
    const expected = native.content.textContent;
    for (const tag of ['textarea', 'title']) {
      const strings = [`<${tag}>`, `</${tag}>`];
      const host = document.createElement('div');
      host.innerHTML = renderSSR(strings, [markSSRHtml(source)]);
      expect(host.querySelector(tag)?.textContent).toBe(expected);
      const adopted = host.querySelector(tag);
      const mounted = hydrate(
        host,
        () => html(tpl(strings), native.content.cloneNode(true)) as Node,
      );
      expect(host.querySelector(tag)).toBe(adopted);
      expect(adopted?.textContent).toBe(expected);
      mounted.unmount();
    }
  });

  it('every standard named reference and numeric replacement matches native text parsing', () => {
    const references =
      Object.keys(namedReferences)
        .map((name) => `&${name}`)
        .join('|') +
      '|' +
      Array.from({ length: 32 }, (_, i) => `&#${128 + i};`).join('|') +
      '|&constructor;&toString;&__proto;';
    const native = document.createElement('template');
    native.innerHTML = `<b>${references}</b>`;
    expect(ssrHelpers.rawText([markSSRHtml(`<b>${references}</b>`)])).toBe(
      native.content.textContent,
    );
  });

  it('dynamic styles preserve top-level CSS CDO semantics without tag-opening bytes', () => {
    const original = '<!-- .x { color: red } -->';
    const factory = new Function(
      `return ${generateSSR(parse(tpl(['<style>', '</style>'])))}`,
    )() as SSRFactory;
    const wrapper = factory([original], ssrHelpers);
    expect(wrapper.__purity_ssr_html__).toContain('/**/ .x { color: red } -->');
    expect(wrapper.__purity_ssr_html__).not.toContain('<!--');
    expect(ssrHelpers.rawText([wrapper], 1)).toBe('&lt;!-- .x { color: red } --&gt;');
    // Only a CDO between top-level rules is discarded. In a quoted string
    // or a selector prelude the less-than sign must retain CSS token meaning.
    expect(ssrHelpers.rawText(['.x::before{content:"<!--"}'])).toContain('"\\3c !--"');
    expect(ssrHelpers.rawText(['.x<!-- {color:red}'])).toContain('.x\\3c !--');
    expect(
      ssrHelpers.rawText(['/* <!-- */ <!-- .x{color:red} --> <!-- .y{color:blue} -->']),
    ).toContain('/**/ .y');
  });

  it('foreign paragraph end tags close an in-scope HTML paragraph', async () => {
    for (const outer of ['svg', 'math']) {
      for (const nested of ['', '<span>']) {
        const prefix = `<p>${nested}<${outer}><g></p><b>`;
        const strings = [prefix, '</b><textarea>', '</textarea>'];
        const native = document.createElement('div');
        native.innerHTML = prefix + 'tail</b><textarea>x</textarea>';
        const host = document.createElement('div');
        const tail = state('tail');
        host.innerHTML = renderSSR(strings, [tail, 'x']);
        expect(normalize(host.innerHTML)).toBe(normalize(native.innerHTML));
        expect(renderCSR(strings, [tail, 'x'])).toBe(normalize(native.innerHTML));
        const adopted = host.querySelector('b');
        const mounted = hydrate(host, () => html(tpl(strings), tail, 'x') as Node);
        expect(host.querySelector('b')).toBe(adopted);
        tail('updated');
        await tick();
        expect(adopted?.textContent).toBe('updated');
        mounted.unmount();
      }
    }
    // A button is a paragraph-scope boundary: the outer paragraph must not
    // be closed by a foreign end tag inside it.
    const strings = ['<p><button><svg></p><b>tail</b></button></p>'];
    const native = document.createElement('div');
    native.innerHTML = strings[0];
    expect(renderCSR(strings, [])).toBe(normalize(native.innerHTML));
    expect(normalize(renderSSR(strings, []))).toBe(normalize(native.innerHTML));
  });

  it('disconnects the raw-content observer when the owner is torn down', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    try {
      const host = document.createElement('div');
      const app = mount(
        () => html(tpl(['<div><textarea>', '</textarea></div>']), html(tpl(['<b>x</b>']))) as Node,
        host,
      );
      const before = disconnect.mock.calls.length;
      app.unmount();
      expect(disconnect.mock.calls.length).toBeGreaterThan(before);
    } finally {
      disconnect.mockRestore();
    }
  });

  it('a nested template inside <textarea> hydrates to its text', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const strings = ['<div><textarea>', '</textarea></div>'];
    host.innerHTML = renderSSR(strings, [markSSRHtml('plain text')]);
    const textarea = host.querySelector('textarea');
    const mounted = hydrate(host, () => html(tpl(strings), html(tpl(['plain text']))) as Node);
    try {
      expect(host.querySelector('textarea')).toBe(textarea);
      expect(textarea?.textContent).toBe('plain text');
    } finally {
      mounted.unmount();
      host.remove();
    }
  });

  it('an SVG <style> is not raw text: markup in a value stays escaped', () => {
    const out = renderSSR(['<svg><style>', '</style></svg>'], ['<script>x()</script>']);
    const host = document.createElement('div');
    host.innerHTML = out;
    expect(host.querySelectorAll('script')).toHaveLength(0);
    expect(host.querySelector('style')?.textContent).toBe('<script>x()</script>');
  });

  it('MathML mglyph stays foreign inside a text integration point', () => {
    const out = renderSSR(
      ['<math><mtext><mglyph><style>', '</style></mglyph></mtext></math>'],
      ['<img src=x>'],
    );
    expect(out).not.toContain('<img');
  });

  it('MathML integration-point names inside SVG stay SVG', () => {
    for (const name of ['mtext', 'mi']) {
      const out = renderSSR([`<svg><${name}><style>`, `</style></${name}></svg>`], ['<img src=x>']);
      expect(out).not.toContain('<img');
    }
  });

  it('an <svg> under MathML annotation-xml is SVG, so its mtext stays foreign', () => {
    const out = renderSSR(
      [
        '<math><annotation-xml><svg><mtext><style>',
        '</style></mtext></svg></annotation-xml></math>',
      ],
      ['<img src=x>'],
    );
    expect(out).not.toContain('<img');
  });

  it('a mismatched end tag inside foreign content does not end it for raw detection', () => {
    const out = renderSSR(['<svg></div><style>', '</style></svg>'], ['<img src=x>']);
    expect(out).not.toContain('<img');
  });

  it('pre keeps a leading newline through SSR and the client cloning path', () => {
    const host = document.createElement('div');
    host.innerHTML = renderSSR(['<div><pre>\nfoo</pre><p>', '</p></div>'], ['x']);
    expect(host.querySelector('pre')?.textContent).toBe('\nfoo');
    const csr = document.createElement('div');
    csr.appendChild(html(tpl(['<div><pre>\n', '</pre></div>']), 'x') as Node);
    expect(csr.querySelector('pre')?.textContent).toBe('\nx');
  });

  it('finds the end of script content where the HTML parser does', () => {
    for (const body of [
      'a</script>',
      '<!--<script></script>--></script>',
      '<!--<script>--><script></script>--></script>',
      '<!--<SCRIPT >x</script >y--></script>',
      'x</scripts></script>',
    ]) {
      const host = document.createElement('div');
      host.innerHTML = `<script>${body}<p>after</p>`;
      expect(body.slice(0, rawEnd(body, 0, 'script')), body).toBe(
        host.querySelector('script')?.textContent,
      );
    }
  });

  it('SSR writes < in dynamic <style> content as \\3c and hydration restores it', () => {
    const strings = ['<div><style>p::after { content: "', '" }</style></div>'];
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = renderSSR(strings, ['</div><b>']);
    const style = host.querySelector('style');
    expect(style?.textContent).toBe('p::after { content: "\\3c /div>\\3c b>" }');
    const mounted = hydrate(host, () => html(tpl(strings), '</div><b>') as Node);
    try {
      expect(host.querySelector('style')).toBe(style);
      expect(style?.textContent).toBe('p::after { content: "</div><b>" }');
    } finally {
      mounted.unmount();
      host.remove();
    }
  });

  it('the CSS escape keeps a backslash-escaped < meaning <', () => {
    // CSS `\<` is `<`; a run of an odd number of backslashes escapes the `<`.
    expect(ssrHelpers.rawText(['a\\<b'])).toBe('a\\3c b');
    expect(ssrHelpers.rawText(['a\\\\<b'])).toBe('a\\\\\\3c b');
  });

  it('handles long slash runs without changing CSS escape parity', () => {
    const slashes = '\\'.repeat(100_000);
    expect(ssrHelpers.rawText([slashes])).toBe(slashes);
    expect(ssrHelpers.rawText([`${slashes}<b\\<i`])).toBe(`${slashes}\\3c b\\3c i`);
  });

  it('dynamic styles preserve CSS range comparison delimiters', () => {
    for (const comparison of ['< 600px', '<600px', '<=600px']) {
      const strings = [`<style>@media (width ${comparison}) { p { color: `, ' } }</style>'];
      const host = document.createElement('div');
      host.innerHTML = renderSSR(strings, ['red']);
      expect(host.querySelector('style')?.textContent).toBe(
        `@media (width ${comparison}) { p { color: red } }`,
      );
    }
    // Comparisons can coexist with dangerous prefixes; only the latter escape.
    expect(ssrHelpers.rawText(['width < 600px; </sty', 'le><img src=x>'])).toBe(
      'width < 600px; \\3c /style>\\3c img src=x>',
    );
  });

  it('custom-element slots preserve original style text through nested outputs', () => {
    const compile = (strings: string[]) =>
      new Function(`return ${generateSSR(parse(tpl(strings)))}`)() as SSRFactory;
    const style = compile(['<style>', '</style>'])(['<i>'], ssrHelpers);
    for (const strings of [
      ['<x-unknown><style>', '</style></x-unknown>'],
      ['<x-unknown><x-inner>', '</x-inner></x-unknown>'],
    ]) {
      const values = strings[0].endsWith('<style>') ? ['<i>'] : [style];
      const value = compile(strings)(values, ssrHelpers);
      const outer = compile(['<textarea>', '</textarea>'])([value], ssrHelpers);
      const host = document.createElement('div');
      host.innerHTML = outer.__purity_ssr_html__;
      expect(host.querySelector('textarea')?.textContent).toBe('<i>');
    }
  });

  it('SSR control-flow wrappers preserve original style text and authored escapes', () => {
    const factory = new Function(
      `return ${generateSSR(parse(tpl(['<style>', '</style>'])))}`,
    )() as SSRFactory;
    const original = 'p{content:"\\3c <i>"}';
    const style = () => factory([original], ssrHelpers);
    const views = [
      whenSSR(() => true, style),
      whenSSR(
        () => false,
        () => '',
        style,
      ),
      matchSSR(() => 'a&b', { 'a&b': style }),
      matchSSR(() => 'missing', {}, style),
      eachSSR([1, 2], () => whenSSR(() => true, style)),
    ];
    for (let i = 0; i < views.length; i++) {
      const expected = 'p{content:&quot;\\3c &lt;i&gt;&quot;}';
      expect(ssrHelpers.rawText([views[i]], 1)).toBe(i === 4 ? expected + expected : expected);
    }
  });

  it('nested text reads opaque raw-text elements and undoes the style CSS escape', () => {
    const opaque = markSSRHtml(
      '<div><iframe><b>x</b></iframe><xmp><i>y</i></xmp><noembed>&amp;</noembed></div>',
    );
    expect(ssrHelpers.rawText([opaque], 1)).toBe(
      '&lt;b&gt;x&lt;/b&gt;&lt;i&gt;y&lt;/i&gt;&amp;amp;',
    );
    const factory = new Function(
      `return ${generateSSR(parse(tpl(['<style>', '</style>'])))}`,
    )() as SSRFactory;
    const style = factory(['<i>'], ssrHelpers);
    expect(ssrHelpers.rawText([style], 1)).toBe('&lt;i&gt;');
  });

  it('nested raw content preserves author-written CSS escapes', () => {
    const style = markSSRHtml('<style>p{content:"\\3c "}</style>');
    expect(ssrHelpers.rawText([style], 1)).toBe('p{content:&quot;\\3c &quot;}');
  });

  it('static template contents stay outside ancestor textContent', () => {
    const fragment = html(tpl(['<template>x</template>'])) as DocumentFragment;
    const template = fragment.firstChild as HTMLTemplateElement;
    expect(template.content.textContent).toBe('x');
    expect(fragment.textContent).toBe('');
    expect(ssrHelpers.rawText([markSSRHtml('<template>x</template>')], 1)).toBe('');
  });

  it('foreign opaque names do not suppress HTML raw-content integration points', () => {
    for (const tag of ['xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']) {
      const strings = [
        `<svg><${tag}><foreignObject><style>`,
        `</style></foreignObject></${tag}></svg>`,
      ];
      const host = document.createElement('div');
      host.innerHTML = renderSSR(strings, ['p{color:red}']);
      const style = host.querySelector('style');
      expect(style?.textContent).toBe('p{color:red}');
      const mounted = hydrate(host, () => html(tpl(strings), 'p{color:red}') as Node);
      expect(host.querySelector('style')).toBe(style);
      mounted.unmount();
    }
  });

  it('foreign breakout tokens hoist HTML siblings and keep later raw bindings aligned', () => {
    for (const outer of ['svg', 'math']) {
      for (const start of ['p', 'div', 'font color="red"']) {
        const tag = start.split(' ')[0];
        const strings = [
          `<${outer}><g><${start}><style>`,
          `</style></${tag}></g></${outer}><textarea>`,
          '</textarea>',
        ];
        const host = document.createElement('div');
        host.innerHTML = renderSSR(strings, ['p{color:red}', 'tail']);
        expect(host.querySelector('style')?.textContent).toBe('p{color:red}');
        expect(host.querySelector(tag)?.parentNode).toBe(host);
        expect(host.querySelector('textarea')?.textContent).toBe('tail');
        expect(renderCSR(strings, ['p{color:red}', 'tail'])).toBe(normalize(host.innerHTML));
        const style = host.querySelector('style');
        const mounted = hydrate(host, () => html(tpl(strings), 'p{color:red}', 'tail') as Node);
        expect(host.querySelector('style')).toBe(style);
        mounted.unmount();
      }
    }
    const value = markSSRHtml(
      '<svg><g><p><style>p{content:"<i>"}</style></p></g></svg><b>tail</b>',
    );
    expect(ssrHelpers.rawText([value], 1)).toBe('p{content:&quot;&lt;i&gt;&quot;}tail');
    // A breakout inside an integration point stops at that point, rather than
    // discarding the outer SVG. Repeated popped names must all be ignored.
    const strings = [
      '<svg><foreignObject><svg><svg><g><p><style>',
      '</style></p></g></svg></svg><textarea>',
      '</textarea></foreignObject></svg>',
    ];
    expect(renderCSR(strings, ['p{color:red}', 'tail'])).toBe(
      normalize(renderSSR(strings, ['p{color:red}', 'tail'])),
    );
    // Attribute-like words inside a quoted value do not turn font into HTML.
    const foreign = markSSRHtml(
      '<svg><font title="color=red"><style>&lt;i&gt;</style></font></svg>',
    );
    expect(ssrHelpers.rawText([foreign], 1)).toBe('&lt;i&gt;');
    for (const tag of ['p', 'br']) {
      const strings = [`<svg><g></${tag}><style>`, '</style></g></svg><textarea>', '</textarea>'];
      const host = document.createElement('div');
      host.innerHTML = renderSSR(strings, ['p{color:red}', 'tail']);
      expect(host.querySelector('style')?.textContent).toBe('p{color:red}');
      expect(renderCSR(strings, ['p{color:red}', 'tail'])).toBe(normalize(host.innerHTML));
    }
  });

  it('static SVG names match the HTML parser adjustments', () => {
    const strings = [
      '<svg><defs><lineargradient id="g"><stop></stop></lineargradient></defs><textpath>x</textpath></svg>',
    ];
    const root = html(tpl(strings)) as DocumentFragment;
    expect(root.querySelector('#g')?.localName).toBe('linearGradient');
    expect(root.querySelector('textPath')?.localName).toBe('textPath');
    expect(renderCSR(strings, [])).toBe(normalize(renderSSR(strings, [])));
  });

  it('foreign HTML-void names retain children across static, dynamic, SSR and hydration', async () => {
    for (const outer of ['svg', 'math']) {
      for (const tag of ['input', 'area', 'source', 'link', 'track', 'wbr']) {
        const staticStrings = [`<${outer}><${tag}><circle>kept</circle></${tag}></${outer}>`];
        expect(renderCSR(staticStrings, [])).toBe(normalize(renderSSR(staticStrings, [])));
        const strings = [
          `<${outer}><${tag}><circle>`,
          `</circle></${tag}><circle>tail</circle></${outer}>`,
        ];
        const value = state('kept');
        const host = document.createElement('div');
        host.innerHTML = renderSSR(strings, [value]);
        expect(host.querySelector(tag)?.textContent).toBe('kept');
        expect(renderCSR(strings, [value])).toBe(normalize(host.innerHTML));
        const circle = host.querySelector('circle');
        const mounted = hydrate(host, () => html(tpl(strings), value) as Node);
        value('updated');
        await tick();
        expect(host.querySelector('circle')).toBe(circle);
        expect(circle?.textContent).toBe('updated');
        expect(host.querySelectorAll('circle')[1]?.textContent).toBe('tail');
        mounted.unmount();
      }
    }
    const strings = ['<main><div/><p>tail</p></main>'];
    expect(renderCSR(strings, [])).toBe(normalize(renderSSR(strings, [])));
  });

  it('static foreign attributes have the HTML-parser names and namespaces', () => {
    const strings = [
      '<svg viewbox="0 0 10 10" preserveaspectratio="none" xml:lang="en" xmlns:xlink="http://www.w3.org/1999/xlink"><lineargradient gradientunits="userSpaceOnUse" xlink:href="#g"></lineargradient></svg>',
    ];
    const root = html(tpl(strings)) as DocumentFragment;
    const svg = root.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 10 10');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(svg.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang')).toBe('en');
    expect(svg.getAttributeNS('http://www.w3.org/2000/xmlns/', 'xlink')).toBe(
      'http://www.w3.org/1999/xlink',
    );
    expect(
      root.querySelector('linearGradient')?.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
    ).toBe('#g');
    expect(renderCSR(strings, [])).toBe(normalize(renderSSR(strings, [])));
  });

  it('foreign CDATA contributes only normalized character data across rendering paths', () => {
    for (const outer of ['svg', 'math', 'svg><foreignObject']) {
      const close = outer === 'svg><foreignObject' ? 'foreignObject></svg' : outer;
      const strings = [`<${outer}>before<![CDATA[<b>x</b>&\r\ny>]]>after</${close}>`];
      const fragment = html(tpl(strings)) as DocumentFragment;
      expect(fragment.textContent).toBe('before<b>x</b>&\ny>after');
      expect(renderCSR(strings, [])).toBe(normalize(renderSSR(strings, [])));
      const dynamic = [strings[0] + '<p>', '</p>'];
      expect(renderCSR(dynamic, ['tail'])).toBe(normalize(renderSSR(dynamic, ['tail'])));
      const host = document.createElement('div');
      host.innerHTML = renderSSR(dynamic, ['tail']);
      const text = host.querySelector('svg, math')?.firstChild;
      const mounted = hydrate(host, () => html(tpl(dynamic), 'tail') as Node);
      expect(host.querySelector('svg, math')?.firstChild).toBe(text);
      mounted.unmount();
    }
    expect((html(tpl(['<div><![CDATA[x]]></div>'])) as DocumentFragment).textContent).toBe('');
    const empty = ['<svg><![CDATA[]]><circle>', '</circle></svg>'];
    const host = document.createElement('div');
    host.innerHTML = renderSSR(empty, ['tail']);
    const circle = host.querySelector('circle');
    const mounted = hydrate(host, () => html(tpl(empty), 'tail') as Node);
    expect(host.querySelector('circle')).toBe(circle);
    expect(host.textContent).toBe('tail');
    mounted.unmount();
    expect(() => parse(tpl(['<svg><![CDATA[', ']]></svg>']))).toThrow('interpolated CDATA');
  });

  it('foreign reactive attributes retain namespace identity through updates and removal', async () => {
    const strings = [
      '<svg viewbox="0 0 10 10" VIEWBOX="0 0 99 99"><lineargradient gradientunits=',
      ' xlink:href=',
      '></lineargradient></svg>',
    ];
    const units = state('userSpaceOnUse');
    const href = state<string | null>('#g');
    const host = document.createElement('div');
    host.innerHTML = renderSSR(strings, [units, href]);
    const mounted = hydrate(host, () => html(tpl(strings), units, href) as Node);
    const gradient = host.querySelector('linearGradient')!;
    expect(host.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 10 10');
    expect(gradient.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
    expect(gradient.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#g');
    units('objectBoundingBox');
    href('#next');
    await tick();
    expect(gradient.getAttribute('gradientUnits')).toBe('objectBoundingBox');
    expect(gradient.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#next');
    href(null);
    await tick();
    expect(gradient.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(false);
    mounted.unmount();
    expect(() => html(tpl(strings), 'userSpaceOnUse', 'javascript:attack()')).toThrow(
      'Unsafe URL binding',
    );
    const math = ['<math definitionurl="https://example.com/definition"><mi>x</mi></math>'];
    expect(
      (html(tpl(math)) as DocumentFragment).firstElementChild?.getAttribute('definitionURL'),
    ).toBe('https://example.com/definition');
    expect(renderCSR(math, [])).toBe(normalize(renderSSR(math, [])));
  });

  it('static foreign templates retain children in their own namespace', () => {
    for (const [tag, ns] of [
      ['svg', 'http://www.w3.org/2000/svg'],
      ['math', 'http://www.w3.org/1998/Math/MathML'],
    ]) {
      const strings = [`<${tag}><template>x</template></${tag}>`];
      const fragment = html(tpl(strings)) as DocumentFragment;
      const root = fragment.firstChild as Element;
      const template = root.firstChild as Element;
      expect(root.namespaceURI).toBe(ns);
      expect(template.namespaceURI).toBe(ns);
      expect(template.textContent).toBe('x');
      expect(root.textContent).toBe('x');
      expect(renderCSR(strings, [])).toBe(normalize(renderSSR(strings, [])));
    }
    for (const strings of [
      ['<svg><foreignObject><template>x</template></foreignObject></svg>'],
      ['<math><mtext><template>x</template></mtext></math>'],
      ['<math><annotation-xml encoding="text/html"><template>x</template></annotation-xml></math>'],
    ]) {
      const fragment = html(tpl(strings)) as DocumentFragment;
      const template = fragment.querySelector('template') as HTMLTemplateElement;
      expect(template.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
      expect(template.content.textContent).toBe('x');
      expect(fragment.textContent).toBe('');
    }
  });

  it('extracts original text from a large ordered list of generated styles', () => {
    const factory = new Function(
      `return ${generateSSR(parse(tpl(['<style>', '</style>'])))}`,
    )() as SSRFactory;
    const values = Array.from({ length: 2_000 }, (_, i) => `<i>${i}</i>`);
    const list = eachSSR(values, (item) => factory([item()], ssrHelpers));
    expect(ssrHelpers.rawText([list], 1)).toBe(
      values.map((value) => value.replaceAll('<', '&lt;').replaceAll('>', '&gt;')).join(''),
    );
  });

  it('RCDATA carriage returns survive HTML input preprocessing', () => {
    for (const tag of ['textarea', 'title']) {
      const host = document.createElement('div');
      host.innerHTML = renderSSR([`<${tag}>`, `</${tag}>`], ['a\rb\r\nc']);
      expect(host.querySelector(tag)?.textContent).toBe('a\rb\r\nc');
    }
  });

  it('static RCDATA retains carriage returns when another binding selects the complex path', () => {
    for (const tag of ['textarea', 'title']) {
      const strings = [`<div><${tag}>a\rb\r\nc</${tag}><p>`, '</p></div>'];
      const client = document.createElement('div');
      client.appendChild(html(tpl(strings), 'x') as Node);
      const host = document.createElement('div');
      host.innerHTML = renderSSR(strings, ['x']);
      expect(client.querySelector(tag)?.textContent).toBe('a\rb\r\nc');
      expect(host.querySelector(tag)?.textContent).toBe('a\rb\r\nc');
      const mounted = hydrate(host, () => html(tpl(strings), 'x') as Node);
      try {
        expect(host.querySelector(tag)?.textContent).toBe('a\rb\r\nc');
      } finally {
        mounted.unmount();
      }
    }
  });

  it('MathML glyph exceptions apply only to MathML text integration points', () => {
    for (const glyph of ['mglyph', 'malignmark']) {
      for (const parent of ['annotation-xml encoding="text/html"', 'mtext']) {
        const close = parent.split(' ')[0];
        const strings = [
          `<math><${parent}><${glyph}><style>`,
          `</style></${glyph}></${close}></math>`,
        ];
        const host = document.createElement('div');
        host.innerHTML = renderSSR(strings, ['p{color:red}']);
        const ns =
          parent === 'mtext'
            ? 'http://www.w3.org/1998/Math/MathML'
            : 'http://www.w3.org/1999/xhtml';
        expect(host.querySelector(glyph)?.namespaceURI).toBe(ns);
        const mounted = hydrate(host, () => html(tpl(strings), 'p{color:red}') as Node);
        try {
          expect(host.querySelector('style')?.textContent).toBe('p{color:red}');
        } finally {
          mounted.unmount();
        }
        const factory = new Function(`return ${generateSSR(parse(tpl(strings)))}`)() as SSRFactory;
        const nested = factory(['p{content:"<i>"}'], ssrHelpers);
        expect(ssrHelpers.rawText([nested], 1)).toBe('p{content:&quot;&lt;i&gt;&quot;}');
      }
    }
  });

  it('nested plaintext consumes all remaining source text', () => {
    const value = markSSRHtml('<div><plaintext><b>x</b></plaintext></div>');
    expect(ssrHelpers.rawText([value], 1)).toBe(
      '&lt;b&gt;x&lt;/b&gt;&lt;/plaintext&gt;&lt;/div&gt;',
    );
  });

  it('tracks only generated CSS escapes across nested SSR expression slots', () => {
    const compile = (strings: string[]) =>
      new Function(`return ${generateSSR(parse(tpl(strings)))}`)() as SSRFactory;
    const original = 'p{content:"\\3c <i>"}';
    const style = compile(['<style>', '</style>'])([original], ssrHelpers);
    const outer = compile(['<div>', '</div>'])([[style, style]], ssrHelpers);
    expect(ssrHelpers.rawText([outer], 1)).toBe(
      'p{content:&quot;\\3c &lt;i&gt;&quot;}p{content:&quot;\\3c &lt;i&gt;&quot;}',
    );
    // Serializing to a string and branding it anew has no original-text metadata.
    const rewrapped = markSSRHtml(style.__purity_ssr_html__);
    expect(ssrHelpers.rawText([rewrapped], 1)).toBe('p{content:&quot;\\3c \\3c i&gt;&quot;}');
  });

  it('a <style> value cannot break out of a raw-text ancestor', () => {
    for (const tag of ['xmp', 'iframe', 'noembed', 'noframes', 'noscript']) {
      const out = renderSSR([`<${tag}><style>`, `</style></${tag}>`], [`</${tag}><img src=x>`]);
      const host = document.createElement('div');
      host.innerHTML = out;
      expect(host.querySelectorAll('img'), tag).toHaveLength(0);
    }
  });

  it('a child template <style> spliced into SVG or MathML stays inert', () => {
    for (const parent of ['svg', 'math']) {
      const child = markSSRHtml(renderSSR(['<style>', '</style>'], ['<img src=x>']));
      const out = renderSSR([`<${parent}>`, `</${parent}>`], [child]);
      const host = document.createElement('div');
      host.innerHTML = out;
      expect(host.querySelectorAll('img'), parent).toHaveLength(0);
    }
  });

  it('a later duplicate encoding cannot grant raw-text privileges to a dynamic MathML attribute', () => {
    const out = renderSSR(
      [
        '<math><annotation-xml encoding=',
        ' encoding="text/html"><style>',
        '</style></annotation-xml></math>',
      ],
      ['application/xml', '<img src=x>'],
    );
    const host = document.createElement('div');
    host.innerHTML = out;
    expect(host.querySelectorAll('img')).toHaveLength(0);
  });

  it('an SVG <title> keeps markup children', () => {
    const host = document.createElement('div');
    host.appendChild(html(tpl(['<svg><title><b>Bold</b>', '</title></svg>']), 'x') as Node);
    expect(host.querySelector('title b')?.textContent).toBe('Bold');
  });

  it('an end tag split across adjacent values cannot close <style>', () => {
    const out = renderSSR(['<style>', '', '</style>'], ['</sty', 'le><script>x()</script>']);
    const host = document.createElement('div');
    host.innerHTML = out;
    expect(host.querySelectorAll('script')).toHaveLength(0);
    expect(host.querySelectorAll('style')).toHaveLength(1);
  });

  it('a mixed-case </STYLE> inside a dynamic style value cannot close it', () => {
    const out = renderSSR(['<STYLE>', '</STYLE>'], ['</StYlE><b>x']);
    const host = document.createElement('div');
    host.innerHTML = out;
    expect(host.querySelectorAll('b')).toHaveLength(0);
    expect(host.querySelectorAll('style')).toHaveLength(1);
  });

  it('nested dynamic <style> stays live on the client complex path', async () => {
    const color = state('red');
    const host = document.createElement('div');
    host.appendChild(
      html(tpl(['<div><style>a > b { color: ', ' }</style><p>x</p></div>']), () => color()) as Node,
    );
    const style = host.querySelector('style');
    expect(style?.textContent).toBe('a > b { color: red }');
    color('blue');
    await tick();
    expect(host.querySelector('style')).toBe(style);
    expect(style?.textContent).toBe('a > b { color: blue }');
  });

  it('fully static <style> content is not entity-escaped (static SSR path)', () => {
    expect(normalize(renderSSR(['<style>a > b { }</style>'], []))).toBe(
      normalize('<style>a > b { }</style>'),
    );
    expect(renderSSR(['<style>a > b { }</style>'], [])).toBe('<style>a > b { }</style>');
  });

  it('a value containing </style> cannot close a raw-text element in SSR output', () => {
    const out = renderSSR(['<style>', '</style>'], ['</style><script>x()</script>']);
    expect(out.match(/<\/style>/gi)).toHaveLength(1);
    const host = document.createElement('div');
    host.innerHTML = out;
    expect(host.querySelectorAll('script')).toHaveLength(0);
    expect(host.querySelectorAll('style')).toHaveLength(1);
  });
});

describe('public generate() output', () => {
  // Public generate()/generateHydrate() return source that evaluates on its own.
  // The AOT path imports the helpers instead of inlining them.
  it('evaluates standalone and renders dynamic text and array bindings', () => {
    const ast = parse(tpl(['<p>', '|', '</p>']));
    const factory = new Function(`return ${generate(ast)}`)() as (
      values: unknown[],
      watch: (fn: () => void) => void,
    ) => Node;
    const root = factory(['x', ['a', 'b']], (fn) => fn());
    const host = document.createElement('div');
    host.appendChild(root);
    expect(host.innerHTML).toBe('<p>x|ab</p>');
  });

  it('AOT module output imports the coercion helpers rather than inlining them', () => {
    const out = generateModule(parse(tpl(['<p>', '</p>'])));
    expect(out).toContain('flattenValue as __purity_fl__');
    expect(out).not.toContain('var __purity_fl__=');
    expect(out).not.toContain('var __purity_tx__=');
  });
});
