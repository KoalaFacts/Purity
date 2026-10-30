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

  it('rejects unsafe URL bindings in SSR using the existing helper contract', () => {
    const render = compile(generateSSR(parse(['<a href=', '>link</a>'])));
    expect(render(['/safe'], ssrHelpers)).toContain('href="/safe"');
    expect(() => render(['javascript:alert(1)'], ssrHelpers)).toThrow('Unsafe URL binding');
  });
});
