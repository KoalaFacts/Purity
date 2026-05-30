import { getCurrentContext } from './component.ts';
import { watch } from './signals.ts';

// ---------------------------------------------------------------------------
// css`` — scoped styles
//
// Inside a component: uses Shadow DOM adoptedStyleSheets (native scoping)
// Outside a component: falls back to <style> injection wrapped in
//   `@layer purity { @scope (.p-N) { … } }` for layered + DOM-bounded scope.
//
// Reactive by default — functions in interpolations auto-update.
//
//   component('p-card', (props) => {
//     css`.title { color: ${() => props.color}; }`;  // reactive, scoped
//     return html`<h2 class="title">Hello</h2>`;
//   });
// ---------------------------------------------------------------------------

/**
 * Scoped CSS styles. Inside a component, uses Shadow DOM `adoptedStyleSheets`
 * for native scoping. Outside, injects a `<style>` tag containing
 * `@layer purity { @scope (.p-N) { … } }` — `@scope` provides DOM-bounded
 * scoping (proximity-weighted, no specificity bump from a wrapping class),
 * and `@layer purity` lets unlayered user CSS override framework rules.
 *
 * Supports reactive values — functions in interpolations auto-update the styles.
 *
 * `:host` (used out of habit from the Shadow DOM path) is rewritten to
 * `:scope` so the same source compiles in both contexts. More complex
 * selectors like `:host(.x)` or `:host-context()` remain Shadow-only.
 *
 * @example
 * ```ts
 * // Static styles:
 * css`.title { color: red; font-size: 1.5rem; }`;
 *
 * // Reactive styles (auto-update when signal changes):
 * css`.box { background: ${() => dark() ? '#333' : '#fff'}; }`;
 *
 * // Inside a component (recommended — Shadow DOM scopes automatically):
 * component('p-card', () => {
 *   css`
 *     :host { display: block; }
 *     .card { padding: 1rem; border-radius: 8px; }
 *     .title { color: #6c5ce7; }
 *   `;
 *   return html`<div class="card"><h2 class="title">Hello</h2></div>`;
 * });
 * ```
 *
 * @returns Scope class name (when used outside a component). Empty string inside components.
 */
export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
  const ctx = getCurrentContext();
  const shadowRoot = ctx ? ((ctx as any)._shadowRoot as ShadowRoot | undefined) : undefined;
  const hasReactive = values.some((v) => typeof v === 'function');

  const buildCss = (): string => {
    let raw = '';
    for (let i = 0; i < strings.length; i++) {
      raw += strings[i];
      if (i < values.length) {
        const val = values[i];
        const resolved = typeof val === 'function' ? (val as () => unknown)() : (val ?? '');
        // Defensive: neutralize `</style>` (and `</script>`) smuggled through
        // an interpolation. textContent on a <style> element is parser-safe
        // in the current DOM, but a smuggled closing tag becomes a real one
        // when the element's outerHTML is later round-tripped through
        // innerHTML (devtools paste, SSR mirror, error reporters that log
        // outerHTML). Strings from `strings` (the template-literal raw parts)
        // are authored statically and trusted; only interpolated values are
        // sanitized.
        raw += neutralizeClosingTags(String(resolved));
      }
    }
    return raw;
  };

  // SSR path: collect styles into the active context for inlining inside the
  // component's <template shadowrootmode> block. Reactive values are resolved
  // once at render time — there's no second pass on the server.
  const ssrStyles = ctx ? (ctx as unknown as { _ssrStyles?: string[] })._ssrStyles : undefined;
  if (ssrStyles !== undefined) {
    ssrStyles.push(buildCss());
    return '';
  }

  // Shadow DOM path — native scoping, no regex, no class names
  /* v8 ignore start -- jsdom lacks CSSStyleSheet ctor + adoptedStyleSheets */
  if (shadowRoot) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(buildCss());

    shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];

    if (hasReactive) {
      let prevCss = '';
      const dispose = watch(() => {
        const newCss = buildCss();
        if (newCss !== prevCss) {
          prevCss = newCss;
          sheet.replaceSync(newCss);
        }
      });
      // Auto-dispose on unmount
      if (ctx) (ctx.disposers ??= []).push(dispose);
    }

    // No scope class needed — Shadow DOM scopes it
    return '';
  }
  /* v8 ignore stop */

  // Fallback path — light-DOM scoping via `@layer purity { @scope (.p-N) { … } }`.
  //
  // `@scope` provides real DOM-bounded scoping: rules only match descendants
  // of the scope root, lower boundaries can be expressed, and proximity is
  // the cascade tie-breaker. Crucially the scope root itself contributes
  // zero specificity to descendant selectors (a bare `h1` inside the block
  // is 0,0,1, not 0,1,1 like the old `.p-N h1` rewrite emitted).
  //
  // `@layer purity` keeps user CSS — which sits outside any named layer —
  // ahead of the framework's emission in the cascade, so users override
  // without `!important`.
  installLayerOrder();

  const scopeClass = `p-${scopeCounter++}`;
  // Defensive: if `document.head` is missing (early-document, mid-unload,
  // some jsdom resets), skip the DOM emit but still return a stable scope
  // class so the caller's `className=` interpolation stays well-formed.
  const head = document.head;
  if (!head) return scopeClass;
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-purity-scope', scopeClass);
  head.appendChild(styleEl);

  const buildScoped = (): string => {
    const body = rewriteHostToScope(buildCss());
    return `@layer purity { @scope (.${scopeClass}) { ${body} } }`;
  };

  if (hasReactive) {
    let prevCss = '';
    const dispose = watch(() => {
      const newCss = buildScoped();
      /* v8 ignore next -- newCss==prevCss only when state writes the same value, which the reactivity layer already skips before we get here */
      if (newCss !== prevCss) {
        prevCss = newCss;
        styleEl.textContent = newCss;
      }
    });
    if (ctx) {
      (ctx.disposers ??= []).push(() => {
        dispose();
        styleEl.remove();
      });
    }
  } else {
    styleEl.textContent = buildScoped();
    if (ctx) {
      (ctx.disposers ??= []).push(() => styleEl.remove());
    }
  }

  return scopeClass;
}

// Map `:host` (the Shadow DOM root pseudo) to `:scope` (the @scope root) so
// users can write the same CSS for either context. Lookahead rules out
// `:host(.x)` (functional form) and `:host-context()` (separate pseudo) —
// both were already unsupported by the previous selector-rewriter, so this
// preserves the pre-@scope contract.
function rewriteHostToScope(cssText: string): string {
  return cssText.replace(/:host(?![-(\w])/g, ':scope');
}

// Defensive sanitiser for values interpolated into a css`` template. Splits
// any literal `</style` or `</script` (case-insensitive) so the resulting
// element's serialized form (outerHTML) survives a round-trip through
// innerHTML without smuggling a closing tag. Authored template parts are
// trusted; only interpolated unknowns flow through this.
function neutralizeClosingTags(s: string): string {
  return s.replace(/<\/(style|script)/gi, '<\\/$1');
}

// Install the layer-order declaration once per document. Prepending to
// `<head>` keeps it lexically before any per-component `<style>` tag the
// framework emits, which is what cascade-layers needs to establish order.
// Idempotent: re-checks the DOM so HMR / test resets don't reinstall.
function installLayerOrder(): void {
  /* v8 ignore next -- defensive; the non-Shadow path only runs in a browser */
  if (typeof document === 'undefined') return;
  // Defensive: `document.head` can be null during early-document or
  // unload-tear-down windows. Bail rather than throw — the caller's
  // fallback path will also bail on the same check.
  const head = document.head;
  if (!head) return;
  if (head.querySelector('style[data-purity-layers]')) return;
  const el = document.createElement('style');
  el.setAttribute('data-purity-layers', '');
  el.textContent = '@layer purity, user;';
  head.prepend(el);
}

let scopeCounter = 0;
