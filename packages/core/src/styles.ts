import { getCurrentComponent, getCurrentContext, watch } from '@purityjs/signals';
import { ENABLE_SSR } from './hooks.ts';

/**
 * Scoped CSS styles. Inside a component, uses Shadow DOM `adoptedStyleSheets`
 * for native scoping. Outside, injects a `<style>` tag containing
 * `@layer purity { @scope (.p-N) { … } }`.
 */
export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
  const ctx = getCurrentComponent();
  const shadowRoot = ctx ? (ctx._shadowRoot as ShadowRoot | undefined) : undefined;
  const hasReactive = values.some((v) => typeof v === 'function');

  const buildCss = (): string => {
    let raw = '';
    for (let i = 0; i < strings.length; i++) {
      raw += strings[i];
      if (i < values.length) {
        const val = values[i];
        const resolved = typeof val === 'function' ? (val as () => unknown)() : (val ?? '');
        raw += neutralizeClosingTags(String(resolved));
      }
    }
    return raw;
  };

  if (ENABLE_SSR) {
    const ssrStyles = ctx?._ssrStyles;
    if (ssrStyles !== undefined) {
      ssrStyles.push(buildCss());
      return '';
    }
  }

  /* v8 ignore start -- jsdom lacks CSSStyleSheet ctor + adoptedStyleSheets */
  if (shadowRoot) {
    const Ctor = getCSSStyleSheetCtor(shadowRoot);
    const sheet = new Ctor();
    sheet.replaceSync(buildCss());

    shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
    const owner = getCurrentContext();
    if (owner && owner !== ctx) {
      (owner.disposers ??= []).push(() => {
        shadowRoot.adoptedStyleSheets = shadowRoot.adoptedStyleSheets.filter((x) => x !== sheet);
      });
    }

    if (hasReactive) {
      let prevCss = '';
      watch(() => {
        const newCss = buildCss();
        if (newCss !== prevCss) {
          prevCss = newCss;
          sheet.replaceSync(newCss);
        }
      });
    }

    return '';
  }
  /* v8 ignore stop */

  installLayerOrder();

  const scopeClass = `p-${nextScopeId()}`;
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
    watch(() => {
      const newCss = buildScoped();
      /* v8 ignore next */
      if (newCss !== prevCss) {
        prevCss = newCss;
        styleEl.textContent = newCss;
      }
    });
  } else {
    styleEl.textContent = buildScoped();
  }
  const owner = getCurrentContext();
  if (owner) (owner.disposers ??= []).push(() => styleEl.remove());

  return scopeClass;
}

function rewriteHostToScope(cssText: string): string {
  return cssText.replace(/:host(?![-(\w])/g, ':scope');
}

function neutralizeClosingTags(s: string): string {
  return s.replace(/<\/(style|script)/gi, '<\\/$1');
}

function installLayerOrder(): void {
  /* v8 ignore next */
  if (typeof document === 'undefined') return;
  const head = document.head;
  if (!head) return;
  if (head.querySelector('style[data-purity-layers]')) return;
  const el = document.createElement('style');
  el.setAttribute('data-purity-layers', '');
  el.textContent = '@layer purity, user;';
  head.prepend(el);
}

const SCOPE_COUNTER_KEY = '__purityCssScopeCounter';
function nextScopeId(): number {
  const g = globalThis as unknown as Record<string, number>;
  const n = (g[SCOPE_COUNTER_KEY] ?? 0) + 1;
  g[SCOPE_COUNTER_KEY] = n;
  return n - 1;
}

/* v8 ignore start */
const ctorCache = new WeakMap<Document, typeof CSSStyleSheet>();
function getCSSStyleSheetCtor(shadowRoot: ShadowRoot): typeof CSSStyleSheet {
  const owner = shadowRoot.ownerDocument;
  if (!owner) return CSSStyleSheet;
  const cached = ctorCache.get(owner);
  if (cached) return cached;
  const view = owner.defaultView as (Window & typeof globalThis) | null;
  const Ctor = view?.CSSStyleSheet ?? CSSStyleSheet;
  ctorCache.set(owner, Ctor);
  return Ctor;
}
/* v8 ignore stop */
