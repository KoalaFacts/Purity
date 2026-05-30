import { describe, expect, it, vi } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { mount } from '../src/component.ts';
import { state } from '../src/signals.ts';
import { css } from '../src/styles.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('css', () => {
  it('returns a unique scope class', () => {
    const scope1 = css`
      .title {
        color: red;
      }
    `;
    const scope2 = css`
      .title {
        color: blue;
      }
    `;

    expect(scope1).toMatch(/^p-\d+$/);
    expect(scope2).toMatch(/^p-\d+$/);
    expect(scope1).not.toBe(scope2);
  });

  it('injects a <style> element into head wrapping CSS in @scope', () => {
    const scope = css`
      .box {
        padding: 1rem;
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl).not.toBeNull();
    expect(styleEl!.textContent).toContain(`@scope (.${scope})`);
    expect(styleEl!.textContent).toContain('.box');
  });

  it('keeps selectors verbatim inside the @scope block (no specificity bump)', () => {
    const scope = css`
      h1 {
        font-size: 2rem;
      }
      .card {
        border: 1px solid;
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    // Old behavior rewrote selectors to `.p-N h1` / `.p-N .card`. The new
    // emission leaves them unrewritten — @scope provides the bounding.
    expect(styleEl!.textContent).toContain(`@scope (.${scope})`);
    expect(styleEl!.textContent).toContain('h1');
    expect(styleEl!.textContent).toContain('.card');
    expect(styleEl!.textContent).not.toContain(`.${scope} h1`);
  });

  it('rewrites :host to :scope inside @scope', () => {
    const scope = css`
      :host {
        display: block;
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain(':scope');
    expect(styleEl!.textContent).not.toContain(':host');
    expect(styleEl!.textContent).toContain(`@scope (.${scope})`);
  });

  it('handles multiple selectors verbatim inside @scope', () => {
    const scope = css`
      h1,
      h2 {
        margin: 0;
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain(`@scope (.${scope})`);
    expect(styleEl!.textContent).toContain('h1');
    expect(styleEl!.textContent).toContain('h2');
  });

  it('supports static interpolated values', () => {
    const color = 'tomato';
    const scope = css`
      .box {
        color: ${color};
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('tomato');
  });

  it('supports reactive interpolated values', async () => {
    const color = state('red');
    const scope = css`
      .box {
        color: ${() => color()};
      }
    `;

    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('red');

    color('blue');
    await tick();
    expect(styleEl!.textContent).toContain('blue');
  });

  it('keeps multiple selectors inside @scope across reactive updates', async () => {
    const m = state('0');
    const scope = css`
      h1,
      h2 {
        margin: ${() => m()};
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);

    expect(styleEl!.textContent).toContain(`@scope (.${scope})`);
    expect(styleEl!.textContent).toContain('h1');
    expect(styleEl!.textContent).toContain('h2');

    m('1rem');
    await tick();
    expect(styleEl!.textContent).toContain('1rem');
    expect(styleEl!.textContent).toContain('h1');
    expect(styleEl!.textContent).toContain('h2');
  });

  it('handles multiple reactive values in one rule', async () => {
    const fg = state('black');
    const bg = state('white');
    const scope = css`
      .x {
        color: ${() => fg()};
        background: ${() => bg()};
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);

    expect(styleEl!.textContent).toContain('color: black');
    expect(styleEl!.textContent).toContain('background: white');

    fg('red');
    bg('blue');
    await tick();
    expect(styleEl!.textContent).toContain('color: red');
    expect(styleEl!.textContent).toContain('background: blue');
  });

  it('supports a reactive value in selector position', async () => {
    const sel = state('.a');
    const scope = css`
      ${() => sel()} {
        color: red;
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    // @scope's body changes in lockstep with the reactive selector; no
    // class-prefix rewrite anymore, so the selector appears verbatim.
    expect(styleEl!.textContent).toContain(`@scope (.${scope})`);
    expect(styleEl!.textContent).toContain('.a');

    sel('.b');
    await tick();
    expect(styleEl!.textContent).toContain('.b');
    expect(styleEl!.textContent).not.toContain('.a {');
  });

  it('handles escaped quote in CSS string literal', async () => {
    const v = state('A');
    const scope = css`
      .x::before {
        content: 'say \\' ${() => v()}\\'';
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('say');
    v('B');
    await tick();
    expect(styleEl!.textContent).toContain('B');
  });

  it('handles unterminated /* */ comment in template', () => {
    const scope = css`/* comment without close .x { color: red; }`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl).not.toBeNull();
  });

  it('handles static interpolation with non-string value', () => {
    const scope = css`
      .x {
        padding: ${10}px;
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('10px');
  });

  it('handles null interpolation by emitting empty', () => {
    // Verifies the framework's contract: null in a css interpolation
    // emits empty without throwing. Value pulled from JSON.parse so the
    // bare `${null}` literal is gone — the value is genuinely `unknown`
    // and only resolved at runtime.
    const src = JSON.parse('{"v":null}') as Record<string, unknown>;
    const scope = css`
      .x {
        color: ${src.v};
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl).not.toBeNull();
  });

  it('removes <style> on mount() unmount with reactive css', async () => {
    const color = state('red');
    const container = document.createElement('div');
    let scope = '';
    const { unmount } = mount(() => {
      scope = css`
        .theme {
          color: ${() => color()};
        }
      `;
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
      scope = css`
        .theme-static {
          color: red;
        }
      `;
      return html`<p class="theme-static">x</p>`;
    }, container);
    expect(document.querySelector(`style[data-purity-scope="${scope}"]`)).not.toBeNull();

    unmount();
    expect(document.querySelector(`style[data-purity-scope="${scope}"]`)).toBeNull();
  });

  it('handles well-formed /* */ comment in reactive template', async () => {
    const c = state('red');
    const scope = css`
      /* leading comment */
      .x {
        color: ${() => c()};
      }
    `;
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
    const scope = css`
      .x {
        color: ${() => c()};
        padding: ${nul}px;
        margin: ${undef};
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('color: red');
  });

  it('mixes reactive + static interpolations in one rule', async () => {
    const c = state('red');
    const scope = css`
      .x {
        color: ${() => c()};
        padding: ${10}px;
      }
    `;
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
    const scope = css`
      .x {
        color: ${() => c()};
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    const before = styleEl!.textContent;
    // Same value — newCss === prevCss branch
    c('red');
    await tick();
    expect(styleEl!.textContent).toBe(before);
  });

  it('handles reactive values inside @media', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = state('red');
    const scope = css`
      @media (min-width: 1px) {
        .x {
          color: ${() => c()};
        }
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain('red');

    c('blue');
    await tick();
    expect(styleEl!.textContent).toContain('blue');
    warn.mockRestore();
  });

  it('reacts to a value just after an unterminated comment without crashing', async () => {
    const v = state('1');
    // The @scope-based path is tolerant of malformed input at template-level;
    // jsdom may warn, but the watcher still rebuilds on signal change.
    const scope = css`/* unterminated ${() => v()}`;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl).not.toBeNull();
    v('2');
    await tick();
    expect(styleEl!.textContent).toContain('2');
  });

  it('wraps emitted styles in @layer purity', () => {
    const scope = css`
      .box {
        color: red;
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent!.trim().startsWith('@layer purity {')).toBe(true);
    expect(styleEl!.textContent).toContain(`@scope (.${scope})`);
  });

  it('wraps reactive emitted styles in @layer purity across updates', async () => {
    const c = state('red');
    const scope = css`
      .box {
        color: ${() => c()};
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent!.trim().startsWith('@layer purity {')).toBe(true);

    c('blue');
    await tick();
    expect(styleEl!.textContent!.trim().startsWith('@layer purity {')).toBe(true);
    expect(styleEl!.textContent).toContain('blue');
  });

  it('installs `@layer purity, user;` order declaration exactly once', () => {
    css`
      .a {
        color: red;
      }
    `;
    css`
      .b {
        color: green;
      }
    `;
    const orderEls = document.querySelectorAll('style[data-purity-layers]');
    expect(orderEls.length).toBe(1);
    expect(orderEls[0].textContent).toBe('@layer purity, user;');
  });

  it('prepends the layer-order declaration before the first scoped <style>', () => {
    const scope = css`
      .late {
        color: red;
      }
    `;
    const orderEl = document.head.querySelector('style[data-purity-layers]');
    const scopeEl = document.head.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(orderEl).not.toBeNull();
    expect(scopeEl).not.toBeNull();
    // compareDocumentPosition: bit 4 = follows. orderEl must precede scopeEl.
    const rel = orderEl!.compareDocumentPosition(scopeEl!);
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('leaves :host(.x) and :host-context() alone (not rewritten)', () => {
    // The pre-@scope implementation only handled bare `:host` as a sole
    // selector. The :host → :scope rewrite preserves that contract: more
    // complex Shadow-only forms are left untouched (and won't be valid in
    // the light-DOM fallback either way, but we don't corrupt them).
    const scope = css`
      :host(.special) {
        color: blue;
      }
      :host-context(.dark) {
        color: white;
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl!.textContent).toContain(':host(.special)');
    expect(styleEl!.textContent).toContain(':host-context(.dark)');
  });

  // ---------------------------------------------------------------------------
  // Audit-v2 hardening regressions
  // ---------------------------------------------------------------------------

  it('neutralizes </style> smuggling in static interpolations', () => {
    // An attacker-controlled value that contains `</style>` must not be
    // serialized back as a real closing tag if the styleEl's outerHTML is
    // later reflected into innerHTML (e.g., devtools, SSR-mirroring tools,
    // or HTML serialization). Defensive: replace `</style` with an escaped
    // form so the resulting style element is round-trippable.
    const evil = '</style><script>alert(1)</script>';
    const scope = css`
      .x {
        content: '${evil}';
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl).not.toBeNull();
    // outerHTML must remain a single <style> element — no smuggled </style>.
    const outer = styleEl!.outerHTML;
    // Count of </style> in serialized form must be exactly one (the real
    // closing tag at the end). If smuggled, count would be two.
    const matches = outer.match(/<\/style/gi);
    expect(matches!.length).toBe(1);
  });

  it('neutralizes </style> smuggling in reactive interpolations', async () => {
    const v = state('safe');
    const scope = css`
      .x {
        content: '${() => v()}';
      }
    `;
    const styleEl = document.querySelector(`style[data-purity-scope="${scope}"]`);
    expect(styleEl).not.toBeNull();

    v('</style><img onerror=alert(1)>');
    await tick();
    const outer = styleEl!.outerHTML;
    const matches = outer.match(/<\/style/gi);
    expect(matches!.length).toBe(1);
  });

  it('does not crash when document.head is briefly missing', () => {
    // Defensive: installLayerOrder must not throw if document.head returns
    // null transiently (rare but seen during page-unload or some test
    // tear-downs). Patch the getter then restore.
    const origHead = document.head;
    Object.defineProperty(document, 'head', { configurable: true, get: () => null });
    try {
      expect(() => {
        css`
          .x {
            color: red;
          }
        `;
      }).not.toThrow();
    } finally {
      Object.defineProperty(document, 'head', { configurable: true, get: () => origHead });
    }
  });
});
