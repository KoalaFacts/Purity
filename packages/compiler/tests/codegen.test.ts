// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vite-plus/test';
import { generate, generateSSR, parse } from '../src/index.ts';

const immediate = (fn: () => void) => fn();
const compile = (source: string) => new Function(`return ${source}`)();

const ssrHelpers = {
  toAttr: (value: unknown) => (value == null || value === false ? null : String(value)),
  mark: (value: string) => value,
};

describe('extracted compiler', () => {
  it('lazily parses a dynamic single-root template and clones its root for each render', () => {
    const create = vi.spyOn(document, 'createElement');
    const render = compile(generate(parse(['<div class=', '><span>', '</span></div>'])));
    expect(create).not.toHaveBeenCalled();
    const first = render(['first', 'one'], immediate);
    const second = render(['second', 'two'], immediate);
    expect(first.outerHTML).toBe('<div class="first"><span>one</span></div>');
    expect(second.outerHTML).toBe('<div class="second"><span>two</span></div>');
    expect(first).not.toBe(second);
    expect(create.mock.calls.filter(([name]) => name === 'template')).toHaveLength(1);
    create.mockRestore();
  });

  it('preserves adjacent dynamic text and multi-root fragments', () => {
    const render = compile(generate(parse(['<p>A', 'B', '</p><p>', '</p>'])));
    const result = render(['1', '2', '3'], immediate);
    const wrapper = document.createElement('div');
    wrapper.append(result);
    expect(wrapper.innerHTML).toBe('<p>A1B2</p><p>3</p>');
  });

  it('uses the current value-array entry for shared group bindings', () => {
    const render = compile(
      generate(
        parse([
          '<div><input type="checkbox" value="a" ::group=',
          '><input type="radio" value="b" ::group=',
          '></div>',
        ]),
      ),
    );
    const old = vi.fn(() => []);
    const replacement = vi.fn(() => []);
    const radio = vi.fn(() => '');
    const values = [old, radio];
    const element = render(values, immediate) as HTMLElement;
    const [checkbox, radioButton] = element.querySelectorAll('input');
    values[0] = replacement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(replacement).toHaveBeenCalledWith(['a']);
    expect(old).toHaveBeenCalledTimes(1);
    radioButton.checked = true;
    radioButton.dispatchEvent(new Event('change'));
    expect(radio).toHaveBeenCalledWith('b');
  });

  it('rejects unsafe dynamic URLs while coercing the value only once', () => {
    const render = compile(generate(parse(['<a href=', '><span>link</span></a>'])));
    const value = {
      toString: vi.fn().mockReturnValueOnce('/safe').mockReturnValue('javascript:attack()'),
    };
    const result = render([value], immediate);
    expect(result.getAttribute('href')).toBe('/safe');
    expect(value.toString).toHaveBeenCalledOnce();
    expect(() => render(['java\nscript:attack()'], immediate)).toThrow('Unsafe URL binding');
  });

  it('constructs static templates without assigning innerHTML', () => {
    const setter = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    const render = compile(generate(parse(['<div><span>static</span></div>'])));
    const result = render();
    expect(result.firstChild.outerHTML).toBe('<div><span>static</span></div>');
    expect(setter).not.toHaveBeenCalled();
    setter.mockRestore();
  });

  it('appends static leaves without disposable aliases and still creates independent DOM trees', () => {
    const source = generate(
      parse(['<div>one<!--note--><i></i><svg><circle></circle></svg><span>two</span></div>']),
    );
    expect(source).not.toContain('=document.createTextNode(');
    expect(source).not.toContain('=document.createComment(');
    expect(source).not.toMatch(/var _n\d+=document\.createElement\(['"]i['"]\)/);
    expect(source).not.toMatch(/var _n\d+=document\.createElementNS\([^;]+['"]circle['"]\)/);
    const render = compile(source);
    const first = render();
    const second = render();
    const expected =
      '<div>one<!--note--><i></i><svg><circle></circle></svg><span>two</span></div>';
    expect(first.firstChild.outerHTML).toBe(expected);
    expect(second.firstChild.outerHTML).toBe(expected);
    expect(first.firstChild).not.toBe(second.firstChild);
    expect(first.firstChild.querySelector('circle')).not.toBe(
      second.firstChild.querySelector('circle'),
    );
  });

  it('rejects unsafe URL bindings in SSR using the existing helper contract', () => {
    const render = compile(generateSSR(parse(['<a href=', '>link</a>'])));
    expect(render(['/safe'], ssrHelpers)).toContain('href="/safe"');
    expect(() => render(['javascript:alert(1)'], ssrHelpers)).toThrow('Unsafe URL binding');
  });
});

// HTML parsing rules move or drop character data in table contexts: text in
// <table>, <tbody>, <thead>, <tfoot>, <tr> is foster-parented out of the
// table, and non-whitespace text in <colgroup> closes the colgroup and is
// then foster-parented too. A U+200B text placeholder there ends up outside
// the element, so slot paths miss. Comments stay where they are written.
describe('expression slots in table contexts', () => {
  const ZWSP = '​';
  const nodes = (...tags: string[]) => tags.map((tag) => document.createElement(tag));
  const serialize = (result: Node) => {
    const wrapper = document.createElement('div');
    wrapper.append(result);
    return wrapper.innerHTML;
  };

  const cases: Array<{ name: string; strings: string[]; rows: string[]; expected: string }> = [
    {
      name: 'tbody',
      strings: ['<table><tbody>', '</tbody></table>'],
      rows: ['tr', 'tr'],
      expected: '<table><tbody><tr></tr><tr></tr></tbody></table>',
    },
    {
      name: 'thead',
      strings: ['<table><thead>', '</thead></table>'],
      rows: ['tr'],
      expected: '<table><thead><tr></tr></thead></table>',
    },
    {
      name: 'tfoot',
      strings: ['<table><tfoot>', '</tfoot></table>'],
      rows: ['tr'],
      expected: '<table><tfoot><tr></tr></tfoot></table>',
    },
    {
      name: 'tr',
      strings: ['<table><tbody><tr>', '</tr></tbody></table>'],
      rows: ['td', 'td'],
      expected: '<table><tbody><tr><td></td><td></td></tr></tbody></table>',
    },
    {
      name: 'table',
      strings: ['<table>', '</table>'],
      rows: ['tbody'],
      expected: '<table><tbody></tbody></table>',
    },
    {
      name: 'colgroup',
      strings: ['<table><colgroup>', '</colgroup></table>'],
      rows: ['col', 'col'],
      expected: '<table><colgroup><col><col></colgroup></table>',
    },
  ];

  for (const { name, strings, rows, expected } of cases) {
    it(`uses a comment placeholder for a lone expression inside <${name}>`, () => {
      const source = generate(parse(strings));
      expect(source).not.toContain(ZWSP);
      const render = compile(source);
      expect(serialize(render([nodes(...rows)], immediate))).toBe(expected);
      // Second clone reuses the prepared template.
      expect(serialize(render([nodes(...rows)], immediate))).toBe(expected);
    });

    it(`keeps a lone expression inside <${name}> in place within a fragment`, () => {
      const render = compile(generate(parse([`<p>a</p>${strings[0]}`, ...strings.slice(1)])));
      expect(serialize(render([nodes(...rows)], immediate))).toBe(`<p>a</p>${expected}`);
    });
  }

  it('binds reactive text placed in a table row slot', () => {
    const render = compile(
      generate(parse(['<table><tbody><tr><td>', '</td>', '</tr></tbody></table>'])),
    );
    const cell = document.createElement('td');
    cell.textContent = 'x';
    const result = render([() => 'name', [cell]], immediate) as HTMLElement;
    expect(serialize(result)).toBe(
      '<table><tbody><tr><td>name</td><td>x</td></tr></tbody></table>',
    );
  });

  it('keeps the text placeholder outside table contexts', () => {
    expect(generate(parse(['<div><span>', '</span></div>']))).toContain(ZWSP);
    expect(generate(parse(['<table><tbody><tr><td>', '</td></tr></tbody></table>']))).toContain(
      ZWSP,
    );
    expect(generate(parse(['<div><select>', '</select></div>']))).toContain(ZWSP);
  });

  it('keeps <select> option slots working with the text placeholder', () => {
    const render = compile(generate(parse(['<div><select>', '</select></div>'])));
    expect(serialize(render([nodes('option', 'option')], immediate))).toBe(
      '<div><select><option></option><option></option></select></div>',
    );
  });
});
