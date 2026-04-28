import { describe, expect, it } from 'vitest';
import { state } from '../src/signals.ts';
import { css } from '../src/styles.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('css', () => {
  it('returns a unique scope class', () => {
    const scope1 = css`.title { color: red; }`;
    const scope2 = css`.title { color: blue; }`;

    expect(scope1).toMatch(/^p-\d+$/);
    expect(scope2).toMatch(/^p-\d+$/);
    expect(scope1).not.toBe(scope2);
  });

  it('injects a <style> element into head', () => {
    const scope = css`.box { padding: 1rem; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl).not.toBeNull();
    expect(styleEl.textContent).toContain(`.${scope} .box`);
  });

  it('scopes selectors with the scope class', () => {
    const scope = css`
      h1 { font-size: 2rem; }
      .card { border: 1px solid; }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl.textContent).toContain(`.${scope} h1`);
    expect(styleEl.textContent).toContain(`.${scope} .card`);
  });

  it('handles :host as the scope element itself', () => {
    const scope = css`:host { display: block; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl.textContent).toContain(`.${scope} `);
    expect(styleEl.textContent).not.toContain(':host');
  });

  it('handles multiple selectors', () => {
    const scope = css`h1, h2 { margin: 0; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl.textContent).toContain(`.${scope} h1`);
    expect(styleEl.textContent).toContain(`.${scope} h2`);
  });

  it('supports static interpolated values', () => {
    const color = 'tomato';
    const scope = css`.box { color: ${color}; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl.textContent).toContain('tomato');
  });

  it('supports reactive interpolated values', async () => {
    const color = state('red');
    const scope = css`.box { color: ${() => color()}; }`;

    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl.textContent).toContain('red');

    color('blue');
    await tick();
    expect(styleEl.textContent).toContain('blue');
  });

  it('keeps multiple selectors scoped across reactive updates', async () => {
    const m = state('0');
    const scope = css`h1, h2 { margin: ${() => m()}; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);

    expect(styleEl.textContent).toContain(`.${scope} h1`);
    expect(styleEl.textContent).toContain(`.${scope} h2`);

    m('1rem');
    await tick();
    expect(styleEl.textContent).toContain('1rem');
    expect(styleEl.textContent).toContain(`.${scope} h1`);
    expect(styleEl.textContent).toContain(`.${scope} h2`);
  });

  it('handles multiple reactive values in one rule', async () => {
    const fg = state('black');
    const bg = state('white');
    const scope = css`.x { color: ${() => fg()}; background: ${() => bg()}; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);

    expect(styleEl.textContent).toContain('color: black');
    expect(styleEl.textContent).toContain('background: white');

    fg('red');
    bg('blue');
    await tick();
    expect(styleEl.textContent).toContain('color: red');
    expect(styleEl.textContent).toContain('background: blue');
  });

  it('falls back to per-update scoping when a value is in selector position', async () => {
    const sel = state('.a');
    const scope = css`${() => sel()} { color: red; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl.textContent).toContain(`.${scope} .a`);

    sel('.b');
    await tick();
    expect(styleEl.textContent).toContain(`.${scope} .b`);
  });
});
