// Cross-path conformance: the same template + values must produce the same
// visible DOM whether rendered by the client (CSR `html```), rendered to a
// string by the SSR codegen, or SSR output adopted by `hydrate()`.
//
// Comparison is done on parsed DOM, not raw strings, so entity-encoding
// differences that the browser normalises away (`&quot;` vs `"`) don't count
// as drift. Hydration comment markers and each() bookkeeping comments are
// stripped; everything else (elements, attributes, text, raw-text content)
// must match exactly.

import { describe, expect, it } from 'vite-plus/test';
import { generateSSR } from '../src/compiler/codegen.ts';
import { parse } from '../src/compiler/parser.ts';
import { markSSRHtml, ssrHelpers } from '../src/compiler/ssr-runtime.ts';
import { eachSSR } from '../src/control.ts';
import { each, html, hydrate, state } from '../src/index.ts';
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
   * Set when the drift is a known, unfixed defect (see RAW_TEXT_DEFERRED). The
   * case is asserted with it.fails so the suite stays green while the defect
   * exists, and turns red (prompting removal of this flag) once it is fixed.
   */
  knownDefect?: string;
}

const LI = ['<li>', '</li>'];

// Raw-text elements (style, script, textarea, title): SSR still emits hydration
// markers and entity-escapes their content, and the complex CSR path does not
// rebuild them. Deferred until the codegen paths are unified; tracked in a
// follow-up issue ("raw-text elements: SSR markers/escaping inside
// style/script/textarea/title"). Pinned with it.fails so the defect stays visible.
const RAW_TEXT_DEFERRED =
  'raw-text elements: SSR markers/escaping in style/script/textarea/title (follow-up issue)';

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
    knownDefect: RAW_TEXT_DEFERRED,
  },
  {
    name: 'raw-text <textarea> keeps angle brackets as text',
    strings: ['<textarea>', '</textarea>'],
    values: () => ['a <b> & c'],
    knownDefect: RAW_TEXT_DEFERRED,
  },
  {
    name: 'raw-text element nested in a wrapper (complex template)',
    strings: ['<div><style>a > b { color: ', ' }</style></div>'],
    values: () => ['red'],
    knownDefect: RAW_TEXT_DEFERRED,
  },
  {
    name: 'raw-text element beside other roots',
    strings: ['<style>a > b { color: ', ' }</style><p>', '</p>'],
    values: () => ['red', 'x&y'],
    knownDefect: RAW_TEXT_DEFERRED,
  },
  {
    name: 'upper-case raw-text tags match case-insensitively',
    strings: ['<STYLE>a > b { content: "', '" }</STYLE><div><TEXTAREA>', '</TEXTAREA></div>'],
    values: () => ['x&y', 'a <b> & c'],
    knownDefect: RAW_TEXT_DEFERRED,
  },
  {
    name: 'end tags other than the element own stay inert inside style',
    strings: ['<style>', '</style>'],
    values: () => ['</div>'],
    knownDefect: RAW_TEXT_DEFERRED,
  },
  {
    name: 'raw-text <title> with dynamic content',
    strings: ['<title>', ' & more</title>'],
    values: () => ['Tom & <Jerry>'],
    knownDefect: RAW_TEXT_DEFERRED,
  },
];

describe('SSR / CSR / hydrate conformance', () => {
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

  it('dynamic <style> content stays live after hydrate adoption', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const css = state('a > b');
    host.innerHTML = renderSSR(['<style>', '</style>'], [() => css()]);
    hydrate(host, () => html(tpl(['<style>', '</style>']), () => css()) as Node);
    expect(host.querySelector('style')?.textContent).toBe('a > b');
    css('c > d');
    await tick();
    expect(host.querySelector('style')?.textContent).toBe('c > d');
    host.remove();
  });

  it('a mixed-case </STYLE> inside a dynamic style value cannot close it', () => {
    const out = renderSSR(['<STYLE>', '</STYLE>'], ['</StYlE><b>x']);
    const host = document.createElement('div');
    host.innerHTML = out;
    expect(host.querySelectorAll('b')).toHaveLength(0);
    expect(host.querySelectorAll('style')).toHaveLength(1);
  });

  // Deferred: see RAW_TEXT_DEFERRED. Static <style> text is entity-escaped by SSR.
  it.fails('fully static <style> content is not entity-escaped (static SSR path)', () => {
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
