import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// css`` — scoped styles, reactive by default
//
// Static values are set once. Functions are reactive — style updates
// automatically when signals change.
//
//   // Static
//   const scope = css`.title { color: red; }`;
//
//   // Reactive
//   const scope = css`.box { background: ${() => color()}; }`;
//
//   html`<div class=${scope}>...</div>`;
// ---------------------------------------------------------------------------

let scopeCounter = 0;

export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
  const scopeClass = `p-${scopeCounter++}`;
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-purity-scope', scopeClass);
  document.head.appendChild(styleEl);

  const hasReactive = values.some((v) => typeof v === 'function');

  const buildCss = () => {
    let rawCss = '';
    for (let i = 0; i < strings.length; i++) {
      rawCss += strings[i];
      if (i < values.length) {
        const val = values[i];
        rawCss += String(typeof val === 'function' ? (val as () => unknown)() : (val ?? ''));
      }
    }
    return scopeSelectors(rawCss, `.${scopeClass}`);
  };

  if (hasReactive) {
    let prevCss = '';
    watch(() => {
      const newCss = buildCss();
      if (newCss !== prevCss) {
        prevCss = newCss;
        styleEl.textContent = newCss;
      }
    });
  } else {
    styleEl.textContent = buildCss();
  }

  return scopeClass;
}

// ---------------------------------------------------------------------------
// scopeSelectors — prefix each CSS selector with a scope class
// ---------------------------------------------------------------------------

function scopeSelectors(cssText: string, scope: string): string {
  return cssText.replace(/([^{}]+)\{/g, (_match, selectorGroup: string) => {
    const selectors = selectorGroup.split(',').map((s) => {
      const trimmed = s.trim();
      if (!trimmed) return s;
      if (trimmed === ':host') return `${scope} `;
      if (trimmed.startsWith(scope)) return `${trimmed} `;
      return `${scope} ${trimmed}`;
    });
    return `${selectors.join(', ')}{`;
  });
}
