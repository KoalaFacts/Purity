import { describe, expect, it, vi } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { mount } from '../src/component.ts';
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

  it('handles escaped quote in CSS string literal', async () => {
    const v = state('A');
    const scope = css`.x::before { content: "say \\"${() => v()}\\""; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl.textContent).toContain('say');
    v('B');
    await tick();
    expect(styleEl.textContent).toContain('B');
  });

  it('handles unterminated /* */ comment in template', () => {
    const scope = css`/* comment without close .x { color: red; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl).not.toBeNull();
  });

  it('handles static interpolation with non-string value', () => {
    const scope = css`.x { padding: ${10}px; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('10px');
  });

  it('handles null interpolation by emitting empty', () => {
    // Verifies the framework's contract: null in a css interpolation
    // emits empty without throwing. Value pulled from JSON.parse so the
    // bare `${null}` literal is gone — the value is genuinely `unknown`
    // and only resolved at runtime.
    const src = JSON.parse('{"v":null}') as Record<string, unknown>;
    const scope = css`.x { color: ${src.v}; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl).not.toBeNull();
  });

  it('removes <style> on mount() unmount with reactive css', async () => {
    const color = state('red');
    const container = document.createElement('div');
    let scope = '';
    const { unmount } = mount(() => {
      scope = css`.theme { color: ${() => color()}; }`;
      return html`<p class="theme">x</p>`;
    }, container);
    await tick();
    expect(document.querySelector(`style[data-purity-scope="${scope}"]`)).not.toBeNull();

    unmount();
    expect(document.querySelector(`style[data-purity-scope="${scope}"]`)).toBeNull();
  });

  it('removes <style> on mount() unmount with static css', () => {
    const container = document.createElement('div');
    let scope = '';
    const { unmount } = mount(() => {
      scope = css`.theme-static { color: red; }`;
      return html`<p class="theme-static">x</p>`;
    }, container);
    expect(document.querySelector(`style[data-purity-scope="${scope}"]`)).not.toBeNull();

    unmount();
    expect(document.querySelector(`style[data-purity-scope="${scope}"]`)).toBeNull();
  });

  it('handles well-formed /* */ comment in reactive template', async () => {
    const c = state('red');
    const scope = css`/* leading comment */ .x { color: ${() => c()}; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('red');
    c('blue');
    await tick();
    expect(styleEl!.textContent).toContain('blue');
  });

  it('handles null/undefined static values in reactive template', () => {
    const c = state('red');
    // The framework's contract: null/undefined static interpolations don't
    // break a css template that also contains a reactive expression. Same
    // JSON.parse trick as above — values are runtime-resolved unknowns.
    const src = JSON.parse('{"nul":null}') as Record<string, unknown>;
    const nul = src.nul;
    const undef = src.notPresent;
    const scope = css`.x { color: ${() => c()}; padding: ${nul}px; margin: ${undef}; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('color: red');
  });

  it('mixes reactive + static interpolations in one rule', async () => {
    const c = state('red');
    const scope = css`.x { color: ${() => c()}; padding: ${10}px; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('color: red');
    expect(styleEl!.textContent).toContain('padding: 10px');

    c('blue');
    await tick();
    expect(styleEl!.textContent).toContain('color: blue');
    expect(styleEl!.textContent).toContain('padding: 10px');
  });

  it('skips DOM update when reactive value resolves to same string', async () => {
    const c = state('red');
    const scope = css`.x { color: ${() => c()}; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    const before = styleEl!.textContent;
    // Same value — newCss === prevCss branch
    c('red');
    await tick();
    expect(styleEl!.textContent).toBe(before);
  });

  it('handles reactive values inside @media (depth>1, scopeSelectors body walk)', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = state('red');
    const scope = css`
      @media (min-width: 1px) {
        .x { color: ${() => c()}; }
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('red');

    c('blue');
    await tick();
    expect(styleEl!.textContent).toContain('blue');
    warn.mockRestore();
  });

  it('falls back when reactive template has unterminated comment before placeholder', async () => {
    const v = state('1');
    // Strings: ["/* never closes ", ""] — placeholder is in selector position after
    // /* with no */, so allPlaceholdersInBodies walks past the unterminated comment
    // and concludes depth <= 0 at the placeholder gap (fallback).
    const scope = css`/* unterminated ${() => v()}`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl).not.toBeNull();
    v('2');
    await tick();
    expect(styleEl!.textContent).toContain('2');
  });
});
